<?php

declare(strict_types=1);

namespace Dnd;

use Throwable;

/**
 * Push notifikace: kdy a komu se posílají. Šifrování a odeslání je ve `WebPush`.
 *
 * Pravidla:
 * - Push dostane jen ten, kdo nemá aplikaci právě otevřenou (viz `touch` a `push_presence_seconds`); co se děje v otevřené aplikaci, ukáže aplikace sama.
 * - Uživatel si pro každé zařízení vybírá kategorie (zprávy, změny od DM, mapy, deník). Hody kostkou push nikdy neposílají.
 * - Posílá se až po odeslání odpovědi (`flush` z `App::run`) a ne uvnitř transakce; vrácená transakce zařazené push zahodí (`rewind`).
 * - Chyba při odeslání nikdy nesmí shodit ani zpomalit požadavek, kvůli kterému push vznikl.
 */
final class Push
{
    /** Kategorie, které si uživatel zapíná a vypíná. */
    public const CATEGORIES = ['messages', 'dm', 'maps', 'journal', 'sessions'];

    /** Jak dlouho po posledním dotazu aplikace (jednou za ~6 s, jen viditelné okno) se uživatel považuje za „aplikace je otevřená“: `push_presence_seconds`, výchozí 12. */
    private const MAX_PER_USER = 10;
    private const MAX_JOBS = 300;

    /** Služby, které smí server volat. Adresu odběru dodává klient, takže bez seznamu by šlo server nechat volat libovolné adresy. */
    private const HOST_SUFFIXES = ['.push.services.mozilla.com', '.push.apple.com', '.notify.windows.com'];
    private const HOSTS = ['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com'];

    /** @var list<array{users: list<string>, category: string, campaignId: string, body: string, url: string, tag: string}> */
    private static array $queue = [];

    public static function available(): bool
    {
        return WebPush::supported();
    }

    // ------------------------------------------------------------------ fronta

    /**
     * Zařadí push; odešle se po odpovědi na požadavek. Odesílatele a nečleny kampaně musí vyloučit volající.
     * @param list<string> $userIds
     * @param string $url  adresa uvnitř aplikace (bez úvodního lomítka), kam klepnutí na notifikaci vede
     * @param string $tag  stejný štítek nahradí starší notifikaci (např. další zpráva ve stejném vlákně)
     */
    public static function queue(array $userIds, string $category, string $campaignId, string $body, string $url, string $tag): void
    {
        $userIds = array_values(array_unique(array_filter($userIds, static fn ($u): bool => is_string($u) && $u !== '')));
        if ($userIds === [] || !in_array($category, self::CATEGORIES, true)) {
            return;
        }
        $item = ['users' => $userIds, 'category' => $category, 'campaignId' => $campaignId, 'body' => mb_substr($body, 0, 200), 'url' => $url, 'tag' => $tag];
        if (!in_array($item, self::$queue, true)) {
            self::$queue[] = $item;
        }
    }

    public static function pending(): bool
    {
        return self::$queue !== [];
    }

    /** Stav fronty před transakcí; po jejím vrácení `rewind` zahodí push, které vznikly uvnitř. */
    public static function mark(): int
    {
        return count(self::$queue);
    }

    public static function rewind(int $mark): void
    {
        array_splice(self::$queue, $mark);
    }

    /** Odešle všechno ve frontě. Volá se až po odeslání odpovědi klientovi. */
    public static function flush(): void
    {
        if (self::$queue === []) {
            return;
        }
        $items = self::$queue;
        self::$queue = [];
        try {
            self::deliver($items);
        } catch (Throwable $e) {
            error_log('[dnd] push: ' . $e::class . ': ' . $e->getMessage());
        }
    }

    // ------------------------------------------------------------------ přítomnost

    /** Uživatel má otevřenou aplikaci (volá `/summary`, které se ptá jen viditelné okno). */
    public static function touch(string $userId): void
    {
        Db::exec(
            'INSERT INTO user_presence (user_id, seen_at) VALUES (?, UTC_TIMESTAMP()) ON DUPLICATE KEY UPDATE seen_at = UTC_TIMESTAMP()',
            [$userId],
        );
    }

    // ------------------------------------------------------------------ odběry

    /** Smí server volat tuto adresu? https a jen známé push služby (v testech navíc napodobený server z `push_test_hosts`). */
    public static function endpointAllowed(string $endpoint): bool
    {
        if (strlen($endpoint) > 1000) {
            return false;
        }
        $parts = parse_url($endpoint);
        if (!is_array($parts) || !isset($parts['scheme'], $parts['host']) || isset($parts['user']) || isset($parts['pass'])) {
            return false;
        }
        $host = strtolower((string) $parts['host']);
        foreach (self::testHosts() as $allowed) {
            if (strtolower($allowed) === $host . (isset($parts['port']) ? ':' . $parts['port'] : '')) {
                return in_array($parts['scheme'], ['http', 'https'], true);
            }
        }
        if ($parts['scheme'] !== 'https' || (isset($parts['port']) && (int) $parts['port'] !== 443)) {
            return false;
        }
        if (in_array($host, self::HOSTS, true)) {
            return true;
        }
        foreach (self::HOST_SUFFIXES as $suffix) {
            if (str_ends_with($host, $suffix)) {
                return true;
            }
        }
        return false;
    }

