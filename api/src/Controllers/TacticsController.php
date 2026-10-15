<?php

declare(strict_types=1);

namespace Dnd\Controllers;

use Dnd\Access;
use Dnd\Db;
use Dnd\HttpError;
use Dnd\Ids;
use Dnd\Request;
use Dnd\Response;
use Dnd\Sheets;
use Dnd\Tactics;

/**
 * Taktiky postavy (combat cheat sheet). Čte majitel, DM a (když má postava visibility 'full') ostatní členové kampaně,
 * upravuje jen majitel a DM. Cizinec dostane 404, hráč bez práv 403.
 */
final class TacticsController
{
    /** @param array{id:string} $user */
    public static function index(Request $req, array $params, array $user): array
    {
        $char = self::loadReadable($params['id'], $user);
        $rows = Db::all('SELECT * FROM character_tactics WHERE character_id = ? ORDER BY kind, position, created_at', [$char['id']]);
        return ['tactics' => array_map([self::class, 'payload'], $rows)];
    }

    /** @param array{id:string} $user */
    public static function create(Request $req, array $params, array $user): Response
    {
        $char = Sheets::loadMutable($params['id'], $user);
        $in = $req->json();
        $kind = is_string($in['kind'] ?? null) ? $in['kind'] : '';
        $n = Tactics::normalize($kind, $in);
        Tactics::checkRefs((string) $char['id'], $n['data']);
        $id = Ids::uuid();
        Db::transaction(static function () use ($char, $id, $kind, $n): void {
            // Zámek postavy: souběžné přidání nesmí překročit limit ani vyrobit stejné pořadí.
            Db::one('SELECT id FROM characters WHERE id = ? FOR UPDATE', [$char['id']]);
            if ((int) Db::value('SELECT COUNT(*) FROM character_tactics WHERE character_id = ?', [$char['id']]) >= Tactics::MAX_PER_CHARACTER) {
                throw HttpError::validation('Postava může mít nejvýš ' . Tactics::MAX_PER_CHARACTER . ' položek taktik.', 'title');
            }
            $pos = (int) Db::value('SELECT COALESCE(MAX(position), -1) + 1 FROM character_tactics WHERE character_id = ? AND kind = ?', [$char['id'], $kind]);
            Db::exec(
                'INSERT INTO character_tactics (id, character_id, kind, position, title, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())',
                [$id, $char['id'], $kind, $pos, $n['title'], json_encode($n['data'], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR)],
            );
        });
        return Response::json(['tactic' => self::payload(Db::one('SELECT * FROM character_tactics WHERE id = ?', [$id]) ?? [])], 201);
    }

    /** Změní položku: pole, která nepřijdou, zůstanou jak byla. @param array{id:string} $user */
    public static function update(Request $req, array $params, array $user): array
    {
        $row = self::loadTactic($params['id']);
        Sheets::loadMutable((string) $row['character_id'], $user);
        $existing = json_decode((string) $row['data'], true);
        $merged = array_merge(is_array($existing) ? $existing : [], ['title' => $row['title']], $req->json());
        $n = Tactics::normalize((string) $row['kind'], $merged);
        Tactics::checkRefs((string) $row['character_id'], $n['data']);
        Db::exec(
            'UPDATE character_tactics SET title = ?, data = ?, updated_at = UTC_TIMESTAMP() WHERE id = ?',
            [$n['title'], json_encode($n['data'], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR), $row['id']],
        );
        return ['tactic' => self::payload(Db::one('SELECT * FROM character_tactics WHERE id = ?', [$row['id']]) ?? [])];
    }

    /** @param array{id:string} $user */
    public static function delete(Request $req, array $params, array $user): ?array
    {
        $row = self::loadTactic($params['id']);
        Sheets::loadMutable((string) $row['character_id'], $user);
        Db::exec('DELETE FROM character_tactics WHERE id = ?', [$row['id']]);
        return null;
    }

    /** Nové pořadí jednoho druhu: ids musí být přesně všechny položky toho druhu. @param array{id:string} $user */
    public static function reorder(Request $req, array $params, array $user): array
    {
        $char = Sheets::loadMutable($params['id'], $user);
        $in = $req->json();
        $kind = is_string($in['kind'] ?? null) ? $in['kind'] : '';
        if (!in_array($kind, Tactics::KINDS, true)) {
            throw HttpError::validation('Neznámý druh taktiky.', 'kind');
        }
        $ids = $in['ids'] ?? null;
        if (!is_array($ids) || array_filter($ids, static fn ($i): bool => !is_string($i)) !== []) {
            throw HttpError::validation('Pošli pole id položek.', 'ids');
        }
        Db::transaction(static function () use ($char, $kind, $ids): void {
            Db::one('SELECT id FROM characters WHERE id = ? FOR UPDATE', [$char['id']]);
            $current = array_map('strval', array_column(Db::all('SELECT id FROM character_tactics WHERE character_id = ? AND kind = ?', [$char['id'], $kind]), 'id'));
            $given = array_values($ids);
            if (count($given) !== count($current) || array_diff($given, $current) !== [] || count(array_unique($given)) !== count($given)) {
                throw HttpError::validation('Pořadí musí obsahovat přesně všechny položky tohoto druhu.', 'ids');
            }
            foreach ($given as $position => $id) {
                Db::exec('UPDATE character_tactics SET position = ? WHERE id = ? AND character_id = ?', [$position, $id, $char['id']]);
            }
        });
        $rows = Db::all('SELECT * FROM character_tactics WHERE character_id = ? ORDER BY kind, position, created_at', [$char['id']]);
        return ['tactics' => array_map([self::class, 'payload'], $rows)];
    }

    // ------------------------------------------------------------------ pomocné

    /**
     * Postava, jejíž taktiky smí uživatel číst (cizinec 404, bez práv 403).
     * @param array{id:string} $user
     * @return array<string, mixed>
     */
    private static function loadReadable(string $id, array $user): array
    {
        $row = Ids::isUuid($id) ? Db::one('SELECT id, campaign_id, owner_id, visibility FROM characters WHERE id = ?', [$id]) : null;
        $role = $row === null ? null : Access::role($user['id'], (string) $row['campaign_id']);
        if ($row === null || $role === null) {
            throw HttpError::notFound('Postava nenalezena.');
        }
        if ($role !== 'dm' && $row['owner_id'] !== $user['id'] && $row['visibility'] !== 'full') {
            throw HttpError::forbidden('Tuto postavu vidíš jen v omezeném náhledu.');
        }
        return $row;
    }

    /** @return array<string, mixed> */
    private static function loadTactic(string $id): array
    {
        return (Ids::isUuid($id) ? Db::one('SELECT * FROM character_tactics WHERE id = ?', [$id]) : null) ?? throw HttpError::notFound('Položka nenalezena.');
    }

    /** @param array<string, mixed> $r @return array<string, mixed> */
    private static function payload(array $r): array
    {
        $data = json_decode((string) $r['data'], true);
        return [
            'id' => $r['id'],
            'characterId' => $r['character_id'],
            'kind' => $r['kind'],
            'position' => (int) $r['position'],
            'title' => $r['title'],
            'data' => is_array($data) ? $data : new \stdClass(),
            'createdAt' => Ids::iso((string) $r['created_at']),
            'updatedAt' => Ids::iso((string) $r['updated_at']),
        ];
    }
}
