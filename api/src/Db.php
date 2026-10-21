<?php

declare(strict_types=1);

namespace Dnd;

use PDO;
use PDOStatement;
use Throwable;

final class Db
{
    private static ?PDO $pdo = null;

    public static function pdo(): PDO
    {
        if (self::$pdo === null) {
            $c = Config::db();
            $dsn = sprintf(
                'mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4',
                $c['host'],
                (int) ($c['port'] ?? 3306),
                $c['name'],
            );
            $pdo = new PDO($dsn, $c['user'], $c['password'], [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES => false,
            ]);
            // Všechna data se ukládají v UTC.
            $pdo->exec("SET time_zone = '+00:00'");
            self::$pdo = $pdo;
        }
        return self::$pdo;
    }

    /** @param list<mixed> $params */
    private static function run(string $sql, array $params): PDOStatement
    {
        $stmt = self::pdo()->prepare($sql);
        $stmt->execute($params);
        return $stmt;
    }

    /**
     * @param list<mixed> $params
     * @return list<array<string, mixed>>
     */
    public static function all(string $sql, array $params = []): array
    {
        return self::run($sql, $params)->fetchAll();
    }

    /**
     * @param list<mixed> $params
     * @return array<string, mixed>|null
     */
    public static function one(string $sql, array $params = []): ?array
    {
        $row = self::run($sql, $params)->fetch();
        return $row === false ? null : $row;
    }

    /** @param list<mixed> $params */
    public static function value(string $sql, array $params = []): mixed
    {
        $row = self::run($sql, $params)->fetch(PDO::FETCH_NUM);
        return $row === false ? null : $row[0];
    }

    /** @param list<mixed> $params  @return int počet ovlivněných řádků */
    public static function exec(string $sql, array $params = []): int
    {
        return self::run($sql, $params)->rowCount();
    }

    /**
     * Spustí callback v transakci (commit / rollback při výjimce).
     * @template T
     * @param callable(): T $fn
     * @return T
     */
    public static function transaction(callable $fn): mixed
    {
        $pdo = self::pdo();
        // Deadlock (MySQL 1213) databáze vyřeší tím, že jednu transakci zruší. Ta se celá vrátila zpět, takže ji jde bezpečně zopakovat.
        for ($attempt = 1;; $attempt++) {
            $pdo->beginTransaction();
            // Push zařazené uvnitř transakce se po jejím vrácení zahodí (a při zopakování po deadlocku se nezdvojí).
            $pushMark = Push::mark();
            try {
                $result = $fn();
                $pdo->commit();
                return $result;
            } catch (Throwable $e) {
                if ($pdo->inTransaction()) {
                    $pdo->rollBack();
                }
                Push::rewind($pushMark);
                if ($attempt >= 3 || !self::isDeadlock($e)) {
                    throw $e;
                }
                usleep(random_int(20_000, 120_000));
            }
        }
    }

    private static function isDeadlock(Throwable $e): bool
    {
        return $e instanceof \PDOException && (int) ($e->errorInfo[1] ?? 0) === 1213;
    }
}
