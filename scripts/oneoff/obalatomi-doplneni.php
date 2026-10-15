<?php
// Jednorázové doplnění Obalatomiho (Hajoš) na ostré DB podle toho, co hráč napsal 16. 10. 2026:
// 20 šípů do kuše, component pouch, Hermit, příběh, 620 gp, popis Demonic Spear a spotřebovatelné itemy.
// Spouští se až PO nasazení (potřebuje migraci 013) a jen s DND_CONFIG pro jeden příkaz:
//   DND_CONFIG=$PWD/api/config.production.php php scripts/oneoff/obalatomi-doplneni.php           (jen vypíše, co by udělal)
//   DND_CONFIG=$PWD/api/config.production.php php scripts/oneoff/obalatomi-doplneni.php --apply   (provede)
// Pak: DND_CONFIG=... SEED_OWNER_USERNAME=jakub SEED_CAMPAIGN_ID=<kampaň> SEED_CHARACTER_NAME=Obalatomi php api/bin/seed-hajos.php --tactics-only
declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    exit(1);
}
require dirname(__DIR__, 2) . '/api/src/bootstrap_cli.php';

use Dnd\Controllers\InventoryController;
use Dnd\Db;
use Dnd\Sheets;

$apply = in_array('--apply', $argv, true);
$charId = '78f51feb-994a-489c-bc24-167e78eb3b45';
$char = Db::one('SELECT * FROM characters WHERE id = ?', [$charId]) ?? throw new RuntimeException('Postava nenalezena.');
$owner = ['id' => (string) $char['owner_id']];

$rule = static fn (string $name): array => Db::one(
    "SELECT id FROM rules_entries WHERE is_srd = 1 AND kind = 'equipment' AND LOWER(name) = LOWER(?)",
    [$name],
) ?? throw new RuntimeException("Pravidlo $name nenalezeno.");
$has = static fn (string $name): bool => Db::one('SELECT id FROM character_items WHERE character_id = ? AND LOWER(name) = LOWER(?)', [$charId, $name]) !== null;

$spearText = 'Melee weapon (martial), Trident +1. Requires Attunement. Damage 1d6 (1d8 versatile) piercing damage + 1d4 fire damage. Properties: Versatile, Thrown. Range 20/60.';
$story = 'Obalatomi je ze sirotčince v hlavním městě, ale brzy odešel do kláštera v Kupika Desert, ve městě Devreach.';
$wallet = Sheets::json($char['currency'], []);
$wallet = is_array($wallet) ? $wallet : [];
$wallet['gp'] = 620;
$extra = Sheets::json($char['extra_proficiencies'], []);
$extra = is_array($extra) ? $extra : [];
if (!in_array('Tool: Herbalism kit', $extra, true)) {
    $extra[] = 'Tool: Herbalism kit';
}

echo $apply ? "APPLY\n" : "DRY-RUN\n";
echo 'Crossbow bolt: ' . ($has('Crossbow bolt') ? 'už je' : 'přidat 20 ks') . "\n";
echo 'Component pouch: ' . ($has('Component pouch') ? 'už je' : 'přidat') . "\n";
echo "Dart, Torch, Rations (1 day): spotřebovatelné\n";
echo "Demonic Spear: popis z karty, Crossbow: bez TO_CONFIRM\n";
echo "Postava: background Hermit, příběh, 620 gp, Herbalism kit\n";
if (!$apply) {
    exit(0);
}

Db::transaction(static function () use ($charId, $char, $owner, $rule, $has, $spearText, $story, $wallet, $extra): void {
    if (!$has('Crossbow bolt')) {
        InventoryController::createItem($char, $owner, ['ruleId' => (string) $rule('Crossbow bolt')['id'], 'quantity' => 20, 'consumable' => true]);
    }
    if (!$has('Component pouch')) {
        InventoryController::createItem($char, $owner, ['ruleId' => (string) $rule('Component pouch')['id'], 'quantity' => 1]);
    }
    Db::exec("UPDATE character_items SET consumable = 1 WHERE character_id = ? AND name IN ('Dart', 'Torch', 'Rations (1 day)', 'Crossbow bolt')", [$charId]);
    $spear = Db::one("SELECT id, rule_id FROM character_items WHERE character_id = ? AND name = 'Demonic Spear'", [$charId]);
    if ($spear !== null) {
        Db::exec("UPDATE character_items SET description = ?, notes = REPLACE(notes, 'TO_CONFIRM: nedoplněno (v seedu null): description.', ''), updated_at = UTC_TIMESTAMP() WHERE id = ?", [$spearText, $spear['id']]);
        if ($spear['rule_id'] !== null) {
            Db::exec("UPDATE rules_entries SET desc_text = ?, updated_at = UTC_TIMESTAMP() WHERE id = ? AND campaign_id IS NOT NULL", [$spearText, $spear['rule_id']]);
        }
    }
    Db::exec("UPDATE character_items SET notes = '', updated_at = UTC_TIMESTAMP() WHERE character_id = ? AND name = 'Crossbow, light' AND notes LIKE 'TO_CONFIRM%'", [$charId]);
    Db::exec(
        'UPDATE characters SET background = ?, description = IF(description = \'\', ?, description), currency = ?, extra_proficiencies = ?, rev = rev + 1, updated_at = UTC_TIMESTAMP() WHERE id = ?',
        ['Hermit', $story, Sheets::enc($wallet), Sheets::enc($extra), $charId],
    );
});
echo "Hotovo\n";
