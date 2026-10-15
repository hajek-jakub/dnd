<?php

declare(strict_types=1);

namespace Dnd\Controllers;

use Dnd\Config;
use Dnd\HttpError;
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

    /** Načte pravidla (SRD 5.1 + katalog itemů) do databáze; přeskočí se, pokud se data nezměnila. */
    public static function seed(Request $req): Response
    {
        self::requireKey($req);
        $force = ($req->query['force'] ?? '') === '1';
        return Response::json(Seeder::run($force));
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
