<?php

declare(strict_types=1);

namespace Dnd\Controllers;

use Dnd\Access;
use Dnd\Db;
use Dnd\Dice;
use Dnd\HttpError;
use Dnd\Ids;
use Dnd\Initiative;
use Dnd\Input;
use Dnd\RateLimiter;
use Dnd\Request;
use Dnd\Response;

/**
 * Kostky: hody se losují na serveru a ukládají do sdíleného logu kampaně.
 *  - log vidí členové kampaně; skrytý hod (hidden) vidí jen ten, kdo hodil, a DM,
 *  - hod za postavu smí provést její majitel nebo DM.
 */
final class DiceController
{
    private const PAGE = 50;
    private const MODES = ['normal', 'advantage', 'disadvantage'];

    /** @param array{id:string} $user */
    public static function roll(Request $req, array $params, array $user): Response
    {
        $role = Access::requireMember($user, $params['id']);
        RateLimiter::hit('roll:' . $user['id'], 60, 60);
        $data = $req->json();

        $terms = Dice::parse(is_string($data['expression'] ?? null) ? $data['expression'] : '');
        $mode = $data['mode'] ?? 'normal';
        if (!is_string($mode) || !in_array($mode, self::MODES, true)) {
            throw HttpError::validation("Režim musí být 'normal', 'advantage' nebo 'disadvantage'.", 'mode');
        }
        foreach (['crit', 'hidden'] as $flag) {
            if (array_key_exists($flag, $data) && !is_bool($data[$flag])) {
                throw HttpError::validation("$flag musí být true/false.", $flag);
            }
        }
        $crit = ($data['crit'] ?? false) === true;
        $hidden = ($data['hidden'] ?? false) === true;
        $label = Input::optionalString($data, 'label', 100, 'Popisek') ?? '';
        $critExtra = self::critExtra($data);

        $characterId = null;
        if (array_key_exists('characterId', $data) && $data['characterId'] !== null) {
            $cid = is_string($data['characterId']) ? $data['characterId'] : '';
            $char = Ids::isUuid($cid) ? Db::one('SELECT id, owner_id, name FROM characters WHERE id = ? AND campaign_id = ?', [$cid, $params['id']]) : null;
            if ($char === null) {
                throw HttpError::validation('Postava není z této kampaně.', 'characterId');
            }
            if ($char['owner_id'] !== $user['id'] && $role !== 'dm') {
                throw HttpError::forbidden('Za cizí postavu nemůžeš hodit.');
            }
            $characterId = (string) $char['id'];
        }

        $initiative = $data['initiative'] ?? false;
        if (!is_bool($initiative)) {
            throw HttpError::validation('initiative musí být true/false.', 'initiative');
        }
        if ($initiative && $characterId === null) {
            throw HttpError::validation('Hod na iniciativu musí patřit postavě (characterId).', 'characterId');
        }

        $rolled = Dice::rollWithMode($terms, $mode, $crit, $critExtra);
        $expression = Dice::canonical($terms);
        Db::exec(
            'INSERT INTO dice_rolls (campaign_id, user_id, character_id, label, expression, mode, crit, hidden, total, result, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP())',
            [
                $params['id'], $user['id'], $characterId, $label, $expression, $mode, $crit ? 1 : 0, $hidden ? 1 : 0, $rolled['total'],
                json_encode(['attempts' => $rolled['attempts'], 'chosen' => $rolled['chosen'], 'natural' => $rolled['natural']], JSON_THROW_ON_ERROR),
            ],
        );
        $id = (int) Db::pdo()->lastInsertId();
        // Hod na iniciativu se zapíše do pořadí iniciativy v kampani (vidí ho jen DM).
        if ($initiative && $characterId !== null) {
            Db::transaction(static function () use ($params, $characterId, $rolled): void {
                Initiative::set($params['id'], 'character', $characterId, max(-20, min(60, $rolled['total'])));
            });
        }
        return Response::json(['roll' => self::one($id)], 201);
    }

