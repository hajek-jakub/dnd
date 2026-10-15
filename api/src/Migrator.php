<?php

declare(strict_types=1);

namespace Dnd;

use RuntimeException;

/** Spouští SQL migrace z api/migrations (v pořadí podle názvu, každou jen jednou). */
final class Migrator
{
    /** @return list<string> názvy právě aplikovaných migrací */
    public static function migrate(): array
    {
        $pdo = Db::pdo();
        $pdo->exec(
            'CREATE TABLE IF NOT EXISTS schema_migrations (
                name VARCHAR(190) NOT NULL PRIMARY KEY,
                applied_at DATETIME NOT NULL
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci',
        );

        $done = array_column(Db::all('SELECT name FROM schema_migrations'), 'name');
        $files = glob(dirname(__DIR__) . '/migrations/*.sql') ?: [];
        sort($files);

        $applied = [];
        foreach ($files as $file) {
            $name = basename($file);
            if (in_array($name, $done, true)) {
                continue;
            }
            foreach (self::statements((string) file_get_contents($file)) as $sql) {
                $pdo->exec($sql);
            }
            Db::exec('INSERT INTO schema_migrations (name, applied_at) VALUES (?, UTC_TIMESTAMP())', [$name]);
            $applied[] = $name;
        }
        return $applied;
    }

    /** Smaže všechny tabulky (jen pro lokální vývoj a testy!). */
    public static function dropAll(): void
    {
        $db = Config::db();
        $name = (string) $db['name'];
        if (!str_starts_with($name, 'dnd')) {
            throw new RuntimeException('Odmítám mazat databázi, která se nejmenuje dnd*.');
        }
        // Ostrá databáze na hostingu nikdy: mazat jde jen DB na tomhle počítači (docker-compose), nikdy vzdálený server.
        if (!in_array(strtolower((string) ($db['host'] ?? '')), ['127.0.0.1', 'localhost', '::1'], true)) {
            throw new RuntimeException('Odmítám mazat databázi na vzdáleném serveru (' . ($db['host'] ?? '?') . '). --fresh je jen pro lokální vývoj a testy.');
        }
        $pdo = Db::pdo();
        $pdo->exec('SET FOREIGN_KEY_CHECKS = 0');
        foreach (Db::all('SHOW TABLES') as $row) {
            $table = (string) array_values($row)[0];
            $pdo->exec('DROP TABLE IF EXISTS `' . str_replace('`', '', $table) . '`');
        }
        $pdo->exec('SET FOREIGN_KEY_CHECKS = 1');
    }

    /** @return list<string> */
    private static function statements(string $sql): array
    {
        $lines = [];
        foreach (preg_split('/\R/', $sql) ?: [] as $line) {
            if (str_starts_with(ltrim($line), '--')) {
                continue;
            }
            $lines[] = $line;
        }
        $parts = preg_split('/;\s*(?:\R|$)/', implode("\n", $lines)) ?: [];
        return array_values(array_filter(array_map('trim', $parts), static fn (string $s): bool => $s !== ''));
    }
}
