<?php

declare(strict_types=1);

namespace Dnd;

final class Auth
{
    public const COOKIE = 'dnd_session';
    private const SESSION_DAYS = 30;

    /** @return array{id:string,username:string,display_name:string}|null */
    public static function currentUser(Request $request): ?array
    {
        $token = $request->cookie(self::COOKIE);
        if ($token === null || preg_match('/^[0-9a-f]{64}$/', $token) !== 1) {
            return null;
        }
        $hash = hash('sha256', $token);
        $row = Db::one(
            'SELECT u.id, u.username, u.display_name, u.accent, s.last_seen
             FROM sessions s JOIN users u ON u.id = s.user_id
             WHERE s.token_hash = ? AND s.expires_at > UTC_TIMESTAMP()',
            [$hash],
        );
        if ($row === null) {
            return null;
        }
        // Klouzavé prodlužování platnosti, zapisuje se jen občas (ne při každém požadavku).
        if (strtotime((string) $row['last_seen'] . ' UTC') < time() - 3600) {
            Db::exec(
                'UPDATE sessions SET last_seen = UTC_TIMESTAMP(), expires_at = DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? DAY)
                 WHERE token_hash = ?',
                [self::SESSION_DAYS, $hash],
            );
            self::setCookie($token, $request->https);
        }
        return ['id' => $row['id'], 'username' => $row['username'], 'display_name' => $row['display_name'], 'accent' => $row['accent']];
    }

    /** @return array{id:string,username:string,display_name:string} */
    public static function requireUser(Request $request): array
    {
        return self::currentUser($request) ?? throw HttpError::unauthorized();
    }

    public static function startSession(string $userId, Request $request): void
    {
        Db::exec('DELETE FROM sessions WHERE expires_at <= UTC_TIMESTAMP()');
        $token = bin2hex(random_bytes(32));
        Db::exec(
            'INSERT INTO sessions (token_hash, user_id, created_at, last_seen, expires_at)
             VALUES (?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP(), DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? DAY))',
            [hash('sha256', $token), $userId, self::SESSION_DAYS],
        );
        self::setCookie($token, $request->https);
    }

    public static function endSession(Request $request): void
    {
        $token = $request->cookie(self::COOKIE);
        if ($token !== null && preg_match('/^[0-9a-f]{64}$/', $token) === 1) {
            Db::exec('DELETE FROM sessions WHERE token_hash = ?', [hash('sha256', $token)]);
        }
        setcookie(self::COOKIE, '', [
            'expires' => 1,
            'path' => '/',
            'secure' => $request->https,
            'httponly' => true,
            'samesite' => 'Lax',
        ]);
    }

    private static function setCookie(string $token, bool $secure): void
    {
        setcookie(self::COOKIE, $token, [
            'expires' => time() + self::SESSION_DAYS * 86400,
            'path' => '/',
            'secure' => $secure,
            'httponly' => true,
            'samesite' => 'Lax',
        ]);
    }

    public static function validatePassword(string $password): void
    {
        if (mb_strlen($password) < 8) {
            throw HttpError::validation('Heslo musí mít aspoň 8 znaků.', 'password');
        }
        // bcrypt zpracuje jen prvních 72 bajtů; delší heslo by bylo tiše oříznuté.
        if (strlen($password) > 72) {
            throw HttpError::validation('Heslo může mít nejvýš 72 bajtů (cca 72 znaků bez diakritiky).', 'password');
        }
    }

    public static function hashPassword(string $password): string
    {
        return password_hash($password, PASSWORD_DEFAULT);
    }

    /** @param array{id:string,username:string,display_name:string} $user */
    public static function payload(array $user): array
    {
        return [
            'id' => $user['id'],
            'username' => $user['username'],
            'displayName' => $user['display_name'],
            'accent' => $user['accent'] ?? null,
        ];
    }
}
