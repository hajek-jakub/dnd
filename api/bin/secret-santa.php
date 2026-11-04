<?php
// Vylosuje Secret Santa v kampani. Účastník je jméno hráčské postavy (dárek dává a dostává její hráč), „DM“ (DM kampaně) nebo @přihlašovací-jméno.
// Pod zadaným jménem ho ostatní uvidí v losování. Skript NEVYPÍŠE, kdo komu dává (to ví jen každý dárce sám v aplikaci).
//
//   php api/bin/secret-santa.php --campaign=<id nebo přesný název> --until=<RRRR-MM-DD> [--title="Secret Santa"] [--dry-run] [--force] <účastník> <účastník> ...
//
// --until: poslední den, kdy se losování ukazuje (místní čas, do půlnoci). --force: kampaň už losování má, vylosuje se znovu (všichni odkrývají znovu).
// Cílová DB je ta z api/config.php; pro ostrou ji vybereš jen pro tento jeden příkaz:
//   DND_CONFIG=api/config.production.php php api/bin/secret-santa.php --dry-run --campaign=Mirabilis --until=2026-12-13 Obalatomi DM Enros Borys Pedro Robin
declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require __DIR__ . '/../src/bootstrap_cli.php';

use Dnd\Config;
use Dnd\Db;
use Dnd\SecretSanta;
use Dnd\Sessions;

$opts = ['campaign' => null, 'until' => null, 'title' => 'Secret Santa', 'dry' => false, 'force' => false];
$names = [];
foreach (array_slice($argv, 1) as $arg) {
    if ($arg === '--dry-run') {
        $opts['dry'] = true;
    } elseif ($arg === '--force') {
        $opts['force'] = true;
    } elseif (preg_match('/^--(campaign|until|title)=(.*)$/s', $arg, $m) === 1) {
        $opts[$m[1]] = trim($m[2]);
    } elseif (str_starts_with($arg, '--')) {
        fwrite(STDERR, "Neznámý přepínač: $arg\n");
        exit(2);
    } else {
        $names[] = trim($arg);
    }
}
if ($opts['campaign'] === null || $opts['until'] === null || !Sessions::validDate($opts['until'])) {
    fwrite(STDERR, "Zadej --campaign=<id nebo název> a --until=<RRRR-MM-DD>.\n");
    exit(2);
}
if ($opts['title'] === '' || mb_strlen($opts['title']) > 80) {
    fwrite(STDERR, "Název musí mít 1 až 80 znaků.\n");
    exit(2);
}
if (count($names) < SecretSanta::MIN_PARTICIPANTS || count($names) > SecretSanta::MAX_PARTICIPANTS) {
    fwrite(STDERR, 'Účastníků musí být ' . SecretSanta::MIN_PARTICIPANTS . ' až ' . SecretSanta::MAX_PARTICIPANTS . ".\n");
    exit(2);
}

$db = Config::get('db', []);
fwrite(STDOUT, 'Databáze: ' . ($db['name'] ?? '?') . ' @ ' . ($db['host'] ?? '?') . ($opts['dry'] ? "  (suchý běh, nic se nezapíše)\n" : "\n"));

$campaign = Db::one('SELECT id, name FROM campaigns WHERE id = ? OR name = ?', [$opts['campaign'], $opts['campaign']]);
if ($campaign === null || (int) Db::value('SELECT COUNT(*) FROM campaigns WHERE id = ? OR name = ?', [$opts['campaign'], $opts['campaign']]) !== 1) {
    fwrite(STDERR, 'Kampaň "' . $opts['campaign'] . "\" neexistuje nebo není jednoznačná (použij id).\n");
    exit(3);
}
fwrite(STDOUT, "Kampaň: {$campaign['name']} ({$campaign['id']})\n");

$members = Db::all('SELECT u.id, u.username, m.role FROM campaign_members m JOIN users u ON u.id = m.user_id WHERE m.campaign_id = ?', [$campaign['id']]);
$byId = array_column($members, null, 'id');
$characters = Db::all("SELECT name, owner_id FROM characters WHERE campaign_id = ? AND kind = 'pc' AND owner_id IS NOT NULL", [$campaign['id']]);

