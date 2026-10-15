<?php

declare(strict_types=1);

namespace Dnd\Controllers;

use Dnd\Access;
use Dnd\Db;
use Dnd\Dice;
use Dnd\HttpError;
use Dnd\Ids;
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

        $rolled = Dice::rollWithMode($terms, $mode, $crit);
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
        return Response::json(['roll' => self::one($id)], 201);
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
