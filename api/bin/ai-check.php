<?php
// Ověří AI pomocníka proti skutečnému Claude API jedním krátkým požadavkem v přesně tom tvaru, jaký posílá aplikace
// (pokyny, nástroje, beta hlavičky, myšlenkové bloky, fallback) a jedním kolem s nástrojem (historie se posílá zpět beze změny).
// Do databáze nesahá. Stojí zhruba 5 centů.
//
//   php api/bin/ai-check.php                                        (klíč z api/config.php)
//   DND_CONFIG=api/config.production.php php api/bin/ai-check.php   (klíč z ostré konfigurace, jen pro tento příkaz)
declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require __DIR__ . '/../src/bootstrap_cli.php';

use Dnd\Assistant;
use Dnd\Claude;
use Dnd\ClaudeError;
use Dnd\Config;

if (!Claude::configured()) {
    fwrite(STDERR, "V konfiguraci chybí claude_api_key.\n");
    exit(2);
}
$users = Config::get('claude_users', []);
echo 'Model: ' . Assistant::model() . "\n";
echo 'Povolené účty (claude_users): ' . (is_array($users) && $users !== [] ? implode(', ', array_map('strval', $users)) : 'ŽÁDNÉ, pomocníka nikdo neuvidí') . "\n";

[$body, $betas] = Assistant::request([['role' => 'user', 'content' => 'Kontrola spojení z aplikace. Odpověz jen slovem OK, nástroje nepoužívej.']]);
echo 'Beta hlavičky: ' . implode(', ', $betas) . "\n";
$started = microtime(true);
try {
    $data = Claude::messages($body, $betas)['data'];
} catch (ClaudeError $e) {
    fwrite(STDERR, sprintf("CHYBA: HTTP %d %s: %s\n", $e->status, $e->type, $e->getMessage()));
    exit(1);
}
$text = implode('', array_map(static fn (array $b): string => ($b['type'] ?? '') === 'text' ? (string) $b['text'] : '', $data['content'] ?? []));
['cost' => $cost, 'tokens' => $t] = Assistant::cost($data, Assistant::model());
printf("Odpověď (%s, %.1f s, stop_reason %s): %s\n", (string) ($data['model'] ?? '?'), microtime(true) - $started, (string) ($data['stop_reason'] ?? '?'), trim($text));
printf("Tokeny: vstup %d, zápis do cache %d, čtení z cache %d, výstup %d; cena %.4f USD\n", $t['in'], $t['write'], $t['read'], $t['out'], $cost / 1_000_000);
if (($data['stop_reason'] ?? '') !== 'end_turn') {
    exit(1);
}

// Kolo s nástrojem: historie (i myšlenkové bloky a prázdný vstup nástroje) se pošle zpět stejně jako v Assistant::history.
$roundtrip = static fn (mixed $content): mixed => json_decode((string) json_encode($content, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
$messages = [['role' => 'user', 'content' => [['type' => 'text', 'text' => 'Kontrola nástrojů: zavolej get_loot a pak jednou větou řekni, kolik položek je v lootu.']]]];
$total = $cost;
for ($i = 0; $i < 3; $i++) {
    [$body, $betas] = Assistant::request($messages);
    try {
        $res = Claude::messages($body, $betas);
    } catch (ClaudeError $e) {
        fwrite(STDERR, sprintf("CHYBA v kole s nástrojem (krok %d): HTTP %d %s: %s\n", $i + 1, $e->status, $e->type, $e->getMessage()));
        exit(1);
    }
    $total += Assistant::cost($res['data'], Assistant::model())['cost'];
    $messages[] = ['role' => 'assistant', 'content' => $roundtrip($res['raw']->content)];
    $uses = array_values(array_filter($res['data']['content'] ?? [], static fn (array $b): bool => ($b['type'] ?? '') === 'tool_use'));
    $kinds = implode(', ', array_map(static fn (array $b): string => (string) $b['type'], $res['data']['content'] ?? []));
    printf("Krok %d: stop_reason %s, bloky: %s\n", $i + 1, (string) ($res['data']['stop_reason'] ?? '?'), $kinds);
    if ($uses === []) {
        $text = implode('', array_map(static fn (array $b): string => ($b['type'] ?? '') === 'text' ? (string) $b['text'] : '', $res['data']['content'] ?? []));
        printf("Odpověď po nástroji: %s\nCelkem %.4f USD\n", trim($text), $total / 1_000_000);
        exit(($res['data']['stop_reason'] ?? '') === 'end_turn' && $i > 0 ? 0 : 1);
    }
    $messages[] = ['role' => 'user', 'content' => $roundtrip(array_map(static fn (array $u): array => [
        'type' => 'tool_result',
        'tool_use_id' => (string) $u['id'],
        'content' => $u['name'] === 'get_loot' ? '{"folders":["Hrobka"],"entries":[{"id":"x","folder":"Hrobka","type":"gold","name":"Truhla","coins":"50 gp"}],"truncated":false}' : 'Pro kontrolu nedostupné.',
    ], $uses))];
}
fwrite(STDERR, "Model nedokončil odpověď ani po 3 krocích.\n");
exit(1);