    /** @return list<string> */
    private static function testHosts(): array
    {
        $hosts = Config::get('push_test_hosts', []);
        return is_array($hosts) ? array_values(array_filter($hosts, 'is_string')) : [];
    }

    /** Uloží nebo převezme odběr zařízení. Jedno zařízení (adresa) má vždy jediného majitele. */
    public static function subscribe(string $userId, string $endpoint, string $p256dh, string $auth, ?string $categories, string $userAgent): void
    {
        $hash = hash('sha256', $endpoint);
        $existing = Db::one('SELECT id, user_id FROM push_subscriptions WHERE endpoint_hash = ?', [$hash]);
        $ua = mb_substr($userAgent, 0, 200);
        if ($existing === null) {
            Db::exec(
                'INSERT INTO push_subscriptions (id, user_id, endpoint, endpoint_hash, p256dh, auth, categories, user_agent, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())',
                [Ids::uuid(), $userId, $endpoint, $hash, $p256dh, $auth, $categories ?? implode(',', self::CATEGORIES), $ua],
            );
            // Víc než pár zařízení na uživatele nedává smysl; nejstarší se zahodí.
            $old = Db::all('SELECT id FROM push_subscriptions WHERE user_id = ? ORDER BY updated_at DESC, created_at DESC LIMIT 1000 OFFSET ' . self::MAX_PER_USER, [$userId]);
            foreach ($old as $row) {
                Db::exec('DELETE FROM push_subscriptions WHERE id = ?', [$row['id']]);
            }
            return;
        }
        // Převzetí cizího odběru (sdílené zařízení): kategorie se vrátí na výchozí, ať nezdědí volbu předchozího uživatele.
        $takeover = (string) $existing['user_id'] !== $userId;
        Db::exec(
            'UPDATE push_subscriptions SET user_id = ?, p256dh = ?, auth = ?, categories = COALESCE(?, categories), user_agent = ?, updated_at = UTC_TIMESTAMP() WHERE id = ?',
            [$userId, $p256dh, $auth, $categories ?? ($takeover ? implode(',', self::CATEGORIES) : null), $ua, $existing['id']],
        );
    }

    /** @param list<string> $categories */
    public static function normalizeCategories(array $categories): string
    {
        return implode(',', array_values(array_intersect(self::CATEGORIES, $categories)));
    }

    // ------------------------------------------------------------------ odeslání

    /** Zkušební push na všechna zařízení uživatele (bez ohledu na otevřenou aplikaci a kategorie). @return array{sent: int, failed: int} */
    public static function sendTest(string $userId): array
    {
        $subs = Db::all('SELECT * FROM push_subscriptions WHERE user_id = ?', [$userId]);
        $payload = ['title' => 'D&D kampaň', 'body' => 'Push notifikace fungují.', 'url' => '', 'tag' => 'push-test', 'category' => 'test'];
        return self::send(array_map(static fn (array $sub): array => ['sub' => $sub, 'payload' => $payload], $subs));
    }

    /**
     * @param list<array{users: list<string>, category: string, campaignId: string, body: string, url: string, tag: string}> $items
     */
    private static function deliver(array $items): void
    {
        if (!self::available()) {
            return;
        }
        $userIds = [];
        $campaignIds = [];
        foreach ($items as $item) {
            array_push($userIds, ...$item['users']);
            $campaignIds[$item['campaignId']] = true;
        }
        $userIds = array_values(array_unique($userIds));

        $present = [];
        $in = implode(',', array_fill(0, count($userIds), '?'));
        foreach (Db::all("SELECT user_id FROM user_presence WHERE user_id IN ($in) AND seen_at > UTC_TIMESTAMP() - INTERVAL " . max(1, (int) Config::get('push_presence_seconds', 12)) . ' SECOND', $userIds) as $row) {
            $present[(string) $row['user_id']] = true;
        }
        $targets = array_values(array_filter($userIds, static fn (string $u): bool => !isset($present[$u])));
        if ($targets === []) {
            return;
        }
        $in = implode(',', array_fill(0, count($targets), '?'));
        $subsByUser = [];
        foreach (Db::all("SELECT * FROM push_subscriptions WHERE user_id IN ($in)", $targets) as $sub) {
            $subsByUser[(string) $sub['user_id']][] = $sub;
        }
        if ($subsByUser === []) {
            return;
        }
        $names = [];
        $cin = implode(',', array_fill(0, count($campaignIds), '?'));
        foreach (Db::all("SELECT id, name FROM campaigns WHERE id IN ($cin)", array_keys($campaignIds)) as $c) {
            $names[(string) $c['id']] = (string) $c['name'];
        }

        // Jedno zařízení dostane jednu notifikaci na štítek (poslední vyhrává), i když jich v požadavku vzniklo víc.
        /** @var array<string, array{sub: array<string, mixed>, payload: array<string, string>}> $jobs */
        $jobs = [];
        foreach ($items as $item) {
            foreach ($item['users'] as $uid) {
                foreach ($subsByUser[$uid] ?? [] as $sub) {
                    if (!in_array($item['category'], explode(',', (string) $sub['categories']), true)) {
                        continue;
                    }
                    $jobs[$sub['id'] . '|' . $item['tag']] = ['sub' => $sub, 'payload' => [
                        'title' => $names[$item['campaignId']] ?? 'D&D kampaň',
                        'body' => $item['body'],
                        'url' => $item['url'],
                        'tag' => $item['tag'],
                        'category' => $item['category'],
                    ]];
                }
            }
        }
        self::send(array_slice(array_values($jobs), 0, self::MAX_JOBS));
    }

