<?php

declare(strict_types=1);

use Dnd\App;

spl_autoload_register(static function (string $class): void {
    $prefix = 'Dnd\\';
    if (strncmp($class, $prefix, strlen($prefix)) !== 0) {
        return;
    }
    $relative = str_replace('\\', '/', substr($class, strlen($prefix)));
    $file = __DIR__ . '/' . $relative . '.php';
    if (is_file($file)) {
        require $file;
    }
});

date_default_timezone_set('UTC');
mb_internal_encoding('UTF-8');

App::run();
