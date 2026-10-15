<?php

declare(strict_types=1);

namespace Dnd;

/** Jednoduchý počítadlový limit v DB (okno pevné délky). Chrání heslo a kódy pozvánek před hádáním. */
final class RateLimiter
{
    /** Zaznamená pokus a vyhodí 429, pokud je limit překročen. */
    public static function hit(string $key, int $max, int $windowSeconds): void
    {
        $key = substr(hash('sha256', $key), 0, 64);
        $now = time();

        $row = Db::one('SELECT window_start, hits FROM rate_limits WHERE rkey = ?', [$key]);
        if ($row === null || $now - (int) $row['window_start'] >= $windowSeconds) {
            Db::exec(
                'INSERT INTO rate_limits (rkey, window_start, hits) VALUES (?, ?, 1)
                 ON DUPLICATE KEY UPDATE window_start = VALUES(window_start), hits = 1',
                [$key, $now],
            );
            return;
        }
        if ((int) $row['hits'] >= $max) {
            throw HttpError::tooMany();
        }
        Db::exec('UPDATE rate_limits SET hits = hits + 1 WHERE rkey = ?', [$key]);
    }

    public static function clear(string $key): void
    {
        Db::exec('DELETE FROM rate_limits WHERE rkey = ?', [substr(hash('sha256', $key), 0, 64)]);
    }
}
