<?php

declare(strict_types=1);

namespace Dnd;

use Dnd\Controllers\CampaignController;
use Dnd\Controllers\CharacterController;
use Dnd\Controllers\InventoryController;
use Dnd\Controllers\RulesController;

/**
 * Idempotentní seed jedné postavy ze souboru seed/*.json (přepis z papírového sheetu).
 *
 * Zásady:
 *  - ukládají se jen VSTUPY (staty, třídy, proficiencies, HP, inventář, peníze, kouzla); co počítá engine
 *    (modifikátory, savy, skilly, AC, ki, sloty, ...) se neukládá ani jako override,
 *  - itemy a kouzla se mapují na SRD záznamy v DB, co v SRD není, vznikne jako homebrew kampaně,
 *  - hodnoty null zůstanou prázdné ("nedoplněno" v UI), texty s TO_CONFIRM se uloží do poznámek tak, jak jsou,
 *  - když seed narazí na něco, co model neumí uložit, vyhodí SeedStop DŘÍV, než cokoli zapíše,
 *  - znovu spuštěný seed postavu nezdvojí (hledá ji podle kampaně, majitele a jména); --force ji smaže a založí znovu.
 *
 * Zápis jde přes stejné kontrolery jako API, takže platí stejná validace a autorizace.
 */
final class CharacterSeeder
{
    public const TEST_CAMPAIGN_NAME = 'Testovací kampaň (seed)';

    private const TOP_KEYS = ['_info', 'character', 'ruleset', 'classes', 'abilityScores', 'proficiencies', 'hitPoints', 'resources', 'spells', 'attacks', 'inventory', 'currency', 'sheetValues', 'tactics', 'openQuestions'];
    private const CHARACTER_KEYS = ['name', 'race', 'background', 'alignment', 'notes', 'description'];
    private const PROF_KEYS = ['savingThrows', 'skills', 'expertise', 'languages', 'weapons', 'armor', 'tools'];
    private const ITEM_KEYS = ['item', 'qty', 'equipped', 'homebrew', 'base', 'magicBonus', 'damageDice', 'extraDamage', 'attunement', 'consumable', 'description', 'note'];
    private const ALIASES = ['light crossbow' => 'Crossbow, light', 'heavy crossbow' => 'Crossbow, heavy', 'hand crossbow' => 'Crossbow, hand'];
    /** Základ homebrew zbraní, které nejsou v SRD a papír k nim neříká víc než název. Co je odhad, dostane TO_CONFIRM v poznámce. */
    private const HOMEBREW_DEFAULTS = [
        // Kostku a typ zranění vezme seed z řádku v sekci attacks (homebrew zbraň s d8), kategorie a vlastnosti jsou odhad (monk zbraň: simple, melee).
        'nunchaku' => [
            'weapon' => ['damageDice' => '1d6', 'damageType' => 'Bludgeoning', 'category' => 'simple', 'range' => 'melee', 'properties' => ['Light']],
        ],
    ];

