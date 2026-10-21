<?php

declare(strict_types=1);

namespace Dnd\Controllers;

use Dnd\Db;
use Dnd\HttpError;
use Dnd\Push;
use Dnd\RateLimiter;
use Dnd\Request;
use Dnd\Response;
use Dnd\WebPush;

/**
 * Push notifikace přihlášeného uživatele. Odběr patří zařízení (adrese od prohlížeče) a vždy právě jednomu uživateli;
 * každý vidí a mění jen svoje odběry (cizí adresa se chová jako neexistující).
 */
final class PushController
{
    /** Veřejný klíč VAPID a to, jestli server push vůbec umí (OpenSSL a cURL). @param array{id:string} $user */
    public static function config(Request $req, array $params, array $user): array
    {
        return ['available' => Push::available(), 'publicKey' => Push::publicKey(), 'categories' => Push::CATEGORIES];
    }

    /** Odběr tohoto zařízení (podle adresy); null, když ho uživatel nemá. @param array{id:string} $user */
    public static function show(Request $req, array $params, array $user): array
    {
        $row = self::own(self::endpointFromQuery($req), $user['id']);
        return ['subscription' => $row === null ? null : self::payload($row)];
    }

    /** Přihlásí zařízení k odběru (nebo ho obnoví; zařízení dosud patřící jinému účtu převezme). @param array{id:string} $user */
    public static function subscribe(Request $req, array $params, array $user): Response
    {
        RateLimiter::hit('push-sub:' . $user['id'], 30, 3600);
        if (!Push::available()) {
            throw HttpError::validation('Server push notifikace neumí (chybí OpenSSL nebo cURL).');
        }
        $data = $req->json();
        $endpoint = self::endpoint($data['endpoint'] ?? null);
        $keys = $data['keys'] ?? null;
        $p256dh = is_array($keys) && is_string($keys['p256dh'] ?? null) ? $keys['p256dh'] : '';
        $auth = is_array($keys) && is_string($keys['auth'] ?? null) ? $keys['auth'] : '';
        $point = WebPush::unb64u($p256dh);
        if ($point === null || WebPush::publicKeyFromRaw($point) === null) {
            throw HttpError::validation('Neplatný klíč zařízení.', 'keys');
        }
        $secret = WebPush::unb64u($auth);
        if ($secret === null || strlen($secret) !== 16) {
            throw HttpError::validation('Neplatné tajemství zařízení.', 'keys');
        }
        $categories = array_key_exists('categories', $data) ? self::categories($data['categories']) : null;

        Push::subscribe($user['id'], $endpoint, $p256dh, $auth, $categories, (string) ($req->headers['user-agent'] ?? ''));
        return Response::json(['subscription' => self::payload(self::own($endpoint, $user['id']) ?? [])], 201);
    }

    /** Změní kategorie notifikací pro toto zařízení. @param array{id:string} $user */
    public static function update(Request $req, array $params, array $user): array
    {
        $data = $req->json();
        $endpoint = self::endpoint($data['endpoint'] ?? null);
        $row = self::own($endpoint, $user['id']);
        if ($row === null) {
            throw HttpError::notFound('Odběr nenalezen.');
        }
        Db::exec('UPDATE push_subscriptions SET categories = ?, updated_at = UTC_TIMESTAMP() WHERE id = ?', [self::categories($data['categories'] ?? null), $row['id']]);
        return ['subscription' => self::payload(self::own($endpoint, $user['id']) ?? [])];
    }

    /** Zruší odběr tohoto zařízení (odhlášení, vypnutí v nastavení). @param array{id:string} $user */
    public static function unsubscribe(Request $req, array $params, array $user): Response
    {
        $row = self::own(self::endpointFromQuery($req), $user['id']);
        if ($row !== null) {
            Db::exec('DELETE FROM push_subscriptions WHERE id = ?', [$row['id']]);
        }
        return Response::noContent();
    }

    /** Pošle zkušební notifikaci na všechna zařízení uživatele (bez ohledu na otevřenou aplikaci a kategorie). @param array{id:string} $user */
    public static function test(Request $req, array $params, array $user): array
    {
        RateLimiter::hit('push-test:' . $user['id'], 6, 60);
        if (!Push::available()) {
            throw HttpError::validation('Server push notifikace neumí (chybí OpenSSL nebo cURL).');
        }
        if ((int) Db::value('SELECT COUNT(*) FROM push_subscriptions WHERE user_id = ?', [$user['id']]) === 0) {
            throw HttpError::validation('Nemáš zapnuté žádné zařízení.');
        }
        return Push::sendTest($user['id']);
    }

    // ------------------------------------------------------------------

    private static function endpointFromQuery(Request $req): string
    {
        return self::endpoint($req->query['endpoint'] ?? null);
    }

    private static function endpoint(mixed $value): string
    {
        if (!is_string($value) || !Push::endpointAllowed($value)) {
            throw HttpError::validation('Neplatná adresa odběru.', 'endpoint');
        }
        return $value;
    }

    /** @return string  kategorie ve výchozím pořadí, oddělené čárkou */
    private static function categories(mixed $value): string
    {
        if (!is_array($value)) {
            throw HttpError::validation('Kategorie musí být seznam.', 'categories');
        }
        foreach ($value as $c) {
            if (!is_string($c) || !in_array($c, Push::CATEGORIES, true)) {
                throw HttpError::validation('Neznámá kategorie notifikací.', 'categories');
            }
        }
        return Push::normalizeCategories($value);
    }

    /** @return array<string, mixed>|null */
    private static function own(string $endpoint, string $userId): ?array
    {
        return Db::one('SELECT * FROM push_subscriptions WHERE endpoint_hash = ? AND user_id = ?', [hash('sha256', $endpoint), $userId]);
    }

    /** @param array<string, mixed> $row */
    private static function payload(array $row): array
    {
        return [
            'categories' => $row === [] ? [] : array_values(array_filter(explode(',', (string) $row['categories']), static fn (string $c): bool => $c !== '')),
            'createdAt' => $row === [] ? null : \Dnd\Ids::iso((string) $row['created_at']),
        ];
    }
}
