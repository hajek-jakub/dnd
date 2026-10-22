<?php
// Doplní termíny session do kampaně (idempotentně: den, který už session má, se přeskočí).
//
//   php api/bin/add-session.php --campaign=<id nebo přesný název> [--time=18:00] [--note="..."] [--notify] [--dry-run] <RRRR-MM-DD> [<RRRR-MM-DD> ...]
//
// Bez --campaign se použije jediná kampaň v databázi (jinak se vypíše seznam a skript skončí).
// Hráčům se nic neoznamuje, dokud nedáš --notify (jinak jen počká připomínka den předem).
// Cílová DB je ta z api/config.php; pro ostrou ji vybereš jen pro tento jeden příkaz:
//   DND_CONFIG=api/config.production.php php api/bin/add-session.php --dry-run --campaign=Mirabilis 2026-10-25 2026-12-13
declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require __DIR__ . '/../src/bootstrap_cli.php';

use Dnd\Config;
use Dnd\Db;
use Dnd\Ids;
use Dnd\Sessions;

$opts = ['campaign' => null, 'time' => null, 'note' => '', 'notify' => false, 'dry' => false];
$dates = [];
foreach (array_slice($argv, 1) as $arg) {
    if ($arg === '--dry-run') {
        $opts['dry'] = true;
    } elseif ($arg === '--notify') {
        $opts['notify'] = true;
    } elseif (preg_match('/^--(campaign|time|note)=(.*)$/s', $arg, $m) === 1) {
        $opts[$m[1]] = $m[2];
    } elseif (Sessions::validDate($arg)) {
        $dates[] = $arg;
    } else {
        fwrite(STDERR, "Neznámý argument: $arg\n");
        exit(2);
    }
}
if ($dates === []) {
    fwrite(STDERR, "Zadej aspoň jedno datum (RRRR-MM-DD).\n");
    exit(2);
}
if ($opts['time'] !== null && preg_match('/^([01]\d|2[0-3]):[0-5]\d$/', (string) $opts['time']) !== 1) {
    fwrite(STDERR, "Čas zadej ve tvaru HH:MM.\n");
    exit(2);
}
if (mb_strlen((string) $opts['note']) > 200) {
    fwrite(STDERR, "Poznámka může mít nejvýš 200 znaků.\n");
    exit(2);
}

$db = Config::get('db', []);
fwrite(STDOUT, 'Databáze: ' . ($db['name'] ?? '?') . ' @ ' . ($db['host'] ?? '?') . ($opts['dry'] ? "  (suchý běh, nic se nezapíše)\n" : "\n"));

$campaigns = Db::all('SELECT id, name FROM campaigns ORDER BY created_at');
if ($opts['campaign'] === null) {
    if (count($campaigns) !== 1) {
        fwrite(STDERR, "V databázi je " . count($campaigns) . " kampaní, zadej --campaign=<id nebo název>:\n");
        foreach ($campaigns as $c) {
            fwrite(STDERR, "  {$c['id']}  {$c['name']}\n");
        }
        exit(3);
    }
    $campaign = $campaigns[0];
} else {
    $matches = array_values(array_filter($campaigns, static fn (array $c): bool => $c['id'] === $opts['campaign'] || $c['name'] === $opts['campaign']));
    if (count($matches) !== 1) {
        fwrite(STDERR, 'Kampaň "' . $opts['campaign'] . '" ' . (count($matches) === 0 ? 'neexistuje' : 'není jednoznačná (použij id)') . ".\n");
        exit(3);
    }
    $campaign = $matches[0];
}
fwrite(STDOUT, "Kampaň: {$campaign['name']} ({$campaign['id']})\n");

$dm = Db::one("SELECT user_id FROM campaign_members WHERE campaign_id = ? AND role = 'dm' ORDER BY joined_at LIMIT 1", [$campaign['id']]);
foreach (array_unique($dates) as $date) {
    $existing = Db::one('SELECT id, session_time FROM game_sessions WHERE campaign_id = ? AND session_date = ?', [$campaign['id'], $date]);
    if ($existing !== null) {
        fwrite(STDOUT, "$date: už existuje, přeskočeno\n");
        continue;
    }
    if ($opts['dry']) {
        fwrite(STDOUT, "$date: bylo by přidáno (" . Sessions::label($date, $opts['time']) . ")\n");
        continue;
    }
    $id = Ids::uuid();
    Db::transaction(static function () use ($id, $campaign, $date, $opts, $dm): void {
        // Připomínka den předem zůstává čekat; je-li session už v okně připomínky, nepřipomíná se (stejně jako v aplikaci).
        $reminded = Sessions::reminderWindowOpen($date) ? gmdate('Y-m-d H:i:s') : null;
        Db::exec(
            'INSERT INTO game_sessions (id, campaign_id, session_date, session_time, note, created_by, reminded_at, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())',
            [$id, $campaign['id'], $date, $opts['time'], (string) $opts['note'], $dm['user_id'] ?? null, $reminded],
        );
        if ($opts['notify']) {
            Sessions::notify((string) $campaign['id'], 'Další session: ' . Sessions::label($date, $opts['time']) . '.', 'session-' . $id, null);
        }
    });
    fwrite(STDOUT, "$date: přidáno (" . Sessions::label($date, $opts['time']) . ")\n");
}