$fold = static fn (string $s): string => mb_strtolower(trim($s));
$errors = [];
$participants = [];
foreach ($names as $name) {
    $userId = null;
    if ($fold($name) === 'dm') {
        $dms = array_values(array_filter($members, static fn (array $m): bool => $m['role'] === 'dm'));
        if (count($dms) === 1) {
            $userId = $dms[0]['id'];
        } else {
            $errors[] = "\"$name\": kampaň má " . count($dms) . ' DM, zadej ho jako @přihlašovací-jméno';
        }
    } elseif (str_starts_with($name, '@')) {
        $found = array_values(array_filter($members, static fn (array $m): bool => $fold($m['username']) === $fold(substr($name, 1))));
        $userId = $found[0]['id'] ?? null;
        if ($userId === null) {
            $errors[] = "\"$name\": takový člen kampaně není";
        }
        $name = substr($name, 1);
    } else {
        // Přesná shoda jména postavy, jinak jednoznačný začátek („Robin“ najde „Robinn“).
        $found = array_values(array_filter($characters, static fn (array $c): bool => $fold($c['name']) === $fold($name)));
        if ($found === []) {
            $found = array_values(array_filter($characters, static fn (array $c): bool => str_starts_with($fold($c['name']), $fold($name))));
        }
        if (count($found) === 1 && isset($byId[$found[0]['owner_id']])) {
            $userId = $found[0]['owner_id'];
        } else {
            $errors[] = "\"$name\": " . (count($found) === 0 ? 'hráčská postava toho jména v kampani není' : (count($found) > 1 ? 'víc postav odpovídá (' . implode(', ', array_column($found, 'name')) . ')' : 'hráč postavy už není členem kampaně'));
        }
    }
    if ($userId === null) {
        continue;
    }
    foreach ($participants as $p) {
        if ($p['userId'] === $userId) {
            $errors[] = "\"$name\" a \"{$p['label']}\" jsou tentýž účet ({$byId[$userId]['username']})";
            continue 2;
        }
        if ($fold($p['label']) === $fold($name)) {
            $errors[] = "\"$name\" je v seznamu dvakrát";
            continue 2;
        }
    }
    if (mb_strlen($name) > 80) {
        $errors[] = "\"$name\": jméno je delší než 80 znaků";
        continue;
    }
    $participants[] = ['userId' => $userId, 'label' => $name];
    fwrite(STDOUT, "  $name = účet {$byId[$userId]['username']}\n");
}
if ($errors !== []) {
    fwrite(STDERR, "Nic se nevylosovalo:\n  " . implode("\n  ", $errors) . "\n");
    exit(3);
}

try {
    $existing = (int) Db::value('SELECT COUNT(*) FROM secret_santa_draws WHERE campaign_id = ?', [$campaign['id']]);
} catch (PDOException $e) {
    if (!$opts['dry']) {
        throw $e;
    }
    fwrite(STDOUT, "Tabulka losování v DB ještě není (migrace 038 není nasazená).\n");
    $existing = 0;
}
if ($existing > 0 && !$opts['force']) {
    fwrite(STDERR, "Kampaň už losování má. Nové losování (všichni odkrývají znovu) jen s --force.\n");
    exit(3);
}

// Ukazuje se do konce zadaného dne místního času.
$until = (new DateTimeImmutable($opts['until'] . ' 00:00:00', Sessions::zone()))->modify('+1 day')->setTimezone(new DateTimeZone('UTC'));
fwrite(STDOUT, 'Ukazuje se do: ' . $opts['until'] . ' 23:59 (' . Sessions::zone()->getName() . ")\n");
if ($until <= new DateTimeImmutable('now', new DateTimeZone('UTC'))) {
    fwrite(STDERR, "Datum --until už minulo.\n");
    exit(2);
}
if ($opts['dry']) {
    fwrite(STDOUT, 'Vylosovalo by se ' . count($participants) . " účastníků (suchý běh).\n");
    exit(0);
}
SecretSanta::draw((string) $campaign['id'], $opts['title'], $until->format('Y-m-d H:i:s'), $participants);
fwrite(STDOUT, 'Vylosováno: ' . count($participants) . " účastníků. Kdo komu dává, uvidí každý jen sám v aplikaci.\n");
