<?php

declare(strict_types=1);

namespace Dnd;

use RuntimeException;

final class Config
{
    /** @var array<string, mixed>|null */
    private static ?array $data = null;

    /** @return array<string, mixed> */
    public static function all(): array
    {
        if (self::$data === null) {
            // DND_CONFIG umožní testům použít jinou konfiguraci (jiná DB).
            $file = getenv('DND_CONFIG') ?: dirname(__DIR__) . '/config.php';
            if (!is_file($file)) {
                throw new RuntimeException('Chybí konfigurační soubor ' . basename($file));
            }
            $loaded = require $file;
            if (!is_array($loaded)) {
                throw new RuntimeException('Konfigurační soubor musí vracet pole');
            }
            self::$data = $loaded;
        }
        return self::$data;
    }

    public static function get(string $key, mixed $default = null): mixed
    {
        return self::all()[$key] ?? $default;
    }

    /** Složka pro nahrané soubory (fotky, mapy). Mimo veřejný web nebo chráněná .htaccess. */
    public static function storageDir(): string
    {
        $dir = (string) (self::get('storage_dir') ?? dirname(__DIR__) . '/storage');
        return rtrim($dir, '/');
    }

    /** @return array{host:string,port:int,name:string,user:string,password:string} */
    public static function db(): array
    {
        $db = self::all()['db'] ?? null;
        if (!is_array($db)) {
            throw new RuntimeException('V konfiguraci chybí sekce db');
        }
        return $db;
    }
}