    /**
     * @param array<string, mixed> $seed
     * @return array{status: string, characterId: string, campaignId: string, campaignCreated: bool, homebrew: list<string>, warnings: list<string>}
     */
    public static function run(array $seed, string $ownerUsername, ?string $campaignId, bool $force = false): array
    {
        $plan = self::plan($seed, $ownerUsername, $campaignId);
        $user = ['id' => $plan['owner']['id'], 'username' => $plan['owner']['username']];

        $campaignCreated = false;
        $campaign = $plan['campaignId'];
        if ($campaign === null) {
            $res = CampaignController::create(self::req(['name' => self::TEST_CAMPAIGN_NAME, 'description' => 'Založeno seed skriptem.']), [], $user);
            $campaign = (string) ($res->body['campaign']['id'] ?? '');
            $campaignCreated = true;
        }

        $existing = Db::one('SELECT id FROM characters WHERE campaign_id = ? AND owner_id = ? AND name = ?', [$campaign, $user['id'], $plan['name']]);
        if ($existing !== null && !$force) {
            return ['status' => 'exists', 'characterId' => (string) $existing['id'], 'campaignId' => $campaign, 'campaignCreated' => false, 'homebrew' => [], 'warnings' => $plan['warnings']];
        }
        if ($existing !== null) {
            Db::exec('DELETE FROM characters WHERE id = ?', [$existing['id']]);
        }

        // 1) homebrew obsah kampaně (idempotentně podle druhu a názvu)
        $homebrew = [];
        $ruleIds = [];
        foreach ($plan['homebrew'] as $key => $hb) {
            $ruleIds[$key] = self::upsertHomebrew($user, $campaign, $hb);
            $homebrew[] = $hb['body']['name'];
        }

        // 2) postava
        $res = CharacterController::create(self::req($plan['create']), ['id' => $campaign], $user);
        $id = (string) ($res->body['character']['id'] ?? '');
        CharacterController::update(self::req($plan['update']), ['id' => $id], $user);

        // 3) inventář a kouzla
        $char = Db::one('SELECT * FROM characters WHERE id = ?', [$id]) ?? throw new \RuntimeException('Postava se nezaložila.');
        foreach ($plan['items'] as $item) {
            $input = ['quantity' => $item['qty']];
            if ($item['ruleKey'] !== null) {
                $input['ruleId'] = $ruleIds[$item['ruleKey']];
            } else {
                $input['ruleId'] = $item['ruleId'];
            }
            if ($item['notes'] !== '') {
                $input['notes'] = $item['notes'];
            }
            $itemId = InventoryController::createItem($char, $user, $input);
            // Seed počítá kusy (20 šipek), kdežto u balení z pravidel je zadaný počet počtem balení: počet se zapíše přesně.
            Db::exec('UPDATE character_items SET quantity = ? WHERE id = ?', [$item['qty'], $itemId]);
            if ($item['equipped']) {
                Db::exec('UPDATE character_items SET equipped = 1 WHERE id = ?', [$itemId]);
            }
            if ($item['consumable']) {
                Db::exec('UPDATE character_items SET consumable = 1 WHERE id = ?', [$itemId]);
            }
            if ($item['attuned']) {
                // attunement má smysl jen u itemu, který ho vyžaduje
                Db::exec('UPDATE character_items SET requires_attunement = 1, attuned = 1 WHERE id = ?', [$itemId]);
            }
        }
        Tactics::replaceAll($id, $plan['tactics']);
        foreach ($plan['spells'] as $spell) {
            $ruleId = $spell['ruleId'] ?? $ruleIds[$spell['ruleKey']];
            InventoryController::addSpell(self::req(['ruleId' => $ruleId, 'classIdx' => $spell['classIdx'], 'prepared' => true]), ['id' => $id], $user);
        }

        return ['status' => 'created', 'characterId' => $id, 'campaignId' => $campaign, 'campaignCreated' => $campaignCreated, 'homebrew' => $homebrew, 'warnings' => $plan['warnings']];
    }

    // ------------------------------------------------------------------ plán (nic nezapisuje)

