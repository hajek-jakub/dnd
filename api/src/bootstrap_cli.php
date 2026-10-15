<?php

declare(strict_types=1);

// Autoloader pro CLI skripty (bez spuštění aplikace).
spl_autoload_register(static function (string $class): void {
    $prefix = 'Dnd\\';
    if (strncmp($class, $prefix, strlen($prefix)) !== 0) {
        return;
    }
    $file = __DIR__ . '/' . str_replace('\\', '/', substr($class, strlen($prefix))) . '.php';
    if (is_file($file)) {
        require $file;
    }
});
date_default_timezone_set('UTC');
