<?php

declare(strict_types=1);

namespace Dnd\Controllers;

use Dnd\Config;
use Dnd\HttpError;
use Dnd\Items;
use Dnd\Migrator;
use Dnd\RateLimiter;
use Dnd\Request;
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

    /** Kontrola prostředí serveru: verze PHP, GD pro obrázky, zapisovatelnost složky pro nahrané soubory. */
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
        ]);
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