    /**
     * Ověří seed proti databázi a připraví vše, co se bude zapisovat. Jakýkoli problém = SeedStop.
     * @param array<string, mixed> $seed
     * @return array<string, mixed>
     */
    public static function plan(array $seed, string $ownerUsername, ?string $campaignId): array
    {
        $problems = [];
        $warnings = [];
        $fail = static function (string $m) use (&$problems): void {
            $problems[] = $m;
        };

        foreach (array_keys($seed) as $k) {
            if (!in_array($k, self::TOP_KEYS, true)) {
                $fail("Neznámá sekce \"$k\": datový model ji neumí uložit.");
            }
        }
        $char = is_array($seed['character'] ?? null) ? $seed['character'] : [];
        foreach (array_keys($char) as $k) {
            if (!in_array($k, self::CHARACTER_KEYS, true)) {
                $fail("Neznámé pole character.$k: datový model ho neumí uložit.");
            }
        }
        $profs = is_array($seed['proficiencies'] ?? null) ? $seed['proficiencies'] : [];
        foreach (array_keys($profs) as $k) {
            if (!in_array($k, self::PROF_KEYS, true)) {
                $fail("Neznámé pole proficiencies.$k: datový model ho neumí uložit.");
            }
        }
        $name = is_string($char['name'] ?? null) ? trim($char['name']) : '';
        if ($name === '') {
            $fail('Chybí character.name.');
        }

        // majitel a kampaň
        $owner = Db::one('SELECT id, username FROM users WHERE username = ?', [$ownerUsername]);
        if ($owner === null) {
            $fail("Uživatel \"$ownerUsername\" neexistuje. Nejdřív se v aplikaci zaregistruj a pak nastav SEED_OWNER_USERNAME na své přihlašovací jméno.");
        }
        $resolvedCampaign = null;
        if ($campaignId !== null && $campaignId !== '') {
            if (!Ids::isUuid($campaignId) || Db::value('SELECT 1 FROM campaigns WHERE id = ?', [$campaignId]) === null) {
                $fail("Kampaň SEED_CAMPAIGN_ID=$campaignId neexistuje.");
            } elseif ($owner !== null && !Access::isMember((string) $owner['id'], $campaignId)) {
                $fail("Uživatel \"$ownerUsername\" není členem kampaně $campaignId.");
            } else {
                $resolvedCampaign = $campaignId;
            }
        } elseif ($owner !== null) {
            $found = Db::value(
                "SELECT c.id FROM campaigns c JOIN campaign_members m ON m.campaign_id = c.id AND m.user_id = ? AND m.role = 'dm'
                 WHERE c.name = ? AND c.created_by = ? ORDER BY c.created_at LIMIT 1",
                [$owner['id'], self::TEST_CAMPAIGN_NAME, $owner['id']],
            );
            $resolvedCampaign = $found === null ? null : (string) $found;
        }

        // třídy a subclassy
        $levels = [];
        $subclasses = [];
        $classIdxs = [];
        foreach (is_array($seed['classes'] ?? null) ? $seed['classes'] : [] as $c) {
            $className = is_array($c) ? (string) ($c['class'] ?? '') : '';
            $lvl = is_array($c) ? ($c['level'] ?? null) : null;
            $idx = Db::value("SELECT idx FROM rules_entries WHERE kind = 'class' AND scope = '' AND LOWER(name) = LOWER(?)", [$className]);
            if ($idx === null || !is_int($lvl) || $lvl < 1) {
                $fail("Třída \"$className\" (level " . json_encode($lvl) . ') se nedá namapovat na SRD.');
                continue;
            }
            $idx = (string) $idx;
            $classIdxs[] = $idx;
            for ($i = 0; $i < $lvl; $i++) {
                $levels[] = ['classIndex' => $idx, 'hpRoll' => null];
            }
            $sub = is_array($c) && is_string($c['subclass'] ?? null) ? trim(preg_replace('/\s*\(.*$/', '', $c['subclass']) ?? '') : '';
            if ($sub !== '') {
                $subIdx = Db::value("SELECT idx FROM rules_entries WHERE kind = 'subclass' AND scope = '' AND ? LIKE CONCAT('%', name)", [$sub]);
                if ($subIdx === null) {
                    $fail("Subclass \"$sub\" se nedá namapovat na SRD.");
                } else {
                    $subclasses[$idx] = (string) $subIdx;
                }
            }
        }
        if ($levels === []) {
            $fail('Postava nemá žádné třídy.');
        }

        // vlastnosti
        $scores = [];
        $abilities = is_array($seed['abilityScores'] ?? null) ? $seed['abilityScores'] : [];
        foreach (Sheets::ABILITIES as $a) {
            $v = $abilities[strtoupper($a)] ?? null;
            if (!is_int($v)) {
                $fail("Chybí hodnota vlastnosti " . strtoupper($a) . '.');
            }
            $scores[$a] = $v;
        }

        // proficiencies: skilly, savy a texty, které engine sám nezná
        $skills = [];
        foreach ([['skills', 1], ['expertise', 2]] as [$field, $level]) {
            foreach (is_array($profs[$field] ?? null) ? $profs[$field] : [] as $s) {
                $key = self::skillKey((string) $s);
                if ($key === null) {
                    $fail("Dovednost \"$s\" neznám.");
                } else {
                    $skills[$key] = $level;
                }
            }
        }
        $classSaves = [];
        $classProfNames = [];
        foreach ($classIdxs as $n => $idx) {
            $data = json_decode((string) Db::value("SELECT data FROM rules_entries WHERE kind = 'class' AND scope = '' AND idx = ?", [$idx]), true);
            foreach (is_array($data['proficiencies'] ?? null) ? $data['proficiencies'] : [] as $p) {
                $classProfNames[] = self::norm((string) ($p['name'] ?? ''));
            }
            if ($n === 0) {
                foreach (is_array($data['saving_throws'] ?? null) ? $data['saving_throws'] : [] as $s) {
                    $classSaves[] = (string) ($s['index'] ?? '');
                }
            }
        }
        $extraSaves = [];
        foreach (is_array($profs['savingThrows'] ?? null) ? $profs['savingThrows'] : [] as $s) {
            $a = strtolower((string) $s);
            if (!in_array($a, Sheets::ABILITIES, true)) {
                $fail("Záchranný hod \"$s\" neznám.");
            } elseif (!in_array($a, $classSaves, true)) {
                $extraSaves[] = $a;
            }
        }
        $extraProfs = [];
        foreach (is_array($profs['languages'] ?? null) ? $profs['languages'] : [] as $l) {
            $extraProfs[] = 'Language: ' . $l;
        }
        foreach ([['weapons', 'Weapon'], ['armor', 'Armor'], ['tools', 'Tool']] as [$field, $label]) {
            $list = $profs[$field] ?? null;
            if ($list !== null && !is_array($list)) {
                $fail("proficiencies.$field musí být seznam nebo null.");
                continue;
            }
            foreach ($list ?? [] as $p) {
                // Co dá třída, engine ví sám. Uloží se jen to, co by jinak zmizelo (třeba pravidlo z 2024).
                if (!in_array(self::norm((string) preg_replace('/\s*\(.*$/', '', (string) $p)), $classProfNames, true)) {
                    $extraProfs[] = "$label: $p";
                }
            }
        }

        // HP, zdroje, inspirace
        $hp = is_array($seed['hitPoints'] ?? null) ? $seed['hitPoints'] : [];
        $hpCurrent = $hp['current'] ?? null;
        $hpTemp = $hp['temp'] ?? 0;
        if (!is_int($hpCurrent) || !is_int($hpTemp)) {
            $fail('hitPoints.current a hitPoints.temp musí být celá čísla.');
        }
        $inspiration = false;
        $notes = [];
        foreach (is_array($seed['resources'] ?? null) ? $seed['resources'] : [] as $r) {
            $rn = (string) ($r['name'] ?? '');
            $cur = $r['current'] ?? null;
            $max = $r['max'] ?? null;
            if (preg_match('/inspiration/i', $rn) === 1) {
                $inspiration = is_int($cur) && $cur > 0;
                if (is_string($r['note'] ?? null) && $r['note'] !== '') {
                    $notes[] = "TO_CONFIRM: $rn $cur/$max uloženo jako Inspirace postavy" . (str_starts_with($r['note'], 'TO_CONFIRM') ? '' : " ({$r['note']})");
                }
            } elseif (preg_match('/^(ki|pact magic)/i', $rn) === 1) {
                // max počítá engine, uložený je jen rozdíl proti maximu, takže plné zdroje nic neukládají
                if ($cur !== $max) {
                    $fail("Zdroj \"$rn\" není plný ($cur/$max), a seed neumí uložit částečně vyčerpaný zdroj.");
                }
            } else {
                $fail("Neznámý zdroj \"$rn\": nevím, na co ho namapovat.");
            }
        }

        // poznámky postavy: původní poznámka, "ruleset" a vše, co je označené TO_CONFIRM
        if (is_string($char['notes'] ?? null) && $char['notes'] !== '') {
            $pending = !str_contains($char['notes'], 'TO_CONFIRM') && preg_match('/čeká na potvrzení/iu', $char['notes']) === 1;
            $notes[] = ($pending ? 'TO_CONFIRM: ' : '') . $char['notes'];
        }
        if (is_string($seed['ruleset'] ?? null) && str_starts_with($seed['ruleset'], 'TO_CONFIRM')) {
            $notes[] = $seed['ruleset'];
        }
        $currency = is_array($seed['currency'] ?? null) ? $seed['currency'] : [];

        // kouzla
        $spells = [];
        $homebrew = [];
        foreach (is_array($seed['spells'] ?? null) ? $seed['spells'] : [] as $classKey => $block) {
            $classIdx = strtolower((string) $classKey);
            if (!in_array($classIdx, $classIdxs, true)) {
                $fail("Kouzla třídy \"$classKey\", kterou postava nemá.");
                continue;
            }
            foreach (['cantrips', 'known', 'leveled'] as $group) {
                foreach (is_array($block[$group] ?? null) ? $block[$group] : [] as $spellName) {
                    // SRD má přednost, jinak katalog kouzel mimo SRD (api/data/extra/warlock-spells.json)
                    $rule = Db::one("SELECT id FROM rules_entries WHERE kind = 'spell' AND is_srd = 1 AND LOWER(name) = LOWER(?)", [$spellName])
                        ?? Db::one("SELECT id FROM rules_entries WHERE kind = 'spell' AND ruleset = 'ref' AND LOWER(name) = LOWER(?)", [$spellName]);
                    if ($rule !== null) {
                        $spells[] = ['classIdx' => $classIdx, 'ruleId' => (string) $rule['id'], 'ruleKey' => null];
                    } else {
                        $fail("Kouzlo \"$spellName\" není ani v SRD, ani v katalogu kouzel (api/data/extra/warlock-spells.json).");
                    }
                }
            }
        }

        // útoky: které zbraně se mají nosit v ruce (mají řádek v sekci attacks)
        $attacks = is_array($seed['attacks'] ?? null) ? $seed['attacks'] : [];

        // inventář
        $items = [];
        foreach (is_array($seed['inventory'] ?? null) ? $seed['inventory'] : [] as $entry) {
            if (!is_array($entry) || !is_string($entry['item'] ?? null)) {
                $fail('Položka inventáře bez názvu.');
                continue;
            }
            $itemName = $entry['item'];
            foreach (array_keys($entry) as $k) {
                if (!in_array($k, self::ITEM_KEYS, true)) {
                    $fail("Položka \"$itemName\": pole \"$k\" datový model neumí uložit.");
                }
            }
            $qty = $entry['qty'] ?? 1;
            if (!is_int($qty) || $qty < 1) {
                $fail("Položka \"$itemName\": neplatné množství.");
                continue;
            }
            $itemNotes = [];
            $nullFields = array_keys(array_filter($entry, static fn ($v, $k) => $v === null && in_array($k, ['attunement', 'description'], true), ARRAY_FILTER_USE_BOTH));
            if ($nullFields !== []) {
                $itemNotes[] = 'TO_CONFIRM: nedoplněno (v seedu null): ' . implode(', ', $nullFields) . '.';
            }
            if (is_string($entry['note'] ?? null) && $entry['note'] !== '') {
                $itemNotes[] = $entry['note'];
            }
            $attackRow = null;
            foreach ($attacks as $a) {
                $an = strtolower((string) ($a['name'] ?? ''));
                $in = strtolower($itemName);
                if ($an !== '' && ($an === $in || str_contains($in, $an))) {
                    $attackRow = $a;
                }
            }
            if ($attackRow !== null && is_string($attackRow['note'] ?? null) && str_starts_with($attackRow['note'], 'TO_CONFIRM')) {
                $itemNotes[] = $attackRow['note'];
            }
            $equipped = ($entry['equipped'] ?? false) === true || $attackRow !== null;

            $ruleId = null;
            $ruleKey = null;
            if (($entry['homebrew'] ?? false) === true) {
                $lower = strtolower($itemName);
                $weapon = self::HOMEBREW_DEFAULTS[$lower]['weapon'] ?? null;
                if (isset(self::HOMEBREW_DEFAULTS[$lower]['itemNote'])) {
                    $itemNotes[] = self::HOMEBREW_DEFAULTS[$lower]['itemNote'];
                }
                if (is_string($entry['base'] ?? null)) {
                    $base = Db::one("SELECT data FROM rules_entries WHERE kind = 'weapon' AND is_srd = 1 AND LOWER(name) = LOWER(?)", [$entry['base']]);
                    if ($base === null) {
                        $fail("Homebrew \"$itemName\": základní zbraň \"{$entry['base']}\" není v SRD.");
                        continue;
                    }
                    $d = json_decode((string) $base['data'], true);
                    $weapon = [
                        'damageDice' => (string) ($d['damage']['dice'] ?? '1d6'), 'damageType' => (string) ($d['damage']['type'] ?? 'Bludgeoning'),
                        'category' => strtolower((string) ($d['weapon_category'] ?? 'simple')), 'range' => strtolower((string) ($d['weapon_range'] ?? 'melee')),
                        'properties' => array_values(array_map('strval', $d['properties'] ?? [])),
                        'versatileDice' => $d['two_handed_damage']['dice'] ?? null,
                    ];
                }
                if ($weapon !== null && !is_string($entry['base'] ?? null)) {
                    // Homebrew bez základní zbraně: kostka a typ zranění jsou na papíře v řádku útoku (např. "1d8+4", bludgeoning).
                    foreach ($attacks as $a) {
                        if (strtolower((string) ($a['name'] ?? '')) === $lower && preg_match('/^\s*(\d{1,2}d\d{1,3})/', (string) ($a['damage'] ?? ''), $dm) === 1) {
                            $weapon['damageDice'] = strtolower($dm[1]);
                            if (is_string($a['damageType'] ?? null) && !str_contains((string) $a['damageType'], '+')) {
                                $weapon['damageType'] = ucfirst(strtolower((string) $a['damageType']));
                            }
                        }
                    }
                }
                if ($weapon === null) {
                    $fail("Homebrew \"$itemName\": nevím, jaké má staty (chybí základní zbraň ani výchozí hodnoty).");
                    continue;
                }
                if (isset($entry['damageDice'])) {
                    // Kostka zranění zbraně, která se liší od základní zbraně (např. Demonic Spear s d8 místo d6 u Spear).
                    if (!is_string($entry['damageDice']) || preg_match('/^\d{1,2}d\d{1,3}$/', $entry['damageDice']) !== 1) {
                        $fail("Homebrew \"$itemName\": damageDice \"" . json_encode($entry['damageDice']) . '" neumím přečíst (čekám např. "1d8").');
                        continue;
                    }
                    $weapon['damageDice'] = strtolower($entry['damageDice']);
                    if (($weapon['versatileDice'] ?? null) === $weapon['damageDice']) {
                        $weapon['versatileDice'] = null; // oběma rukama už není nic navíc
                    }
                }
                $body = ['kind' => 'weapon', 'name' => $itemName, 'description' => is_string($entry['description'] ?? null) ? $entry['description'] : ''] + $weapon;
                if (($entry['attunement'] ?? null) === true) {
                    $body['attunement'] = true;
                }
                if (isset($entry['magicBonus'])) {
                    if (!is_int($entry['magicBonus'])) {
                        $fail("Homebrew \"$itemName\": magicBonus musí být celé číslo.");
                        continue;
                    }
                    $body['magicBonus'] = $entry['magicBonus'];
                }
                if (isset($entry['extraDamage'])) {
                    if (!is_string($entry['extraDamage']) || preg_match('/^\s*(\d{1,2}d\d{1,3})\s+(\S.*)$/', $entry['extraDamage'], $m) !== 1) {
                        $fail("Homebrew \"$itemName\": extraDamage \"" . json_encode($entry['extraDamage']) . '" neumím přečíst (čekám např. "1d4 fire").');
                        continue;
                    }
                    $body['extraDamage'] = [['dice' => strtolower($m[1]), 'type' => ucfirst(trim($m[2]))]];
                }
                $ruleKey = 'weapon:' . $lower;
                $homebrew[$ruleKey] = ['kind' => 'weapon', 'body' => $body];
                $warnings[] = "$itemName není v SRD: založeno jako homebrew zbraň kampaně.";
            } else {
                $lookup = self::ALIASES[strtolower($itemName)] ?? $itemName;
                $rule = Db::one(
                    "SELECT id FROM rules_entries WHERE is_srd = 1 AND kind IN ('weapon', 'armor', 'equipment', 'magic_item') AND LOWER(name) = LOWER(?)",
                    [$lookup],
                );
                if ($rule === null) {
                    $fail("Item \"$itemName\" není v SRD a seed ho neoznačuje jako homebrew.");
                    continue;
                }
                $ruleId = (string) $rule['id'];
            }
            $items[] = ['qty' => $qty, 'equipped' => $equipped, 'attuned' => ($entry['attunement'] ?? null) === true, 'consumable' => ($entry['consumable'] ?? null) === true, 'ruleId' => $ruleId, 'ruleKey' => $ruleKey, 'notes' => implode("\n", $itemNotes)];
        }

        // taktiky (combat cheat sheet): validuje stejný kód jako API, takže seed nemůže uložit nic, co by UI neumělo upravit
        $inventoryNames = array_map(static fn (array $e): string => strtolower((string) ($e['item'] ?? '')), array_filter(is_array($seed['inventory'] ?? null) ? $seed['inventory'] : [], 'is_array'));
        $tactics = self::tacticsFrom($seed, $fail, $inventoryNames);

        // peníze (poslední zbylé TO_CONFIRM z openQuestions se do poznámek nepřenáší, jen vypíše)
        try {
            $currencyClean = Sheets::currency(['currency' => $currency]);
        } catch (HttpError $e) {
            $fail('Peníze: ' . $e->getMessage());
            $currencyClean = [];
        }

        if ($problems !== []) {
            throw new SeedStop($problems);
        }

        return [
            'owner' => $owner,
            'campaignId' => $resolvedCampaign,
            'name' => $name,
            'warnings' => $warnings,
            'homebrew' => $homebrew,
            'tactics' => $tactics,
            'items' => $items,
            'spells' => $spells,
            'create' => [
                'name' => $name,
                'race' => (string) ($char['race'] ?? ''),
                'background' => (string) ($char['background'] ?? ''),
                'alignment' => (string) ($char['alignment'] ?? ''),
                'description' => (string) ($char['description'] ?? ''),
                'notes' => implode("\n", $notes),
                'abilityScores' => $scores,
                'levels' => $levels,
                'subclasses' => $subclasses,
                'skillProficiencies' => $skills,
                'extraSaveProficiencies' => $extraSaves,
                'extraProficiencies' => $extraProfs,
                'state' => ['hpCurrent' => $hpCurrent],
            ],
            'update' => [
                'currency' => $currencyClean,
                'inspiration' => $inspiration,
                'state' => ['hpCurrent' => $hpCurrent, 'hpTemp' => $hpTemp],
            ],
        ];
    }

