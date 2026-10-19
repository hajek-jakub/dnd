<?php
// Idempotentní seed postavy Hajoš (seed/hajos.json) do databáze z api/config.php (nebo DND_CONFIG).
//
//   SEED_OWNER_USERNAME=jmeno php api/bin/seed-hajos.php           (nebo v souboru .env v kořeni projektu)
//   SEED_CAMPAIGN_ID=<uuid>    volitelné; chybí-li, založí se (a příště znovu použije) "Testovací kampaň (seed)"
//   php api/bin/seed-hajos.php --force      smaže už existující Hajoše v té kampani a založí ho znovu
//   php api/bin/seed-hajos.php --check      jen ověří, že jde všechno namapovat, nic nezapíše
//   SEED_CHARACTER_NAME=jméno  jen pro --tactics-only: postava se hledá pod tímhle jménem (když ji hráč v aplikaci přejmenoval)
//   php api/bin/seed-hajos.php --tactics-only  jen smaže a znovu vloží taktiky už existující postavy (zbytek postavy se nemění)
//   php api/bin/seed-hajos.php --update  doplní existující rozehranou postavu (staty, dovednosti, HP, chybějící itemy, taktiky), nic nesmaže
//   php api/bin/seed-hajos.php [soubor.json]  jiný vstupní soubor (výchozí seed/hajos.json)
declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require __DIR__ . '/../src/bootstrap_cli.php';

use Dnd\CharacterSeeder;
use Dnd\Config;
use Dnd\SeedStop;

$root = dirname(__DIR__, 2);

/** Načte KEY=VALUE z .env (bez uvozovek a komentářů); skutečné proměnné prostředí mají přednost. */
function loadDotEnv(string $file): array
{
    $out = [];
    if (!is_file($file)) {
        return $out;
    }
    foreach (file($file, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [] as $line) {
        if (preg_match('/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/', $line, $m) === 1 && !str_starts_with(ltrim($line), '#')) {
            $out[$m[1]] = trim($m[2], "\"'");
        }
    }
    return $out;
}

$env = loadDotEnv($root . '/.env');
$get = static fn (string $k): ?string => (getenv($k) !== false && getenv($k) !== '') ? (string) getenv($k) : ($env[$k] ?? null);

$flags = array_values(array_filter($argv, static fn (string $a): bool => str_starts_with($a, '--')));
$files = array_values(array_filter(array_slice($argv, 1), static fn (string $a): bool => !str_starts_with($a, '--')));
$file = $files[0] ?? $root . '/seed/hajos.json';

$owner = $get('SEED_OWNER_USERNAME');
if ($owner === null) {
    fwrite(STDERR, "Chybí SEED_OWNER_USERNAME (přihlašovací jméno tvého účtu). Nastav ho v .env v kořeni projektu nebo před příkaz.\n");
    exit(2);
}
$campaignId = $get('SEED_CAMPAIGN_ID');

$seed = json_decode((string) @file_get_contents($file), true);
if (!is_array($seed)) {
    fwrite(STDERR, "Soubor $file nejde přečíst jako JSON.\n");
    exit(2);
}

$db = Config::get('db', []);
fwrite(STDOUT, 'Databáze: ' . ($db['name'] ?? '?') . ' @ ' . ($db['host'] ?? '?') . "\n");

try {
    if (in_array('--update', $flags, true)) {
        $res = CharacterSeeder::update($seed, $owner, $campaignId, $get('SEED_CHARACTER_NAME'));
        fwrite(STDOUT, "Postava {$res['characterId']} doplněna (staty, dovednosti, proficiencies, HP, taktiky).\n");
        fwrite(STDOUT, 'Přidané itemy: ' . ($res['added'] === [] ? 'žádné' : implode(', ', $res['added'])) . "\n");
        if ($res['skipped'] !== []) {
            fwrite(STDOUT, 'Už je měla (nechané beze změny): ' . implode(', ', $res['skipped']) . "\n");
        }
        foreach ($res['warnings'] as $w) {
            fwrite(STDOUT, "  ! $w\n");
        }
    } elseif (in_array('--tactics-only', $flags, true)) {
        $res = CharacterSeeder::replaceTactics($seed, $owner, $campaignId, $get('SEED_CHARACTER_NAME'));
        fwrite(STDOUT, "Taktiky postavy {$res['characterId']} nahrazeny: {$res['count']} položek.\n");
    } elseif (in_array('--check', $flags, true)) {
        $plan = CharacterSeeder::plan($seed, $owner, $campaignId);
        fwrite(STDOUT, 'V pořádku, jde to namapovat: ' . count($plan['items']) . ' itemů, ' . count($plan['spells']) . ' kouzel, ' . count($plan['homebrew']) . " homebrew záznamů. Nic se nezapsalo.\n");
        foreach ($plan['warnings'] as $w) {
            fwrite(STDOUT, "  ! $w\n");
        }
    } else {
        $res = CharacterSeeder::run($seed, $owner, $campaignId, in_array('--force', $flags, true));
        if ($res['status'] === 'exists') {
            fwrite(STDOUT, "Postava už v kampani {$res['campaignId']} existuje ({$res['characterId']}), nic se neměnilo. Pro nové založení použij --force.\n");
        } else {
            fwrite(STDOUT, "Postava založena: {$res['characterId']}\n");
            fwrite(STDOUT, 'Kampaň: ' . $res['campaignId'] . ($res['campaignCreated'] ? ' (nově založená testovací kampaň)' : '') . "\n");
            if ($res['homebrew'] !== []) {
                fwrite(STDOUT, 'Homebrew obsah kampaně: ' . implode(', ', $res['homebrew']) . "\n");
            }
        }
        foreach ($res['warnings'] as $w) {
            fwrite(STDOUT, "  ! $w\n");
        }
    }
} catch (SeedStop $e) {
    fwrite(STDERR, $e->getMessage() . "\n");
    exit(3);
} catch (Dnd\HttpError $e) {
    fwrite(STDERR, 'Validace selhala: ' . $e->getMessage() . ($e->field !== null ? " (pole {$e->field})" : '') . "\n");
    exit(4);
}

$questions = is_array($seed['openQuestions'] ?? null) ? $seed['openQuestions'] : [];
if ($questions !== []) {
    fwrite(STDOUT, "\nOtevřené otázky (čekají na doplnění):\n");
    foreach ($questions as $i => $q) {
        fwrite(STDOUT, '  ' . ($i + 1) . ". $q\n");
    }
}