    /**
     * Kostky navíc při kritu (`critExtra`, např. „1d12“ u Brutal Critical): jen kostky, bez konstant a záporných členů, nejvýš 10.
     * @param array<string, mixed> $data
     * @return list<array{sign:int,count?:int,sides?:int,constant?:int}>
     */
    private static function critExtra(array $data): array
    {
        if (!array_key_exists('critExtra', $data) || $data['critExtra'] === null || $data['critExtra'] === '') {
            return [];
        }
        $terms = Dice::parse(is_string($data['critExtra']) ? $data['critExtra'] : '');
        $dice = 0;
        foreach ($terms as $t) {
            if (!isset($t['sides']) || $t['sign'] < 0) {
                throw HttpError::validation('Kostky navíc při kritu mohou být jen kladné kostky (např. 1d12).', 'critExtra');
            }
            $dice += $t['count'];
        }
        if ($dice > 10) {
            throw HttpError::validation('Kostek navíc při kritu je nejvýš 10.', 'critExtra');
        }
        return $terms;
    }

    /**
     * Série útoků najednou (taktiky: 2× kopí + Flurry = 4 útoky a 4 zranění). Každý útok má hod na zásah a hod zranění;
     * přirozená 20 na zásah hodí zranění jako kritické. Výhoda a nevýhoda platí jen pro hod na zásah. Všechny hody jdou do
     * sdíleného logu jako běžné hody (skryté vidí jen ten, kdo hodil, a DM). Max 24 útoků najednou.
     * @param array{id:string} $user
     */
    public static function batch(Request $req, array $params, array $user): Response
    {
        $role = Access::requireMember($user, $params['id']);
        RateLimiter::hit('roll:' . $user['id'], 60, 60);
        $data = $req->json();
        $mode = $data['mode'] ?? 'normal';
        if (!is_string($mode) || !in_array($mode, self::MODES, true)) {
            throw HttpError::validation("Režim musí být 'normal', 'advantage' nebo 'disadvantage'.", 'mode');
        }
        if (array_key_exists('hidden', $data) && !is_bool($data['hidden'])) {
            throw HttpError::validation('hidden musí být true/false.', 'hidden');
        }
        $hidden = ($data['hidden'] ?? false) === true;
        $attacks = $data['attacks'] ?? null;
        if (!is_array($attacks) || $attacks === [] || count($attacks) > 24) {
            throw HttpError::validation('Pošli 1 až 24 útoků v poli attacks.', 'attacks');
        }

        $characterId = null;
        if (array_key_exists('characterId', $data) && $data['characterId'] !== null) {
            $cid = is_string($data['characterId']) ? $data['characterId'] : '';
            $char = Ids::isUuid($cid) ? Db::one('SELECT id, owner_id FROM characters WHERE id = ? AND campaign_id = ?', [$cid, $params['id']]) : null;
            if ($char === null) {
                throw HttpError::validation('Postava není z této kampaně.', 'characterId');
            }
            if ($char['owner_id'] !== $user['id'] && $role !== 'dm') {
                throw HttpError::forbidden('Za cizí postavu nemůžeš hodit.');
            }
            $characterId = (string) $char['id'];
        }

        // Nejdřív se vše zvaliduje, teprve potom se hází, ať se při chybě nezapíše půlka série.
        $plan = [];
        foreach (array_values($attacks) as $a) {
            if (!is_array($a)) {
                throw HttpError::validation('Neplatný útok.', 'attacks');
            }
            $label = Input::optionalString($a, 'label', 80, 'Popisek') ?? '';
            $hit = is_string($a['toHit'] ?? null) && $a['toHit'] !== '' ? Dice::parse($a['toHit']) : null;
            $dmg = is_string($a['damage'] ?? null) && $a['damage'] !== '' ? Dice::parse($a['damage']) : null;
            if ($hit === null && $dmg === null) {
                throw HttpError::validation('Útok potřebuje hod na zásah nebo zranění.', 'attacks');
            }
            $plan[] = [$label, $hit, $dmg];
        }

        $results = Db::transaction(static function () use ($plan, $params, $user, $characterId, $mode, $hidden): array {
            $out = [];
            foreach ($plan as [$label, $hit, $dmg]) {
                $hitRoll = null;
                $crit = false;
                if ($hit !== null) {
                    $rolled = Dice::rollWithMode($hit, $mode, false);
                    $crit = $rolled['natural'] === 20;
                    $hitRoll = self::insertRoll($params['id'], $user['id'], $characterId, $label . ' (útok)', $hit, $mode, false, $hidden, $rolled);
                }
                $dmgRoll = null;
                if ($dmg !== null) {
                    $rolled = Dice::rollWithMode($dmg, 'normal', $crit);
                    $dmgRoll = self::insertRoll($params['id'], $user['id'], $characterId, $label . ($crit ? ' (zranění, kritický zásah)' : ' (zranění)'), $dmg, 'normal', $crit, $hidden, $rolled);
                }
                $out[] = ['label' => $label, 'crit' => $crit, 'hit' => $hitRoll === null ? null : self::one($hitRoll), 'damage' => $dmgRoll === null ? null : self::one($dmgRoll)];
            }
            return $out;
        });
        return Response::json(['results' => $results], 201);
    }