    /**
     * Jen taktiky existující postavy: smaže její taktiky a vloží nové ze seedu (idempotentní, zbytek postavy se nemění).
     * @param array<string, mixed> $seed
     * @return array{status: string, characterId: string, count: int}
     */
    public static function replaceTactics(array $seed, string $ownerUsername, ?string $campaignId, ?string $characterName = null): array
    {
        $problems = [];
        $fail = static function (string $m) use (&$problems): void {
            $problems[] = $m;
        };
        $tactics = self::tacticsFrom($seed, $fail);
        $name = $characterName !== null && trim($characterName) !== ''
            ? trim($characterName)
            : (is_array($seed['character'] ?? null) && is_string($seed['character']['name'] ?? null) ? trim($seed['character']['name']) : '');
        $owner = Db::one('SELECT id FROM users WHERE username = ?', [$ownerUsername]);
        if ($owner === null) {
            $fail("Uživatel \"$ownerUsername\" neexistuje.");
        }
        $char = null;
        if ($owner !== null) {
            $char = Db::one(
                'SELECT id FROM characters WHERE owner_id = ? AND name = ?' . ($campaignId !== null && $campaignId !== '' ? ' AND campaign_id = ?' : '') . ' ORDER BY created_at DESC LIMIT 1',
                $campaignId !== null && $campaignId !== '' ? [$owner['id'], $name, $campaignId] : [$owner['id'], $name],
            );
            if ($char === null) {
                $fail("Postava \"$name\" uživatele \"$ownerUsername\" neexistuje (nejdřív ji naseeduj).");
            }
        }
        if ($problems !== [] || $char === null) {
            throw new SeedStop($problems);
        }
        Db::transaction(static function () use ($char, $tactics): void {
            Tactics::replaceAll((string) $char['id'], $tactics);
        });
        return ['status' => 'tactics', 'characterId' => (string) $char['id'], 'count' => count($tactics)];
    }

