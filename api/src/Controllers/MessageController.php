<?php

declare(strict_types=1);

namespace Dnd\Controllers;

use Dnd\Access;
use Dnd\Db;
use Dnd\HttpError;
use Dnd\Ids;
use Dnd\Input;
use Dnd\RateLimiter;
use Dnd\Request;
use Dnd\Response;

/**
 * Zprávy v kampani.
 *  - skupinový chat (thread 'group'): píše i čte každý člen kampaně,
 *  - soukromá konverzace DM a hráče (thread 'dm:<id hráče>'): hráč smí psát jen DM, DM smí psát hráči,
 *  - tajná zpráva od DM více hráčům (thread 'secret'): vidí ji jen DM a příjemci.
 * Viditelnost drží jediné pravidlo (visibleSql): skupinové vidí každý člen, ostatní jen odesílatel a příjemci.
 * DM tedy nečte nic, co mu nebylo adresováno ani sám neodeslal (hráči si mezi sebou soukromě psát nemohou).
 */
final class MessageController
{
    private const MAX_BODY = 4000;
    private const PAGE = 200;

    /** SQL podmínka "tuto zprávu smí uživatel vidět"; parametry viz visibleArgs. */
    private static function visibleSql(): string
    {
        return "(m.thread = 'group' OR m.sender_id = ? OR EXISTS (SELECT 1 FROM message_recipients r WHERE r.message_id = m.id AND r.user_id = ?))";
    }

    /** @return list<string> */
    private static function visibleArgs(string $userId): array
    {
        return [$userId, $userId];
    }

    /**
     * Zprávy, které uživatel vidí. Bez `after` posledních 200, s `after` jen novější (průběžné dotazování), plus počty nepřečtených po vláknech.
     * @param array{id:string} $user
     */
    public static function index(Request $req, array $params, array $user): array
    {
        Access::requireMember($user, $params['id']);
        $after = max(0, (int) ($req->query['after'] ?? 0));
        $base = 'SELECT m.id, m.sender_id, m.thread, m.body, m.created_at, u.display_name AS sender_name
                 FROM messages m JOIN users u ON u.id = m.sender_id
                 WHERE m.campaign_id = ? AND ' . self::visibleSql();
        $args = [$params['id'], ...self::visibleArgs($user['id'])];
        if ($after > 0) {
            $rows = Db::all($base . ' AND m.id > ? ORDER BY m.id LIMIT 500', [...$args, $after]);
        } else {
            $rows = array_reverse(Db::all($base . ' ORDER BY m.id DESC LIMIT ' . self::PAGE, $args));
        }

        $recipients = [];
        if ($rows !== []) {
            $ids = array_map(static fn (array $r): int => (int) $r['id'], $rows);
            $in = implode(',', array_fill(0, count($ids), '?'));
            foreach (Db::all("SELECT r.message_id, u.id, u.display_name FROM message_recipients r JOIN users u ON u.id = r.user_id WHERE r.message_id IN ($in) ORDER BY u.display_name", $ids) as $r) {
                $recipients[(int) $r['message_id']][] = ['id' => $r['id'], 'name' => $r['display_name']];
            }
        }

        return [
            'messages' => array_map(static fn (array $r): array => self::payload($r, $recipients[(int) $r['id']] ?? []), $rows),
            'unread' => self::unreadByThread($params['id'], $user['id']),
        ];
    }

    /** @param array{id:string} $user */
    public static function send(Request $req, array $params, array $user): Response
    {
        $role = Access::requireMember($user, $params['id']);
        RateLimiter::hit('message:' . $user['id'], 40, 60);
        $data = $req->json();
        $body = Input::string($data, 'body', 1, self::MAX_BODY, 'Zpráva');

        $to = $data['to'] ?? null;
        $recipientIds = [];
        $thread = 'group';
        if ($to !== 'all') {
            if (!is_array($to) || $to === [] || count($to) > 50) {
                throw HttpError::validation("Zadej příjemce: 'all' nebo seznam členů kampaně.", 'to');
            }
            foreach ($to as $id) {
                if (!is_string($id) || !Ids::isUuid($id)) {
                    throw HttpError::validation('Neplatný příjemce.', 'to');
                }
                $recipientIds[] = $id;
            }
            $recipientIds = array_values(array_unique($recipientIds));

            if ($role !== 'dm') {
                // Hráč smí soukromě psát jen DM (a jen jednomu).
                if (count($recipientIds) !== 1 || Access::role($recipientIds[0], $params['id']) !== 'dm') {
                    throw HttpError::forbidden('Hráč může soukromě psát jen DM.');
                }
                $thread = 'dm:' . $user['id'];
            } else {
                foreach ($recipientIds as $id) {
                    if ($id === $user['id']) {
                        throw HttpError::validation('Sám sobě psát nemusíš.', 'to');
                    }
                    if (Access::role($id, $params['id']) !== 'player') {
                        throw HttpError::validation('Příjemce musí být hráč z této kampaně.', 'to');
                    }
                }
                $thread = count($recipientIds) === 1 ? 'dm:' . $recipientIds[0] : 'secret';
            }
        }

        $id = Db::transaction(static function () use ($params, $user, $thread, $body, $recipientIds): int {
            Db::exec(
                'INSERT INTO messages (campaign_id, sender_id, thread, body, created_at) VALUES (?, ?, ?, ?, UTC_TIMESTAMP())',
                [$params['id'], $user['id'], $thread, $body],
            );
            $id = (int) Db::pdo()->lastInsertId();
            foreach ($recipientIds as $rid) {
                Db::exec('INSERT INTO message_recipients (message_id, user_id) VALUES (?, ?)', [$id, $rid]);
            }
            return $id;
        });

        $row = Db::one(
            'SELECT m.id, m.sender_id, m.thread, m.body, m.created_at, u.display_name AS sender_name FROM messages m JOIN users u ON u.id = m.sender_id WHERE m.id = ?',
            [$id],
        ) ?? [];
        $names = Db::all('SELECT u.id, u.display_name FROM message_recipients r JOIN users u ON u.id = r.user_id WHERE r.message_id = ? ORDER BY u.display_name', [$id]);
        return Response::json(['message' => self::payload($row, array_map(static fn (array $r): array => ['id' => $r['id'], 'name' => $r['display_name']], $names))], 201);
    }

