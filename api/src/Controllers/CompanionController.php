<?php

declare(strict_types=1);

namespace Dnd\Controllers;

use Dnd\Db;
use Dnd\HttpError;
use Dnd\Ids;
use Dnd\Request;
use Dnd\Response;
use Dnd\Sheets;

/**
 * Společníci a přivolaná stvoření postavy (familiar, animal companion, přivolaní tvorové): jméno, HP, AC, útoky a poznámka.
 * Nejsou to nepřátelé v Panelu DM ani plnohodnotné postavy. Čte majitel, DM a členové, kteří vidí postavu celou (`visibility = full`),
 * upravuje jen majitel a DM. Cizinec dostane 404, člen jen s veřejným náhledem 403. Hodnoty se ověřují stejně jako u nepřátel.
 */
final class CompanionController
{
    public const MAX_PER_CHARACTER = 20;

    /** @param array{id:string} $user */
    public static function index(Request $req, array $params, array $user): array
    {
        $char = Sheets::loadReadable($params['id'], $user);
        return ['companions' => self::forCharacter((string) $char['id'])];
    }

    /** @param array{id:string} $user */
    public static function create(Request $req, array $params, array $user): Response
    {
        $char = Sheets::loadMutable($params['id'], $user);
        $v = EnemyController::validate($req->json(), null);
        $id = Ids::uuid();
        Db::transaction(static function () use ($char, $id, $v): void {
            // Zámek postavy: souběžné přidání nesmí překročit limit.
            Db::one('SELECT id FROM characters WHERE id = ? FOR UPDATE', [$char['id']]);
            self::insert($id, (string) $char['id'], $v);
        });
        return Response::json(['companion' => self::payload(self::find($id))], 201);
    }

    /** @param array{id:string} $user */
    public static function update(Request $req, array $params, array $user): array
    {
        $row = self::find($params['id']);
        Sheets::loadMutable((string) $row['character_id'], $user);
        $v = EnemyController::validate($req->json(), $row);
        Db::exec(
            'UPDATE character_companions SET name = ?, hp_max = ?, hp_current = ?, ac = ?, attacks = ?, notes = ?, updated_at = UTC_TIMESTAMP() WHERE id = ?',
            [$v['name'], $v['hpMax'], $v['hpCurrent'], $v['ac'], self::enc($v['attacks']), $v['notes'], $row['id']],
        );
        return ['companion' => self::payload(self::find($params['id']))];
    }

    /** Zranění (záporné) nebo léčení (kladné); výsledek se ořízne na 0 až maximum. @param array{id:string} $user */
    public static function hp(Request $req, array $params, array $user): array
    {
        $row = self::find($params['id']);
        Sheets::loadMutable((string) $row['character_id'], $user);
        $delta = $req->json()['delta'] ?? null;
        if (!is_int($delta) || $delta === 0 || abs($delta) > 100000) {
            throw HttpError::validation('Zadej nenulové zranění nebo léčení.', 'delta');
        }
        Db::transaction(static function () use ($row, $delta): void {
            $cur = Db::one('SELECT hp_current, hp_max FROM character_companions WHERE id = ? FOR UPDATE', [$row['id']]) ?? throw HttpError::notFound('Společník nenalezen.');
            $new = max(0, min((int) $cur['hp_max'], (int) $cur['hp_current'] + $delta));
            Db::exec('UPDATE character_companions SET hp_current = ?, updated_at = UTC_TIMESTAMP() WHERE id = ?', [$new, $row['id']]);
        });
        return ['companion' => self::payload(self::find($params['id']))];
    }

    /** Další kus téhož tvora s plným zdravím a očíslovaným jménem („Wolf“ → „Wolf 2“), např. u kouzla Conjure Animals. @param array{id:string} $user */
    public static function duplicate(Request $req, array $params, array $user): Response
    {
        $row = self::find($params['id']);
        $char = Sheets::loadMutable((string) $row['character_id'], $user);
        $newId = Ids::uuid();
        Db::transaction(static function () use ($row, $char, $newId): void {
            Db::one('SELECT id FROM characters WHERE id = ? FOR UPDATE', [$char['id']]);
            $base = trim((string) preg_replace('/\s+\d+$/u', '', (string) $row['name']));
            $names = array_column(Db::all('SELECT name FROM character_companions WHERE character_id = ?', [$char['id']]), 'name');
            $n = 2;
            while (in_array(mb_substr("$base $n", 0, 100), $names, true)) {
                $n++;
            }
            $attacks = json_decode((string) $row['attacks'], true);
            self::insert($newId, (string) $char['id'], [
                'name' => mb_substr("$base $n", 0, 100), 'hpMax' => (int) $row['hp_max'], 'hpCurrent' => (int) $row['hp_max'],
                'ac' => $row['ac'] === null ? null : (int) $row['ac'], 'attacks' => is_array($attacks) ? $attacks : [], 'notes' => (string) $row['notes'],
            ]);
        });
        return Response::json(['companion' => self::payload(self::find($newId))], 201);
    }

    /** @param array{id:string} $user */
    public static function delete(Request $req, array $params, array $user): ?array
    {
        $row = self::find($params['id']);
        Sheets::loadMutable((string) $row['character_id'], $user);
        Db::exec('DELETE FROM character_companions WHERE id = ?', [$row['id']]);
        return null;
    }

    // ------------------------------------------------------------------ pomocné

    /** @param array<string, mixed> $v */
    private static function insert(string $id, string $characterId, array $v): void
    {
        if ((int) Db::value('SELECT COUNT(*) FROM character_companions WHERE character_id = ?', [$characterId]) >= self::MAX_PER_CHARACTER) {
            throw HttpError::validation('Postava může mít nejvýš ' . self::MAX_PER_CHARACTER . ' společníků.');
        }
        $pos = (int) Db::value('SELECT COALESCE(MAX(position), -1) + 1 FROM character_companions WHERE character_id = ?', [$characterId]);
        Db::exec(
            'INSERT INTO character_companions (id, character_id, name, hp_max, hp_current, ac, attacks, notes, position, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())',
            [$id, $characterId, $v['name'], $v['hpMax'], $v['hpCurrent'], $v['ac'], self::enc($v['attacks']), $v['notes'], $pos],
        );
    }

    /** @param mixed $value */
    private static function enc($value): string
    {
        return json_encode($value, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    }

    /** @return list<array<string, mixed>> */
    private static function forCharacter(string $characterId): array
    {
        $rows = Db::all('SELECT * FROM character_companions WHERE character_id = ? ORDER BY position, created_at, id', [$characterId]);
        return array_map([self::class, 'payload'], $rows);
    }

    /** @return array<string, mixed> */
    private static function find(string $id): array
    {
        return (Ids::isUuid($id) ? Db::one('SELECT * FROM character_companions WHERE id = ?', [$id]) : null) ?? throw HttpError::notFound('Společník nenalezen.');
    }

    /** @param array<string, mixed> $r @return array<string, mixed> */
    private static function payload(array $r): array
    {
        $attacks = json_decode((string) $r['attacks'], true);
        return [
            'id' => $r['id'],
            'characterId' => $r['character_id'],
            'name' => $r['name'],
            'hpMax' => (int) $r['hp_max'],
            'hpCurrent' => (int) $r['hp_current'],
            'ac' => $r['ac'] === null ? null : (int) $r['ac'],
            'attacks' => is_array($attacks) ? $attacks : [],
            'notes' => $r['notes'],
            'position' => (int) $r['position'],
        ];
    }
}