    /**
     * @param array<string, mixed> $seed
     * @param callable(string): void $fail
     * @return list<array{kind: string, title: string, data: array<string, mixed>}>
     */
    private static function tacticsFrom(array $seed, callable $fail, ?array $inventoryNames = null): array
    {
        $out = [];
        $block = $seed['tactics'] ?? [];
        if (!is_array($block)) {
            $fail('Sekce tactics musí být objekt.');
            return [];
        }
        foreach ($block as $key => $list) {
            $kind = Tactics::SEED_KEYS[$key] ?? null;
            if ($kind === null || !is_array($list)) {
                $fail("Neznámá sekce taktik \"$key\": datový model ji neumí uložit.");
                continue;
            }
            foreach ($list as $i => $entry) {
                try {
                    $e = is_array($entry) ? $entry : [];
                    // odkazy podle názvu (id vznikají až při vložení): munice a položky komba
                    $refs = ['ammoItem' => is_string($e['ammoItem'] ?? null) ? $e['ammoItem'] : null, 'uses' => []];
                    foreach (is_array($e['uses'] ?? null) ? $e['uses'] : [] as $u) {
                        if (!is_array($u) || !is_string($u['title'] ?? null)) {
                            throw HttpError::validation('Položka uses musí mít title.', 'uses');
                        }
                        $refs['uses'][] = ['title' => $u['title'], 'count' => is_int($u['count'] ?? null) ? $u['count'] : 1];
                    }
                    if ($refs['ammoItem'] !== null && $inventoryNames !== null && !in_array(strtolower($refs['ammoItem']), $inventoryNames, true)) {
                        throw HttpError::validation("Munice \"{$refs['ammoItem']}\" není v inventáři ze seedu.", 'ammoItem');
                    }
                    unset($e['ammoItem'], $e['uses']);
                    $n = Tactics::normalize($kind, $e);
                    $out[] = ['kind' => $kind, 'title' => $n['title'], 'data' => $n['data'], 'refs' => $refs];
                } catch (HttpError $e) {
                    $fail("Taktika $key #" . ($i + 1) . ': ' . $e->getMessage() . ($e->field !== null ? " (pole {$e->field})" : ''));
                }
            }
        }
        $titles = array_map(static fn (array $t): string => mb_strtolower($t['title']), array_filter($out, static fn (array $t): bool => $t['kind'] !== 'combo'));
        foreach ($out as $t) {
            foreach ($t['refs']['uses'] as $u) {
                if (!in_array(mb_strtolower($u['title']), $titles, true)) {
                    $fail("Kombo \"{$t['title']}\" odkazuje na neexistující taktiku \"{$u['title']}\".");
                }
            }
        }
        return $out;
    }

