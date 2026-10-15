<?php
// Spuštění migrací z příkazové řádky:
//   php api/bin/migrate.php            aplikuje nové migrace
//   php api/bin/migrate.php --fresh    SMAŽE všechny tabulky (jen dnd* databáze) a znovu aplikuje vše
declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require __DIR__ . '/../src/bootstrap_cli.php';

use Dnd\Migrator;

if (in_array('--fresh', $argv, true)) {
    Migrator::dropAll();
    fwrite(STDOUT, "Databáze vymazána.\n");
}
$applied = Migrator::migrate();
fwrite(STDOUT, $applied === [] ? "Žádné nové migrace.\n" : 'Aplikováno: ' . implode(', ', $applied) . "\n");
