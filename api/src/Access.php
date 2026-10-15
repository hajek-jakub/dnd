<?php

declare(strict_types=1);

namespace Dnd;

/**
 * Autorizace (náhrada RLS): každý přístup ke kampani a jejím datům prochází tudy.
 * Zásada: kdo není členem, nesmí ani poznat, že kampaň existuje (404).
 */
final class Access
{
    public static function role(string $userId, string $campaignId): ?string
    {
        if (!Ids::isUuid($campaignId)) {
            return null;
        }
        $role = Db::value(
            'SELECT role FROM campaign_members WHERE campaign_id = ? AND user_id = ?',
            [$campaignId, $userId],
        );
        return $role === null ? null : (string) $role;
    }

    /** @param array{id:string} $user  @return string role ('dm' | 'player') */
    public static function requireMember(array $user, string $campaignId): string
    {
        return self::role($user['id'], $campaignId) ?? throw HttpError::notFound('Kampaň nenalezena.');
    }

    /** @param array{id:string} $user */
    public static function requireDm(array $user, string $campaignId): void
    {
        if (self::requireMember($user, $campaignId) !== 'dm') {
            throw HttpError::forbidden('Tohle může dělat jen DM.');
        }
    }

    public static function isMember(string $userId, string $campaignId): bool
    {
        return self::role($userId, $campaignId) !== null;
    }
}