    // ------------------------------------------------------------------ pomocné

    /** @param array<string, mixed> $hb  @param array{id:string} $user */
    private static function upsertHomebrew(array $user, string $campaignId, array $hb): string
    {
        $name = (string) $hb['body']['name'];
        $kind = (string) $hb['kind'];
        $existing = Db::value('SELECT id FROM rules_entries WHERE campaign_id = ? AND kind = ? AND name = ?', [$campaignId, $kind, $name]);
        if ($existing !== null) {
            $body = $hb['body'];
            unset($body['kind']);
            RulesController::update(self::req($body), ['id' => (string) $existing], $user);
            return (string) $existing;
        }
        $res = RulesController::createHomebrew(self::req($hb['body']), ['id' => $campaignId], $user);
        return (string) ($res->body['entry']['id'] ?? '');
    }

    /** @param array<string, mixed> $body */
    private static function req(array $body): Request
    {
        return new Request('POST', '/', [], [], [], json_encode($body, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR), '127.0.0.1', false);
    }

    private static function skillKey(string $name): ?string
    {
        $key = str_replace(' ', '-', strtolower(trim($name)));
        return in_array($key, Sheets::SKILLS, true) ? $key : null;
    }

    private static function norm(string $s): string
    {
        return preg_replace('/[^a-z]/', '', strtolower($s)) ?? '';
    }
}
