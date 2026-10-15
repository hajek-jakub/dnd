<?php

declare(strict_types=1);

namespace Dnd;

final class Invites
{
    /**
     * Najde platnou pozvánku (nezrušená, nevypršelá, nevyčerpaná).
     * @return array<string, mixed>|null
     */
    public static function findValid(string $rawCode, bool $forUpdate = false): ?array
    {
        $code = Ids::normalizeInviteCode($rawCode);
        if (preg_match('/^[A-HJKMNP-Z2-9]{10}$/', $code) !== 1) {
            return null;
        }
        return Db::one(
            'SELECT i.id, i.campaign_id, i.uses, i.max_uses
             FROM invites i
             WHERE i.code = ? AND i.revoked = 0
               AND (i.expires_at IS NULL OR i.expires_at > UTC_TIMESTAMP())
               AND (i.max_uses IS NULL OR i.uses < i.max_uses)' . ($forUpdate ? ' FOR UPDATE' : ''),
            [$code],
        );
    }

    /**
     * Přidá uživatele do kampaně jako hráče a spotřebuje pozvánku (jen pokud ještě členem není).
     * Musí běžet uvnitř transakce.
     * @param array<string, mixed> $invite  výsledek findValid()
     */
    public static function join(array $invite, string $userId): string
    {
        $campaignId = (string) $invite['campaign_id'];
        if (Access::isMember($userId, $campaignId)) {
            return $campaignId;
        }
        Db::exec(
            "INSERT INTO campaign_members (campaign_id, user_id, role, joined_at) VALUES (?, ?, 'player', UTC_TIMESTAMP())",
            [$campaignId, $userId],
        );
        Db::exec('UPDATE invites SET uses = uses + 1 WHERE id = ?', [$invite['id']]);
        return $campaignId;
    }
}
