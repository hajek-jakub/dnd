<?php

declare(strict_types=1);

namespace Dnd;

use DateTimeImmutable;
use DateTimeZone;

/**
 * Plánování session: místní čas, oznámení vybraného termínu a připomínka den předem.
 *
 * Datum a čas session jsou místní (`timezone` v konfiguraci, výchozí Europe/Prague), zbytek aplikace je v UTC.
 * Připomínka (oznámení v aplikaci + push, kategorie `sessions`) se pošle jednou: den předem od `session_reminder_hour` (výchozí 17:00)
 * a kdyby se k tomu nikdo nedostal, tak ještě v den session. Hosting nemá cron, takže ji spouští každý dotaz `/summary` (aplikace je otevřená
 * pořád někomu) a `POST /admin/reminders` pro externí pravidelné volání. Atomický zápis `reminded_at` zaručí, že se neodešle dvakrát.
 */
final class Sessions
{
    public const MAX_PER_CAMPAIGN = 300;

    public static function zone(): DateTimeZone
    {
        $name = (string) Config::get('timezone', 'Europe/Prague');
        try {
            return new DateTimeZone($name);
        } catch (\Exception) {
            return new DateTimeZone('Europe/Prague');
        }
    }

    public static function now(): DateTimeImmutable
    {
        return new DateTimeImmutable('now', self::zone());
    }

    /** Dnešní místní datum (YYYY-MM-DD). */
    public static function today(?DateTimeImmutable $now = null): string
    {
        return ($now ?? self::now())->format('Y-m-d');
    }

    public static function validDate(mixed $value): bool
    {
        if (!is_string($value) || preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $value, $m) !== 1) {
            return false;
        }
        return checkdate((int) $m[2], (int) $m[3], (int) $m[1]);
    }

    /** Čitelné datum pro oznámení: „so 25. 10. 2026 v 18:00“. */
    public static function label(string $date, ?string $time): string
    {
        $d = new DateTimeImmutable($date, new DateTimeZone('UTC'));
        $days = ['ne', 'po', 'út', 'st', 'čt', 'pá', 'so'];
        return $days[(int) $d->format('w')] . ' ' . (int) $d->format('j') . '. ' . (int) $d->format('n') . '. ' . $d->format('Y') . ($time !== null && $time !== '' ? ' v ' . $time : '');
    }

    /** @return list<string> id všech členů kampaně */
    public static function memberIds(string $campaignId): array
    {
        return array_map(static fn (array $r): string => (string) $r['user_id'], Db::all('SELECT user_id FROM campaign_members WHERE campaign_id = ?', [$campaignId]));
    }

    /** Oznámení v aplikaci a push všem členům kromě `$exceptUserId` (ten, kdo změnu udělal). */
    public static function notify(string $campaignId, string $text, string $tag, ?string $exceptUserId): void
    {
        $to = array_values(array_diff(self::memberIds($campaignId), $exceptUserId === null ? [] : [$exceptUserId]));
        foreach ($to as $userId) {
            Db::exec(
                "INSERT INTO notifications (user_id, campaign_id, character_id, kind, text, created_at) VALUES (?, ?, NULL, 'session', ?, UTC_TIMESTAMP())",
                [$userId, $campaignId, mb_substr($text, 0, 400)],
            );
        }
        Push::queue($to, 'sessions', $campaignId, $text, 'campaigns/' . $campaignId . '/calendar', $tag);
    }

    /** Je pro session v tento den připomínka už „na řadě“? Nově zadanou session v tomto okně připomínat nemá smysl, oznámení stačí. */
    public static function reminderWindowOpen(string $date, ?DateTimeImmutable $now = null): bool
    {
        $now ??= self::now();
        $hour = max(0, min(23, (int) Config::get('session_reminder_hour', 17)));
        return $date === $now->format('Y-m-d') || ($date === $now->modify('+1 day')->format('Y-m-d') && (int) $now->format('G') >= $hour);
    }

    /**
     * Pošle připomínky, které už mají přijít. Idempotentní a levné (jeden indexovaný dotaz), takže ho smí volat každý požadavek.
     * @return int počet odeslaných připomínek
     */
    public static function remindDue(?DateTimeImmutable $now = null): int
    {
        $now ??= self::now();
        $today = $now->format('Y-m-d');
        $tomorrow = $now->modify('+1 day')->format('Y-m-d');
        $hour = max(0, min(23, (int) Config::get('session_reminder_hour', 17)));
        // Zítřejší session se připomíná od večera dne předem, dnešní (kdyby večerní připomínka vypadla) hned.
        $dates = $now->format('G') >= $hour ? [$today, $tomorrow] : [$today];
        $in = implode(',', array_fill(0, count($dates), '?'));
        $due = Db::all("SELECT * FROM game_sessions WHERE reminded_at IS NULL AND session_date IN ($in)", $dates);
        $sent = 0;
        foreach ($due as $s) {
            // Kdo to vezme první, ten posílá; souběžný požadavek už neprojde. Selže-li oznámení, značka se vrátí s transakcí.
            $sent += (int) Db::transaction(static function () use ($s, $today): bool {
                if (Db::exec('UPDATE game_sessions SET reminded_at = UTC_TIMESTAMP() WHERE id = ? AND reminded_at IS NULL', [$s['id']]) !== 1) {
                    return false;
                }
                $when = (string) $s['session_date'] === $today ? 'Dnes' : 'Zítra';
                $time = (string) ($s['session_time'] ?? '');
                self::notify((string) $s['campaign_id'], $when . ' hrajeme' . ($time !== '' ? ' v ' . $time : '') . ' (' . self::label((string) $s['session_date'], null) . ').', 'session-' . $s['id'], null);
                return true;
            });
        }
        return $sent;
    }
}