    /** Označí vlákno jako přečtené po poslední zprávu, kterou uživatel vidí (klient číslo neposílá, server si ho spočítá sám). @param array{id:string} $user */
    public static function markRead(Request $req, array $params, array $user): array
    {
        Access::requireMember($user, $params['id']);
        $thread = $req->json()['thread'] ?? null;
        if (!is_string($thread) || preg_match('/^(group|secret|dm:[0-9a-f-]{36})$/', $thread) !== 1) {
            throw HttpError::validation('Neplatné vlákno.', 'thread');
        }
        $max = Db::value(
            'SELECT MAX(m.id) FROM messages m WHERE m.campaign_id = ? AND m.thread = ? AND ' . self::visibleSql(),
            [$params['id'], $thread, ...self::visibleArgs($user['id'])],
        );
        if ($max !== null) {
            Db::exec(
                'INSERT INTO message_reads (campaign_id, user_id, thread, last_read_id) VALUES (?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE last_read_id = GREATEST(last_read_id, VALUES(last_read_id))',
                [$params['id'], $user['id'], $thread, (int) $max],
            );
        }
        return ['unread' => self::unreadByThread($params['id'], $user['id'])];
    }

    /** Nepřečtené zprávy napříč všemi kampaněmi uživatele (pro odznak v hlavičce). @param array{id:string} $user */
    public static function unreadOverview(Request $req, array $params, array $user): array
    {
        $rows = Db::all(
            'SELECT m.campaign_id, c.name, COUNT(*) AS n
             FROM messages m
             JOIN campaign_members cm ON cm.campaign_id = m.campaign_id AND cm.user_id = ?
             JOIN campaigns c ON c.id = m.campaign_id
             LEFT JOIN message_reads rd ON rd.campaign_id = m.campaign_id AND rd.user_id = ? AND rd.thread = m.thread
             WHERE m.sender_id <> ? AND m.id > COALESCE(rd.last_read_id, 0) AND ' . self::visibleSql() . '
             GROUP BY m.campaign_id, c.name ORDER BY c.name',
            [$user['id'], $user['id'], $user['id'], ...self::visibleArgs($user['id'])],
        );
        $campaigns = array_map(static fn (array $r): array => ['campaignId' => $r['campaign_id'], 'name' => $r['name'], 'unread' => (int) $r['n']], $rows);
        return ['total' => array_sum(array_column($campaigns, 'unread')), 'campaigns' => $campaigns];
    }

    // ------------------------------------------------------------------ pomocné

    /** @return array<string, int> počet nepřečtených zpráv (cizích) po vláknech */
    private static function unreadByThread(string $campaignId, string $userId): array
    {
        $rows = Db::all(
            'SELECT m.thread, COUNT(*) AS n
             FROM messages m
             LEFT JOIN message_reads rd ON rd.campaign_id = m.campaign_id AND rd.user_id = ? AND rd.thread = m.thread
             WHERE m.campaign_id = ? AND m.sender_id <> ? AND m.id > COALESCE(rd.last_read_id, 0) AND ' . self::visibleSql() . '
             GROUP BY m.thread',
            [$userId, $campaignId, $userId, ...self::visibleArgs($userId)],
        );
        $out = [];
        foreach ($rows as $r) {
            $out[(string) $r['thread']] = (int) $r['n'];
        }
        return $out;
    }

    /**
     * @param array<string, mixed> $r
     * @param list<array{id:string,name:string}> $recipients
     * @return array<string, mixed>
     */
    private static function payload(array $r, array $recipients): array
    {
        return [
            'id' => (int) $r['id'],
            'senderId' => $r['sender_id'],
            'senderName' => $r['sender_name'],
            'thread' => $r['thread'],
            'recipients' => $recipients,
            'body' => $r['body'],
            'createdAt' => Ids::iso((string) $r['created_at']),
        ];
    }
}