    /**
     * @param list<array<string, mixed>> $terms
     * @param array{attempts: list<array<string, mixed>>, chosen: int, total: int, natural: int|null} $rolled
     */
    public static function insertRoll(string $campaignId, string $userId, ?string $characterId, string $label, array $terms, string $mode, bool $crit, bool $hidden, array $rolled): int
    {
        Db::exec(
            'INSERT INTO dice_rolls (campaign_id, user_id, character_id, label, expression, mode, crit, hidden, total, result, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP())',
            [
                $campaignId, $userId, $characterId, $label, Dice::canonical($terms), $mode, $crit ? 1 : 0, $hidden ? 1 : 0, $rolled['total'],
                json_encode(['attempts' => $rolled['attempts'], 'chosen' => $rolled['chosen'], 'natural' => $rolled['natural']], JSON_THROW_ON_ERROR),
            ],
        );
        return (int) Db::pdo()->lastInsertId();
    }

    /** Posledních 50 hodů, které uživatel smí vidět; s `after` jen novější. @param array{id:string} $user */
    public static function index(Request $req, array $params, array $user): array
    {
        $role = Access::requireMember($user, $params['id']);
        $after = max(0, (int) ($req->query['after'] ?? 0));
        $rows = Db::all(
            self::SELECT . ' WHERE r.campaign_id = ? AND r.id > ? AND (r.hidden = 0 OR r.user_id = ? OR ? = \'dm\') ORDER BY r.id DESC LIMIT ' . self::PAGE,
            [$params['id'], $after, $user['id'], $role],
        );
        return ['rolls' => array_map([self::class, 'payload'], array_reverse($rows))];
    }

    // ------------------------------------------------------------------ pomocné

    private const SELECT = 'SELECT r.id, r.user_id, r.character_id, r.label, r.expression, r.mode, r.crit, r.hidden, r.total, r.result, r.created_at,
            u.display_name AS user_name, c.name AS character_name
        FROM dice_rolls r JOIN users u ON u.id = r.user_id LEFT JOIN characters c ON c.id = r.character_id';

    /** @return array<string, mixed> */
    private static function one(int $id): array
    {
        return self::payload(Db::one(self::SELECT . ' WHERE r.id = ?', [$id]) ?? []);
    }

    /** @param array<string, mixed> $r @return array<string, mixed> */
    private static function payload(array $r): array
    {
        $result = json_decode((string) $r['result'], true);
        $result = is_array($result) ? $result : [];
        return [
            'id' => (int) $r['id'],
            'userId' => $r['user_id'],
            'userName' => $r['user_name'],
            'characterId' => $r['character_id'],
            'characterName' => $r['character_name'],
            'label' => $r['label'],
            'expression' => $r['expression'],
            'mode' => $r['mode'],
            'crit' => (bool) $r['crit'],
            'hidden' => (bool) $r['hidden'],
            'total' => (int) $r['total'],
            'attempts' => $result['attempts'] ?? [],
            'chosen' => (int) ($result['chosen'] ?? 0),
            'natural' => $result['natural'] ?? null,
            'createdAt' => Ids::iso((string) $r['created_at']),
        ];
    }
}
