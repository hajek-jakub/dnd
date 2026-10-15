<?php

declare(strict_types=1);

namespace Dnd\Controllers;

use Dnd\Db;
use Dnd\Ids;
use Dnd\Request;

/** Oznámení přihlášeného uživatele (vidí jen svoje). */
final class NotificationController
{
    /**
     * Posledních 50 oznámení a počet nepřečtených. `after` vrátí jen novější než dané id (průběžné dotazování).
     * @param array{id:string} $user
     */
    public static function index(Request $req, array $params, array $user): array
    {
        $after = max(0, (int) ($req->query['after'] ?? 0));
        $rows = Db::all(
            'SELECT n.id, n.campaign_id, n.character_id, n.kind, n.text, n.created_at, n.read_at, c.name AS campaign_name
             FROM notifications n JOIN campaigns c ON c.id = n.campaign_id
             WHERE n.user_id = ? AND n.id > ? ORDER BY n.id DESC LIMIT 50',
            [$user['id'], $after],
        );
        return [
            'notifications' => array_map(static fn (array $r): array => [
                'id' => (int) $r['id'],
                'campaignId' => $r['campaign_id'],
                'campaignName' => $r['campaign_name'],
                'characterId' => $r['character_id'],
                'kind' => $r['kind'],
                'text' => $r['text'],
                'createdAt' => Ids::iso((string) $r['created_at']),
                'read' => $r['read_at'] !== null,
            ], $rows),
            'unread' => (int) Db::value('SELECT COUNT(*) FROM notifications WHERE user_id = ? AND read_at IS NULL', [$user['id']]),
        ];
    }

    /** Označí oznámení jako přečtená (jen svoje), buď všechna, nebo do daného id. @param array{id:string} $user */
    public static function markRead(Request $req, array $params, array $user): array
    {
        $upTo = $req->json()['upToId'] ?? null;
        if (is_int($upTo) && $upTo > 0) {
            Db::exec('UPDATE notifications SET read_at = UTC_TIMESTAMP() WHERE user_id = ? AND read_at IS NULL AND id <= ?', [$user['id'], $upTo]);
        } else {
            Db::exec('UPDATE notifications SET read_at = UTC_TIMESTAMP() WHERE user_id = ? AND read_at IS NULL', [$user['id']]);
        }
        return ['unread' => (int) Db::value('SELECT COUNT(*) FROM notifications WHERE user_id = ? AND read_at IS NULL', [$user['id']])];
    }
}
