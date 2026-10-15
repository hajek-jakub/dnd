<?php

declare(strict_types=1);

namespace Dnd;

/** Oznámení pro hráče o změnách, které provedl DM (nebo jiný hráč). */
final class Notifications
{
    /** Zapíše oznámení, pokud příjemce není ten, kdo změnu udělal. */
    public static function push(string $userId, string $actorId, string $campaignId, ?string $characterId, string $kind, string $text): void
    {
        if ($userId === $actorId) {
            return;
        }
        Db::exec(
            'INSERT INTO notifications (user_id, campaign_id, character_id, kind, text, created_at) VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP())',
            [$userId, $campaignId, $characterId, $kind, mb_substr($text, 0, 400)],
        );
    }
}
