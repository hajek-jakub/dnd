<?php

declare(strict_types=1);

namespace Dnd\Controllers;

use Dnd\Assistant;
use Dnd\Claude;
use Dnd\Config;
use Dnd\HttpError;
use Dnd\Items;
use Dnd\Migrator;
use Dnd\RateLimiter;
use Dnd\Request;
use Dnd\WebPush;
use Dnd\Response;
use Dnd\Seeder;
use PDOException;

final class AdminController
{
    /** Spustí čekající migrace. Volá ho deploy skript; chráněno klíčem z konfigurace. */
    public static function migrate(Request $req): Response
    {
        $key = (string) Config::get('migrate_key', '');
        if ($key === '') {
            throw HttpError::notFound();
        }
        if (!hash_equals($key, (string) $req->header('x-migrate-key'))) {
            try {
                // Na úplně prázdné databázi tabulka rate_limits ještě neexistuje; to nevadí.
                RateLimiter::hit('migrate:' . $req->ip, 20, 600);
            } catch (PDOException) {
            }
            throw HttpError::forbidden('Špatný klíč.');
        }
        return Response::json(['applied' => Migrator::migrate()]);
    }

    /**
     * Načte pravidla (SRD 5.1 + katalog itemů) do databáze; přeskočí se, pokud se data nezměnila.
     * Pokaždé (i bez změny dat) opraví dřív rozdané magické zbroje a zbraně bez hodnot (Items::repairMagicGear).
     */
    public static function seed(Request $req): Response
    {
        self::requireKey($req);
        $force = ($req->query['force'] ?? '') === '1';
        $repaired = Items::repairMagicGear();
        return Response::json(Seeder::run($force) + ['repaired' => count($repaired), 'repairedItems' => $repaired]);
    }

    /**
     * Kontrola prostředí serveru: verze PHP, GD pro obrázky, zapisovatelnost složky pro nahrané soubory, časový limit
     * a pro AI pomocníka cURL a spojení s Claude API (GET /v1/models nic nestojí; ukáže, jestli hosting pustí HTTPS ven a klíč platí).
     */
    public static function diagnostics(Request $req): Response
    {
        self::requireKey($req);
        $dir = Config::storageDir();
        $writable = false;
        if (is_dir($dir) || @mkdir($dir, 0755, true)) {
            $probe = $dir . '/.write-test-' . bin2hex(random_bytes(4));
            $writable = @file_put_contents($probe, 'ok') !== false;
            @unlink($probe);
        }
        return Response::json([
            'php' => PHP_VERSION,
            'gd' => function_exists('imagecreatefromstring') && function_exists('imagejpeg'),
            'storageWritable' => $writable,
            'uploadMaxFilesize' => (string) ini_get('upload_max_filesize'),
            'postMaxSize' => (string) ini_get('post_max_size'),
            'maxExecutionTime' => (int) ini_get('max_execution_time'),
            'curl' => function_exists('curl_init'),
            'push' => self::pushCheck(),
            'claude' => Claude::configured() ? Claude::ping() + ['configured' => true, 'model' => Assistant::model()] : ['configured' => false],
        ]);
    }

    /** Umí server push notifikace? Zkouší podpis i šifrování nanečisto (bez odeslání). @return array{supported: bool, error: string|null} */
    private static function pushCheck(): array
    {
        if (!WebPush::supported()) {
            return ['supported' => false, 'error' => 'Chybí OpenSSL (ECDH, AES-GCM) nebo cURL.'];
        }
        try {
            $device = WebPush::newKey();
            WebPush::encrypt('{"test":true}', $device['public'], random_bytes(16));
            $key = WebPush::newKey();
            WebPush::vapidHeader('https://example.com', 'mailto:test@example.com', $key['pem'], $key['public']);
            return ['supported' => true, 'error' => null];
        } catch (\Throwable $e) {
            return ['supported' => false, 'error' => $e->getMessage()];
        }
    }

    private static function requireKey(Request $req): void
    {
        $key = (string) Config::get('migrate_key', '');
        if ($key === '') {
            throw HttpError::notFound();
        }
        if (!hash_equals($key, (string) $req->header('x-migrate-key'))) {
            throw HttpError::forbidden('Špatný klíč.');
        }
    }
}
