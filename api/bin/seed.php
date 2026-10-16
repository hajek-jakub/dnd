<?php
// Načtení pravidel (SRD 5.1 + katalog itemů) do databáze z příkazové řádky:
//   php api/bin/seed.php           načte, jen pokud se data změnila
//   php api/bin/seed.php --force   načte vždy
declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require __DIR__ . '/../src/bootstrap_cli.php';

use Dnd\Items;
use Dnd\Seeder;

$result = Seeder::run(in_array('--force', $argv, true));
$repaired = Items::repairMagicGear();
if ($repaired !== []) {
    fwrite(STDOUT, 'Opravené itemy postav: ' . implode(', ', $repaired) . "\n");
}
if ($result['skipped']) {
    fwrite(STDOUT, "Data pravidel jsou aktuální, nic se nenačítalo.\n");
    exit(0);
}
fwrite(STDOUT, 'Načteno: ' . json_encode($result['counts'], JSON_UNESCAPED_UNICODE) . ", smazáno zastaralých: {$result['removed']}\n");