    /**
     * Zašifruje obsah pro každé zařízení a odešle všechno najednou.
     * @param list<array{sub: array<string, mixed>, payload: array<string, string>}> $queued
     * @return array{sent: int, failed: int}
     */
    private static function send(array $queued): array
    {
        if ($queued === [] || !self::available()) {
            return ['sent' => 0, 'failed' => count($queued)];
        }
        $keys = self::keys();
        $subject = (string) Config::get('vapid_subject', 'mailto:admin@hajekjakub.cz');
        $audiences = [];
        $jobs = [];
        $subIds = [];
        $failed = 0;
        foreach ($queued as $entry) {
            $sub = $entry['sub'];
            $endpoint = (string) $sub['endpoint'];
            $parts = parse_url($endpoint);
            if (!self::endpointAllowed($endpoint) || !is_array($parts)) {
                $failed++;
                continue;
            }
            $audience = $parts['scheme'] . '://' . $parts['host'] . (isset($parts['port']) ? ':' . $parts['port'] : '');
            try {
                $body = WebPush::encrypt(
                    (string) json_encode($entry['payload'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
                    (string) WebPush::unb64u((string) $sub['p256dh']),
                    (string) WebPush::unb64u((string) $sub['auth']),
                );
                $audiences[$audience] ??= WebPush::vapidHeader($audience, $subject, $keys['pem'], $keys['public']);
            } catch (Throwable $e) {
                error_log('[dnd] push: ' . $e->getMessage());
                $failed++;
                continue;
            }
            $jobs[] = [
                'url' => $endpoint,
                'body' => $body,
                'headers' => [
                    'Authorization: ' . $audiences[$audience],
                    'Content-Encoding: aes128gcm',
                    'Content-Type: application/octet-stream',
                    'Content-Length: ' . strlen($body),
                    'TTL: 86400',
                    'Urgency: normal',
                ],
            ];
            $subIds[] = (string) $sub['id'];
        }
        $sent = 0;
        foreach (WebPush::sendAll($jobs, self::testHosts() !== []) as $i => $result) {
            if ($result['status'] >= 200 && $result['status'] < 300) {
                $sent++;
                continue;
            }
            $failed++;
            // 404 a 410: zařízení odběr zrušilo (odinstalovaná aplikace, odepřené oprávnění), dál ho zbytečně nezkoušíme.
            if ($result['status'] === 404 || $result['status'] === 410) {
                Db::exec('DELETE FROM push_subscriptions WHERE id = ?', [$subIds[$i]]);
            } else {
                error_log('[dnd] push: ' . ($result['status'] > 0 ? 'HTTP ' . $result['status'] : $result['error']));
            }
        }
        return ['sent' => $sent, 'failed' => $failed];
    }

    // ------------------------------------------------------------------ klíč VAPID

    /** @return array{pem: string, public: string} */
    private static function keys(): array
    {
        $row = Db::value("SELECT value FROM app_secrets WHERE name = 'vapid'");
        if (!is_string($row)) {
            $key = WebPush::newKey();
            // Při souběhu vyhraje první zapsaný klíč, ostatní si ho načtou.
            Db::exec("INSERT IGNORE INTO app_secrets (name, value, created_at) VALUES ('vapid', ?, UTC_TIMESTAMP())", [json_encode(['pem' => $key['pem'], 'public' => WebPush::b64u($key['public'])])]);
            $row = (string) Db::value("SELECT value FROM app_secrets WHERE name = 'vapid'");
        }
        $data = json_decode($row, true);
        return ['pem' => (string) ($data['pem'] ?? ''), 'public' => (string) WebPush::unb64u((string) ($data['public'] ?? ''))];
    }

    /** Veřejný klíč VAPID (base64url), který prohlížeč potřebuje k přihlášení odběru. */
    public static function publicKey(): ?string
    {
        if (!self::available()) {
            return null;
        }
        return WebPush::b64u(self::keys()['public']);
    }
}
