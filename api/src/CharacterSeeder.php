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

    private const TOP_KEYS = ['_info', 'character', 'ruleset', 'classes', 'abilityScores', 'proficiencies', 'hitPoints', 'resources', 'spells', 'attacks', 'inventory', 'currency', 'effects', 'sheetValues', 'tactics', 'openQuestions'];
    private const CHARACTER_KEYS = ['name', 'race', 'subrace', 'background', 'alignment', 'notes', 'description', 'personality', 'baseSpeed'];
    private const PROF_KEYS = ['savingThrows', 'skills', 'expertise', 'languages', 'weapons', 'armor', 'tools'];
    private const ITEM_KEYS = ['item', 'qty', 'equipped', 'homebrew', 'custom', 'kind', 'weapon', 'base', 'magicBonus', 'damageDice', 'extraDamage', 'attunement', 'consumable', 'description', 'note'];
    /** Hodnoty homebrew zbraně zadané přímo v seedu (`weapon`), když v SRD není žádný základ (např. pistole). */
    private const WEAPON_KEYS = ['damageDice', 'damageType', 'category', 'range', 'properties', 'versatileDice'];
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

        // 2) postava (homebrew subclass má idx „hb-…“ až po založení)
        $create = $plan['create'];
        foreach ($plan['subclassKeys'] as $classIdx => $key) {
            $create['subclasses'][$classIdx] = (string) Db::value('SELECT idx FROM rules_entries WHERE id = ?', [$ruleIds[$key]]);
        }
        $res = CharacterController::create(self::req($create), ['id' => $campaign], $user);
        $id = (string) ($res->body['character']['id'] ?? '');
        CharacterController::update(self::req($plan['update']), ['id' => $id], $user);

        // 3) inventář, bonusy, taktiky a kouzla
        $char = Db::one('SELECT * FROM characters WHERE id = ?', [$id]) ?? throw new \RuntimeException('Postava se nezaložila.');
        self::addContent($char, $user, $plan, $ruleIds, false);
        Tactics::replaceAll($id, $plan['tactics']);

        return ['status' => 'created', 'characterId' => $id, 'campaignId' => $campaign, 'campaignCreated' => $campaignCreated, 'homebrew' => $homebrew, 'warnings' => $plan['warnings']];
    }

    /**
     * Doplní EXISTUJÍCÍ postavu, kterou hráč už rozehrál (fotka, předměty, hody v logu), místo smazání a nového založení.
     * Z papíru přepíše jen to, co je na něm jednoznačně: vlastnosti, dovednosti, savy, background, subclassy, hody HP a HP.
     * Proficiencies sloučí, poznámky a popis doplní (nic nesmaže), itemy, kouzla a bonusy jen přidá, co chybí (podle názvu),
     * peníze nastaví jen tehdy, když jsou v seedu, a taktiky nahradí. Rasu, jméno, inspiraci, stav (sloty, stavy) a fotku nechá.
     * @param array<string, mixed> $seed
     * @return array{status: string, characterId: string, added: list<string>, skipped: list<string>, homebrew: list<string>, warnings: list<string>}
     */
    public static function update(array $seed, string $ownerUsername, ?string $campaignId, ?string $characterName = null): array
    {
        if ($campaignId === null || $campaignId === '') {
            throw new SeedStop(['Doplnění existující postavy potřebuje SEED_CAMPAIGN_ID.']);
        }
        $plan = self::plan($seed, $ownerUsername, $campaignId);
        $user = ['id' => $plan['owner']['id'], 'username' => $plan['owner']['username']];
        $name = $characterName !== null && trim($characterName) !== '' ? trim($characterName) : $plan['name'];
        $row = Db::one('SELECT * FROM characters WHERE campaign_id = ? AND owner_id = ? AND name = ?', [$campaignId, $user['id'], $name]);
        if ($row === null) {
            throw new SeedStop(["Postava \"$name\" uživatele \"$ownerUsername\" v kampani neexistuje (založ ji bez --update, nebo nastav SEED_CHARACTER_NAME)."]);
        }
        $levels = Db::all('SELECT seq, class_idx FROM character_levels WHERE character_id = ? ORDER BY seq', [$row['id']]);
        if (array_column($levels, 'class_idx') !== array_column($plan['create']['levels'], 'classIndex')) {
            throw new SeedStop(['Levely postavy (' . implode(', ', array_column($levels, 'class_idx')) . ') nesedí se seedem; --update levely nemění. Nejdřív level up v aplikaci.']);
        }

        $homebrew = [];
        $ruleIds = [];
        foreach ($plan['homebrew'] as $key => $hb) {
            $ruleIds[$key] = self::upsertHomebrew($user, $campaignId, $hb);
            $homebrew[] = $hb['body']['name'];
        }
        $create = $plan['create'];
        foreach ($plan['subclassKeys'] as $classIdx => $key) {
            $create['subclasses'][$classIdx] = (string) Db::value('SELECT idx FROM rules_entries WHERE id = ?', [$ruleIds[$key]]);
        }

        $body = [
            'rev' => (int) $row['rev'],
            'abilityScores' => $create['abilityScores'],
            'skillProficiencies' => $create['skillProficiencies'],
            'extraSaveProficiencies' => $create['extraSaveProficiencies'],
            'extraProficiencies' => array_values(array_unique([...Sheets::json($row['extra_proficiencies'], []), ...$create['extraProficiencies']])),
            'subclasses' => $create['subclasses'] + Sheets::json($row['subclasses'], []),
        ];
        foreach (['background', 'alignment'] as $k) {
            if ($create[$k] !== '') {
                $body[$k] = $create[$k];
            }
        }
        if (trim((string) $row['description']) === '' && $create['description'] !== '') {
            $body['description'] = $create['description'];
        }
        $existingNotes = trim((string) $row['notes']);
        if ($create['notes'] !== '' && !str_contains($existingNotes, $create['notes'])) {
            $body['notes'] = $existingNotes === '' ? $create['notes'] : $existingNotes . "\n" . $create['notes'];
        }
        $personality = Sheets::json($row['personality'], []);
        if (implode('', array_map('strval', is_array($personality) ? $personality : [])) === '' && $create['personality'] !== []) {
            $body['personality'] = $create['personality'];
        }
        if (is_array($seed['character'] ?? null) && isset($seed['character']['baseSpeed'])) {
            $body['baseSpeed'] = $create['baseSpeed'];
        }
        if (array_key_exists('currency', $seed)) {
            $body['currency'] = $plan['update']['currency'];
        }
        $res = CharacterController::update(self::req($body), ['id' => (string) $row['id']], $user);
        if ($res instanceof Response && $res->status === 409) {
            throw new SeedStop(['Postavu mezitím někdo změnil, nic se nezapsalo. Spusť to znovu.']);
        }

        $char = Db::one('SELECT * FROM characters WHERE id = ?', [$row['id']]) ?? throw new \RuntimeException('Postava zmizela.');
        Db::transaction(static function () use ($char, $plan, $levels): void {
            // Hody HP z papíru a HP podle nich (stav postavy, sloty a stavy se nemění).
            foreach ($plan['create']['levels'] as $i => $l) {
                Db::exec('UPDATE character_levels SET hp_roll = ? WHERE character_id = ? AND seq = ?', [$i === 0 ? null : $l['hpRoll'], $char['id'], $levels[$i]['seq']]);
            }
            Db::exec('UPDATE characters SET hp_current = ? WHERE id = ?', [$plan['create']['state']['hpCurrent'], $char['id']]);
        });
        [$added, $skipped] = self::addContent($char, $user, $plan, $ruleIds, true);
        if (is_array($seed['tactics'] ?? null) && $seed['tactics'] !== []) {
            Tactics::replaceAll((string) $char['id'], $plan['tactics']);
        }
        return ['status' => 'updated', 'characterId' => (string) $char['id'], 'added' => $added, 'skipped' => $skipped, 'homebrew' => $homebrew, 'warnings' => $plan['warnings']];
    }

    /**
     * Itemy, bonusy a kouzla z plánu. S `$skipExisting` přeskočí, co postava už má (item se stejným názvem, kouzlo, bonus se stejným cílem a zdrojem).
     * @param array<string, mixed> $char @param array{id:string} $user @param array<string, mixed> $plan @param array<string, string> $ruleIds
     * @return array{0: list<string>, 1: list<string>} přidané a přeskočené položky
     */
    private static function addContent(array $char, array $user, array $plan, array $ruleIds, bool $skipExisting): array
    {
        $id = (string) $char['id'];
        $added = [];
        $skipped = [];
        $existing = Db::all('SELECT name, rule_id FROM character_items WHERE character_id = ?', [$id]);
        $have = array_map('mb_strtolower', array_column($existing, 'name'));
        // item z pravidel, který si hráč přejmenoval (Ring of Mind Shielding jako „Prsten Runové Vůle“), je pořád tentýž
        $haveRules = array_values(array_filter(array_column($existing, 'rule_id')));
        foreach ($plan['items'] as $item) {
            $input = ['quantity' => $item['qty']];
            if (isset($item['custom'])) {
                $input += $item['custom'];
            } elseif ($item['ruleKey'] !== null) {
                $input['ruleId'] = $ruleIds[$item['ruleKey']];
            } else {
                $input['ruleId'] = $item['ruleId'];
            }
            $label = (string) ($item['custom']['name'] ?? Db::value('SELECT name FROM rules_entries WHERE id = ?', [$input['ruleId']]));
            if ($skipExisting && (in_array(mb_strtolower($label), $have, true) || (isset($input['ruleId']) && in_array($input['ruleId'], $haveRules, true)))) {
                $skipped[] = $label;
                continue;
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
            $added[] = $label;
        }
        foreach ($plan['effects'] as $e) {
            if ($skipExisting && Db::value('SELECT 1 FROM character_effects WHERE character_id = ? AND target = ? AND source = ?', [$id, $e['target'], $e['source']]) !== null) {
                continue;
            }
            Db::exec(
                'INSERT INTO character_effects (id, character_id, target, value, source, duration, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP())',
                [Ids::uuid(), $id, $e['target'], $e['value'], $e['source'], $e['duration'], $user['id']],
            );
        }
        foreach ($plan['spells'] as $spell) {
            $ruleId = $spell['ruleId'] ?? $ruleIds[$spell['ruleKey']];
            if ($skipExisting && Db::value('SELECT 1 FROM character_spells WHERE character_id = ? AND rule_id = ?', [$id, $ruleId]) !== null) {
                continue;
            }
            InventoryController::addSpell(self::req(['ruleId' => $ruleId, 'classIdx' => $spell['classIdx'], 'prepared' => true]), ['id' => $id], $user);
            if ($spell['always'] ?? false) {
                Db::exec("UPDATE character_spells SET always_prepared = 1, source = 'subclass' WHERE character_id = ? AND rule_id = ? AND class_idx = ?", [$id, $ruleId, $spell['classIdx']]);
            }
        }
        return [$added, $skipped];
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
        try {
            Sheets::personality(['personality' => $char['personality'] ?? []]);
        } catch (HttpError $e) {
            $fail('character.personality: ' . $e->getMessage());
        }
        if (isset($char['baseSpeed']) && (!is_int($char['baseSpeed']) || $char['baseSpeed'] < 0 || $char['baseSpeed'] > 200)) {
            $fail('character.baseSpeed musí být rychlost ve stopách (celé číslo).');
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
        $subclassKeys = [];
        $homebrew = [];
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
            // Hody HP po levelech (null = průměr; první level postavy je vždy plná kostka), když papír neodpovídá průměru.
            $rolls = is_array($c['hpRolls'] ?? null) ? array_values($c['hpRolls']) : [];
            $die = (int) (json_decode((string) Db::value("SELECT data FROM rules_entries WHERE kind = 'class' AND scope = '' AND idx = ?", [$idx]), true)['hit_die'] ?? 12);
            if (isset($c['hpRolls']) && (!is_array($c['hpRolls']) || count($rolls) !== $lvl)) {
                $fail("Třída \"$className\": hpRolls musí mít $lvl hodnot (jednu na level, null = průměr).");
            }
            for ($i = 0; $i < $lvl; $i++) {
                $roll = $rolls[$i] ?? null;
                if ($roll !== null && (!is_int($roll) || $roll < 1 || $roll > $die)) {
                    $fail("Třída \"$className\": hod HP " . json_encode($roll) . " na $i. levelu není 1 až $die.");
                    $roll = null;
                }
                if ($levels === [] && $roll !== null) {
                    $fail('První level postavy má vždy plnou kostku HP, hpRolls[0] musí být null.');
                }
                $levels[] = ['classIndex' => $idx, 'hpRoll' => $roll];
            }
            $sub = is_array($c) && is_string($c['subclass'] ?? null) ? trim(preg_replace('/\s*\(.*$/', '', $c['subclass']) ?? '') : '';
            if ($sub !== '' && is_array($c['subclassHomebrew'] ?? null)) {
                // Subclass mimo SRD (třeba Cowboy): homebrew kampaně s popisem featur, postava na něj odkazuje přes idx „hb-…“.
                $desc = $c['subclassHomebrew']['description'] ?? null;
                if (!is_string($desc) || trim($desc) === '') {
                    $fail("Subclass \"$sub\": subclassHomebrew potřebuje description.");
                } else {
                    $key = 'subclass:' . mb_strtolower($sub);
                    $homebrew[$key] = ['kind' => 'subclass', 'body' => ['kind' => 'subclass', 'name' => $sub, 'category' => (string) Db::value("SELECT name FROM rules_entries WHERE kind = 'class' AND scope = '' AND idx = ?", [$idx]), 'description' => $desc]];
                    $subclassKeys[$idx] = $key;
                    $warnings[] = "Subclass $sub není v SRD: založen jako homebrew kampaně.";
                }
            } elseif ($sub !== '') {
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
        foreach (is_array($seed['spells'] ?? null) ? $seed['spells'] : [] as $classKey => $block) {
            $classIdx = strtolower((string) $classKey);
            if (!in_array($classIdx, $classIdxs, true)) {
                $fail("Kouzla třídy \"$classKey\", kterou postava nemá.");
                continue;
            }
            // subclass: kouzla, která dává archetyp (Cowboy Magic), jsou vždy připravená a nepočítají se do limitu známých kouzel
            foreach (['cantrips', 'known', 'leveled', 'subclass'] as $group) {
                foreach (is_array($block[$group] ?? null) ? $block[$group] : [] as $spellName) {
                    // SRD má přednost, jinak katalog kouzel mimo SRD (api/data/extra/warlock-spells.json)
                    $rule = Db::one("SELECT id FROM rules_entries WHERE kind = 'spell' AND is_srd = 1 AND LOWER(name) = LOWER(?)", [$spellName])
                        ?? Db::one("SELECT id FROM rules_entries WHERE kind = 'spell' AND ruleset = 'ref' AND LOWER(name) = LOWER(?)", [$spellName]);
                    if ($rule !== null) {
                        $spells[] = ['classIdx' => $classIdx, 'ruleId' => (string) $rule['id'], 'ruleKey' => null, 'always' => $group === 'subclass'];
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
            if (($entry['custom'] ?? false) === true) {
                // Vlastní předmět mimo pravidla (třeba „Robo pavouk na poplach“): jen název, druh a popis, jako ručně přidaný item.
                $kind = $entry['kind'] ?? 'other';
                if (!is_string($kind) || !in_array($kind, Items::KINDS, true)) {
                    $fail("Položka \"$itemName\": druh " . json_encode($kind) . ' neznám (' . implode(', ', Items::KINDS) . ').');
                    continue;
                }
                $items[] = [
                    'qty' => $qty, 'equipped' => ($entry['equipped'] ?? false) === true, 'attuned' => false, 'consumable' => ($entry['consumable'] ?? null) === true,
                    'ruleId' => null, 'ruleKey' => null, 'notes' => implode("\n", $itemNotes),
                    'custom' => ['name' => $itemName, 'kind' => $kind, 'description' => is_string($entry['description'] ?? null) ? $entry['description'] : ''],
                ];
                continue;
            }
            if (($entry['homebrew'] ?? false) === true) {
                $lower = strtolower($itemName);
                $weapon = self::HOMEBREW_DEFAULTS[$lower]['weapon'] ?? null;
                if (is_array($entry['weapon'] ?? null)) {
                    $given = $entry['weapon'];
                    foreach (array_keys($given) as $k) {
                        if (!in_array($k, self::WEAPON_KEYS, true)) {
                            $fail("Homebrew \"$itemName\": pole weapon.$k neznám.");
                        }
                    }
                    if (!is_string($given['damageDice'] ?? null) || preg_match('/^\d{1,2}d\d{1,3}$/', $given['damageDice']) !== 1
                        || !in_array($given['category'] ?? null, ['simple', 'martial'], true) || !in_array($given['range'] ?? null, ['melee', 'ranged'], true)) {
                        $fail("Homebrew \"$itemName\": weapon potřebuje damageDice (např. 1d6), category simple/martial a range melee/ranged.");
                        continue;
                    }
                    $weapon = [
                        'damageDice' => strtolower($given['damageDice']), 'damageType' => ucfirst(strtolower((string) ($given['damageType'] ?? 'Piercing'))),
                        'category' => $given['category'], 'range' => $given['range'],
                        'properties' => array_values(array_map('strval', is_array($given['properties'] ?? null) ? $given['properties'] : [])),
                        'versatileDice' => is_string($given['versatileDice'] ?? null) ? $given['versatileDice'] : null,
                    ];
                }
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
                if ($weapon !== null && !is_string($entry['base'] ?? null) && !is_array($entry['weapon'] ?? null)) {
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
                // SRD má přednost, jinak katalog magických itemů mimo SRD (jen fakta, třeba Masquerade Tattoo z Tasha's)
                $rule = Db::one(
                    "SELECT id FROM rules_entries WHERE campaign_id IS NULL AND kind IN ('weapon', 'armor', 'equipment', 'magic_item') AND LOWER(name) = LOWER(?) ORDER BY is_srd DESC LIMIT 1",
                    [$lookup],
                );
                if ($rule === null) {
                    $fail("Item \"$itemName\" není v SRD ani v katalogu a seed ho neoznačuje jako homebrew ani custom.");
                    continue;
                }
                $ruleId = (string) $rule['id'];
            }
            $items[] = ['qty' => $qty, 'equipped' => $equipped, 'attuned' => ($entry['attunement'] ?? null) === true, 'consumable' => ($entry['consumable'] ?? null) === true, 'ruleId' => $ruleId, 'ruleKey' => $ruleKey, 'notes' => implode("\n", $itemNotes)];
        }

        // taktiky (combat cheat sheet): validuje stejný kód jako API, takže seed nemůže uložit nic, co by UI neumělo upravit
        $inventoryNames = array_map(static fn (array $e): string => strtolower((string) ($e['item'] ?? '')), array_filter(is_array($seed['inventory'] ?? null) ? $seed['inventory'] : [], 'is_array'));
        $tactics = self::tacticsFrom($seed, $fail, $inventoryNames);

        // trvalé bonusy (třeba Fighting Style: Archery = +2 k útokům na dálku): stejné cíle a trvání jako bonusy od DM
        $effects = [];
        foreach (is_array($seed['effects'] ?? null) ? $seed['effects'] : [] as $i => $e) {
            try {
                $effect = Items::effects([['target' => $e['target'] ?? null, 'value' => $e['value'] ?? null]])[0];
                $duration = $e['duration'] ?? 'permanent';
                $source = is_string($e['source'] ?? null) ? trim($e['source']) : '';
                if (!in_array($duration, ['permanent', 'long_rest', 'manual'], true) || $source === '' || mb_strlen($source) > 60) {
                    throw HttpError::validation('duration musí být permanent, long_rest nebo manual a source text do 60 znaků.');
                }
                $effects[] = ['target' => $effect['target'], 'value' => $effect['value'], 'source' => $source, 'duration' => $duration];
            } catch (HttpError $err) {
                $fail('Bonus #' . ($i + 1) . ': ' . $err->getMessage());
            }
        }

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
            'effects' => $effects,
            'subclassKeys' => $subclassKeys,
            'create' => [
                'name' => $name,
                'race' => (string) ($char['race'] ?? ''),
                'subrace' => (string) ($char['subrace'] ?? ''),
                // rychlost rasy (trpaslík 25 ft); Fast Movement a Unarmored Movement přičte engine
                'baseSpeed' => is_int($char['baseSpeed'] ?? null) ? $char['baseSpeed'] : 30,
                'personality' => is_array($char['personality'] ?? null) ? $char['personality'] : [],
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
