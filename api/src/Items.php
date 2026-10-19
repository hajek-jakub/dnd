<?php

declare(strict_types=1);

namespace Dnd;

/** Inventář: validace položek, převod pravidel (SRD) na položku inventáře, automatické nasazení zbroje a výstup. */
final class Items
{
    /** Druhy itemů. Engine zná jen armor, shield a weapon; ostatní druhy jsou pro přehlednost a filtrování. */
    public const KINDS = ['wondrous', 'weapon', 'armor', 'shield', 'staff', 'wand', 'rod', 'scroll', 'potion', 'other'];
    public const RARITIES = ['common', 'uncommon', 'rare', 'very rare', 'legendary', 'artifact', 'varies'];
    public const MAX_ATTUNED = 3;
    /** Druhy záznamů pravidel, ze kterých jde vytvořit item. */
    public const RULE_KINDS = ['weapon', 'armor', 'equipment', 'magic_item'];
    private const SKILLS_PATTERN = 'acrobatics|animal-handling|arcana|athletics|deception|history|insight|intimidation|investigation|medicine|nature|perception|performance|persuasion|religion|sleight-of-hand|stealth|survival';
    private const EFFECT_TARGET = '/^(ac|ac\.unarmored|ac\.armored|speed|initiative|hp\.max|hp\.perLevel|proficiency|passive\.perception|damage\.all|spell\.dc|spell\.attack|ability\.(str|dex|con|int|wis|cha)|save\.(all|str|dex|con|int|wis|cha)|skill\.(all|' . self::SKILLS_PATTERN . ')|attack\.(all|melee|ranged))$/';

    // ------------------------------------------------------------------ převod pravidla na položku

    /**
     * Vytvoří položku inventáře z řádku pravidel (rules_entries).
     * Magická zbroj a zbraň (Armor +1, Dwarven Plate, Sun Blade…) dostane hodnoty základní zbroje nebo zbraně (`$baseRule`) a magický bonus;
     * bez nich by se do AC ani útoků vůbec nepočítala.
     * @param array<string, mixed> $rule
     * @param array<string, mixed>|null $baseRule zbroj nebo zbraň (SRD či homebrew), na které magický item je
     * @return array<string, mixed> pole pro insert (camelCase jako vstup API)
     */
    public static function fromRule(array $rule, ?array $baseRule = null): array
    {
        $data = self::ruleData($rule);
        $name = (string) $rule['name'];
        $kind = self::kindForRule($rule);
        $gear = self::magicGear($rule);
        $stats = [];
        $effects = [];
        $requires = false;

        switch ($rule['kind']) {
            case 'weapon':
                $stats['weapon'] = self::weaponStats($data);
                break;
            case 'armor':
                $stats['armor'] = self::armorStats($data);
                break;
            case 'magic_item':
                // Attunement: SRD ho má v hlavičce („…, rare (requires attunement)“), katalog a homebrew ve sloupci.
                $header = (string) ($data['header'] ?? '');
                $requires = $header !== '' ? preg_match('/requires attunement/i', $header) === 1 : (int) ($rule['attunement'] ?? 0) === 1;
                $effects = self::knownEffects($name);
                if ($gear !== null && $gear['type'] !== 'ammunition' && $baseRule !== null) {
                    $base = self::fromRule($baseRule);
                    $kind = (string) $base['kind'];
                    $stats = $base['stats'];
                    $bonus = self::magicBonus($rule);
                    foreach (['armor', 'weapon'] as $k) {
                        if (isset($stats[$k]) && $bonus > 0) {
                            $stats[$k]['magicBonus'] = $bonus;
                        }
                    }
                    // Mithral: bez nevýhody na Stealth a bez požadavku na sílu.
                    if (isset($stats['armor']) && preg_match('/^mithral/i', $name) === 1) {
                        $stats['armor']['stealthDisadvantage'] = false;
                        $stats['armor']['strMinimum'] = 0;
                    }
                    if ($gear['base'] === null) {
                        $name .= ' (' . $baseRule['name'] . ')';
                    }
                }
                break;
        }

        // Munice se v SRD prodává v balení (Arrow: 20 kusů za 1 gp); jeden kus z pravidel je pak celé balení.
        $bundle = $rule['kind'] === 'equipment' ? max(1, (int) (self::ruleData($rule)['quantity'] ?? 1)) : 1;
        return [
            'name' => $name,
            'description' => (string) $rule['desc_text'],
            'kind' => $kind,
            'quantity' => $bundle,
            'bundle' => $bundle,
            'requiresAttunement' => $requires,
            // munice, lektvary a svitky se používáním spotřebují
            'consumable' => in_array($kind, ['potion', 'scroll'], true) || ($gear['type'] ?? null) === 'ammunition'
                || preg_match('/^(arrow|crossbow bolt|blowgun needle|sling bullet|potion|scroll|oil|elixir|antitoxin|holy water|acid|rations|torch)/i', (string) $rule['name']) === 1,
            'rarity' => in_array($rule['rarity'], self::RARITIES, true) ? $rule['rarity'] : null,
            'stats' => $stats,
            'effects' => $effects,
            'ruleId' => (string) $rule['id'],
        ];
    }

    /**
     * Druh itemu podle pravidla: zbraně a zbroje podle dat, magické itemy podle kategorie (Potion, Wand, Ring…, u zbroje a zbraně podle hlavičky),
     * vybavení podle začátku názvu. Kategorie je spolehlivější než název (Immovable Rod, Oil of Sharpness).
     * @param array<string, mixed> $rule
     */
    public static function kindForRule(array $rule): string
    {
        switch ($rule['kind']) {
            case 'weapon':
                return 'weapon';
            case 'armor':
                return strtolower((string) (self::ruleData($rule)['armor_category'] ?? '')) === 'shield' ? 'shield' : 'armor';
            case 'magic_item':
                $gear = self::magicGear($rule);
                if ($gear !== null) {
                    return $gear['type'] === 'ammunition' ? 'other' : $gear['type'];
                }
                $category = strtolower(trim((string) ($rule['category'] ?? '')));
                foreach (['potion', 'scroll', 'wand', 'staff', 'rod'] as $k) {
                    if (str_starts_with($category, $k)) {
                        return $k;
                    }
                }
                return $category === '' ? self::kindByName((string) $rule['name'], 'wondrous') : 'wondrous';
            default:
                return self::kindByName((string) $rule['name'], 'other');
        }
    }

    /**
     * Magická zbroj, štít, zbraň nebo munice: typ a konkrétní základ („plate“, „longsword“), u obecných („any sword“, „light, medium, or heavy“) null.
     * Bere hlavičku SRD („Armor (plate), very rare“), jinak kategorii (katalog „Weapon (Longsword)“, homebrew „Armor“). Ostatní magické itemy null.
     * @param array<string, mixed> $rule
     * @return array{type: string, base: ?string}|null
     */
    public static function magicGear(array $rule): ?array
    {
        if (($rule['kind'] ?? null) !== 'magic_item') {
            return null;
        }
        $header = (string) (self::ruleData($rule)['header'] ?? '');
        $text = $header !== '' ? $header : (string) ($rule['category'] ?? '');
        if (preg_match('/^\s*(armor|weapon|ammunition)\b\s*(?:\(([^)]*)\))?/i', $text, $m) !== 1) {
            return null;
        }
        $group = strtolower($m[1]);
        $inner = strtolower(trim($m[2] ?? ''));
        if ($group === 'ammunition' || preg_match('/\b(ammunition|arrows?|bolts?|bullets?|needles?)\b/', $inner) === 1) {
            return ['type' => 'ammunition', 'base' => null];
        }
        $generic = $inner === '' || preg_match('/\bany\b|\bor\b|,/', $inner) === 1;
        if ($group === 'armor') {
            // Katalog má u některých štítů jen „Armor“ (Sentinel Shield), pak rozhodne název.
            $shield = $inner === 'shield' || ($inner === '' && preg_match('/\bshield\b/i', (string) $rule['name']) === 1);
            return $shield ? ['type' => 'shield', 'base' => 'shield'] : ['type' => 'armor', 'base' => $generic ? null : $inner];
        }
        return ['type' => 'weapon', 'base' => $generic ? null : $inner];
    }

    /**
     * Magický bonus zbroje nebo zbraně: z názvu („Armor, +1“, katalog „Shield +2“), jinak z textu („+2 bonus to AC“, „+1 bonus to attack and damage rolls“).
     * Podmíněné bonusy („+2 bonus to AC against ranged attacks“) se nepočítají.
     * @param array<string, mixed> $rule
     */
    public static function magicBonus(array $rule): int
    {
        if (preg_match('/^[^+]*(?:,\s*|\s)\+([1-3])$/', (string) $rule['name'], $m) === 1) {
            return (int) $m[1];
        }
        $desc = (string) ($rule['desc_text'] ?? '');
        if (preg_match('/\+([1-3]) bonus to AC(?! against)/i', $desc, $m) === 1 || preg_match('/\+([1-3]) bonus to attack and damage rolls/i', $desc, $m) === 1) {
            return (int) $m[1];
        }
        return 0;
    }

    /**
     * SRD zbroj nebo zbraň podle základu z hlavičky magického itemu („plate“ → Plate Armor, „studded leather“ → Studded Leather Armor).
     * @param array{type: string, base: ?string} $gear
     * @return array<string, mixed>|null
     */
    public static function baseRuleFor(array $gear): ?array
    {
        if ($gear['base'] === null || $gear['type'] === 'ammunition') {
            return null;
        }
        return Db::one(
            "SELECT * FROM rules_entries WHERE kind = ? AND campaign_id IS NULL AND ruleset = 'srd51' AND (LOWER(name) = ? OR LOWER(name) = ?) ORDER BY name LIMIT 1",
            [$gear['type'] === 'weapon' ? 'weapon' : 'armor', $gear['base'], $gear['base'] . ' armor'],
        );
    }

    /**
     * Hodí se zvolený základ k magickému itemu? Zbroj na zbroj (ne štít), štít na štít, zbraň na zbraň.
     * @param array{type: string, base: ?string} $gear
     * @param array<string, mixed> $baseRule
     */
    public static function baseFits(array $gear, array $baseRule): bool
    {
        return match ($gear['type']) {
            'weapon' => $baseRule['kind'] === 'weapon',
            'shield' => $baseRule['kind'] === 'armor' && self::kindForRule($baseRule) === 'shield',
            'armor' => $baseRule['kind'] === 'armor' && self::kindForRule($baseRule) === 'armor',
            default => false,
        };
    }

    /** @param array<string, mixed> $rule @return array<string, mixed> */
    private static function ruleData(array $rule): array
    {
        $data = json_decode((string) ($rule['data'] ?? ''), true);
        return is_array($data) ? $data : [];
    }

    private static function kindByName(string $name, string $default): string
    {
        return match (true) {
            preg_match('/^potion/i', $name) === 1 => 'potion',
            preg_match('/^(spell )?scroll/i', $name) === 1 => 'scroll',
            preg_match('/^wand/i', $name) === 1 => 'wand',
            preg_match('/^staff/i', $name) === 1 => 'staff',
            preg_match('/^rod\b/i', $name) === 1 => 'rod',
            default => $default,
        };
    }

    /** @param array<string, mixed> $data @return array<string, mixed> */
    private static function weaponStats(array $data): array
    {
        $damage = $data['damage'] ?? [];
        return [
            'damageDice' => (string) ($damage['dice'] ?? '1'),
            'damageType' => (string) ($damage['type'] ?? 'Bludgeoning'),
            'category' => strtolower((string) ($data['weapon_category'] ?? 'simple')) === 'martial' ? 'martial' : 'simple',
            'range' => strtolower((string) ($data['weapon_range'] ?? 'melee')) === 'ranged' ? 'ranged' : 'melee',
            'properties' => array_values(array_map('strval', $data['properties'] ?? [])),
            // Homebrew zbraně (a jen ony) nesou magický bonus a doplňková zranění v datech záznamu.
            'magicBonus' => max(0, min(5, (int) ($data['magic_bonus'] ?? 0))),
            'extraDamage' => self::extraDamageFromData($data['extra_damage'] ?? []),
        ];
    }

    /** @param array<string, mixed> $data @return array<string, mixed> */
    private static function armorStats(array $data): array
    {
        $ac = $data['armor_class'] ?? [];
        return [
            'base' => (int) ($ac['base'] ?? 0),
            'dexBonus' => (bool) ($ac['dex_bonus'] ?? false),
            'maxDexBonus' => isset($ac['max_bonus']) && $ac['max_bonus'] !== null ? (int) $ac['max_bonus'] : null,
            'magicBonus' => 0,
            'stealthDisadvantage' => (bool) ($data['stealth_disadvantage'] ?? false),
            'strMinimum' => (int) ($data['str_minimum'] ?? 0),
        ];
    }

    /** @return list<array{dice:string,type:string}> */
    private static function extraDamageFromData(mixed $list): array
    {
        $out = [];
        foreach (is_array($list) ? $list : [] as $e) {
            if (is_array($e) && is_string($e['dice'] ?? null) && is_string($e['type'] ?? null)) {
                $out[] = ['dice' => $e['dice'], 'type' => $e['type']];
            }
        }
        return array_slice($out, 0, 3);
    }

    /**
     * Doplňková zranění zbraně (např. 1d4 fire). Kostka NdM, nejvýš 3 položky.
     * @return list<array{dice:string,type:string}>
     */
    public static function extraDamage(mixed $list): array
    {
        if (!is_array($list) || count($list) > 3) {
            throw HttpError::validation('Doplňková zranění jsou nejvýš 3.', 'weapon');
        }
        $out = [];
        foreach ($list as $e) {
            $dice = is_array($e) ? ($e['dice'] ?? null) : null;
            $type = is_array($e) ? ($e['type'] ?? null) : null;
            if (!is_string($dice) || preg_match('/^\d{1,2}d\d{1,3}$/', $dice) !== 1 || !is_string($type) || $type === '' || mb_strlen($type) > 30) {
                throw HttpError::validation('Doplňkové zranění musí mít kostku (např. 1d4) a typ (např. Fire).', 'weapon');
            }
            $out[] = ['dice' => $dice, 'type' => $type];
        }
        return $out;
    }

    /**
     * Jednoduché aditivní efekty známých SRD itemů. Ostatní (např. "nastav STR na 19") nejdou vyjádřit jako bonus,
     * ty si hráč nebo DM doplní ručně. Bonus magické zbroje a zbraně (Armor +1, Weapon +2) je v jejích hodnotách (`magicBonus`), ne tady.
     * @return list<array{target:string,value:int,source:string}>
     */
    private static function knownEffects(string $name): array
    {
        return match ($name) {
            'Ring of Protection', 'Cloak of Protection' => [
                ['target' => 'ac', 'value' => 1, 'source' => $name],
                ['target' => 'save.all', 'value' => 1, 'source' => $name],
            ],
            // jen bez zbroje a bez štítu
            'Bracers of Defense' => [['target' => 'ac.unarmored', 'value' => 2, 'source' => $name]],
            'Rod of the Pact Keeper, +1' => [['target' => 'spell.dc', 'value' => 1, 'source' => $name], ['target' => 'spell.attack', 'value' => 1, 'source' => $name]],
            default => [],
        };
    }

    // ------------------------------------------------------------------ validace vstupu

    /**
     * @param array<string, mixed> $in
     * @return array<string, mixed>  jen zadaná (a platná) pole
     */
    public static function validate(array $in, bool $create): array
    {
        $out = [];
        $has = static fn (string $k): bool => array_key_exists($k, $in);

        if ($create || $has('name')) {
            $out['name'] = Input::string($in, 'name', 1, 200, 'Název');
        }
        if ($has('description')) {
            $out['description'] = Input::string($in, 'description', 0, 20000, 'Popis');
        }
        if ($has('notes')) {
            $out['notes'] = Input::string($in, 'notes', 0, 5000, 'Poznámky');
        }
        if ($has('kind')) {
            if (!is_string($in['kind']) || !in_array($in['kind'], self::KINDS, true)) {
                throw HttpError::validation('Neplatný druh itemu.', 'kind');
            }
            $out['kind'] = $in['kind'];
        }
        if ($has('quantity')) {
            $q = Input::optionalInt($in, 'quantity', $create ? 1 : 0, 9999, 'Množství'); // úprava smí zadat 0 = spotřebovaný item (došly šípy), zůstane v seznamu
            if ($q === null) {
                throw HttpError::validation('Množství je povinné.', 'quantity');
            }
            $out['quantity'] = $q;
        }
        if ($has('curse')) {
            $c = $in['curse'];
            if ($c !== null && (!is_string($c) || mb_strlen($c) > 5000)) {
                throw HttpError::validation('Kletba musí být text do 5000 znaků (nebo null).', 'curse');
            }
            $out['curse'] = $c === null || trim($c) === '' ? null : $c;
            if ($out['curse'] === null) {
                $out['curse_revealed'] = 0; // bez kletby není co odhalovat
            }
        }
        foreach (['equipped' => 'equipped', 'attuned' => 'attuned', 'requiresAttunement' => 'requires_attunement', 'consumable' => 'consumable', 'curseRevealed' => 'curse_revealed'] as $key => $column) {
            if ($has($key)) {
                if (!is_bool($in[$key])) {
                    throw HttpError::validation("$key musí být true/false.", $key);
                }
                $out[$column] = $in[$key] ? 1 : 0;
            }
        }
        if ($has('rarity')) {
            $r = $in['rarity'];
            if ($r !== null && (!is_string($r) || !in_array($r, self::RARITIES, true))) {
                throw HttpError::validation('Neplatná vzácnost.', 'rarity');
            }
            $out['rarity'] = $r;
        }
        if ($has('effects')) {
            $out['effects'] = self::effects($in['effects']);
        }
        if ($has('armor') || $has('weapon')) {
            $stats = [];
            if ($has('armor') && $in['armor'] !== null) {
                $stats['armor'] = self::armor($in['armor']);
            }
            if ($has('weapon') && $in['weapon'] !== null) {
                $stats['weapon'] = self::weapon($in['weapon']);
            }
            $out['stats'] = $stats;
        }
        return $out;
    }

    /** @return list<array{target:string,value:int,source:string}> */
    public static function effects(mixed $list): array
    {
        if (!is_array($list) || count($list) > 12) {
            throw HttpError::validation('Efektů je nejvýš 12.', 'effects');
        }
        $out = [];
        foreach ($list as $e) {
            $target = is_array($e) ? ($e['target'] ?? null) : null;
            $value = is_array($e) ? ($e['value'] ?? null) : null;
            if (!is_string($target) || preg_match(self::EFFECT_TARGET, $target) !== 1 || !is_int($value) || $value < -100 || $value > 100) {
                throw HttpError::validation('Neplatný efekt (cíl nebo hodnota).', 'effects');
            }
            $source = isset($e['source']) && is_string($e['source']) ? mb_substr($e['source'], 0, 60) : '';
            $out[] = ['target' => $target, 'value' => $value, 'source' => $source];
        }
        return $out;
    }

    /** @return array<string, mixed> */
    private static function armor(mixed $a): array
    {
        if (!is_array($a)) {
            throw HttpError::validation('Zbroj má neplatný tvar.', 'armor');
        }
        $base = $a['base'] ?? null;
        if (!is_int($base) || $base < 0 || $base > 30) {
            throw HttpError::validation('Základní AC musí být 0 až 30.', 'armor');
        }
        $maxDex = $a['maxDexBonus'] ?? null;
        if ($maxDex !== null && (!is_int($maxDex) || $maxDex < 0 || $maxDex > 10)) {
            throw HttpError::validation('Limit DEX musí být 0 až 10.', 'armor');
        }
        $magic = $a['magicBonus'] ?? 0;
        $str = $a['strMinimum'] ?? 0;
        if (!is_int($magic) || $magic < -5 || $magic > 5 || !is_int($str) || $str < 0 || $str > 30) {
            throw HttpError::validation('Neplatný bonus nebo požadavek na sílu.', 'armor');
        }
        return [
            'base' => $base, 'dexBonus' => ($a['dexBonus'] ?? false) === true, 'maxDexBonus' => $maxDex, 'magicBonus' => $magic,
            'stealthDisadvantage' => ($a['stealthDisadvantage'] ?? false) === true, 'strMinimum' => $str,
        ];
    }

    /** @return array<string, mixed> */
    private static function weapon(mixed $w): array
    {
        if (!is_array($w)) {
            throw HttpError::validation('Zbraň má neplatný tvar.', 'weapon');
        }
        $dice = $w['damageDice'] ?? null;
        if (!is_string($dice) || preg_match('/^(\d{1,2}d\d{1,3}|\d{1,3})$/', $dice) !== 1) {
            throw HttpError::validation("Kostka zranění musí mít tvar např. 1d8.", 'weapon');
        }
        $category = $w['category'] ?? 'simple';
        $range = $w['range'] ?? 'melee';
        $magic = $w['magicBonus'] ?? 0;
        if (!in_array($category, ['simple', 'martial'], true) || !in_array($range, ['melee', 'ranged'], true) || !is_int($magic) || $magic < 0 || $magic > 5) {
            throw HttpError::validation('Neplatná kategorie, dosah nebo magický bonus zbraně.', 'weapon');
        }
        $props = $w['properties'] ?? [];
        if (!is_array($props) || count($props) > 12) {
            throw HttpError::validation('Neplatné vlastnosti zbraně.', 'weapon');
        }
        $cleanProps = [];
        foreach ($props as $p) {
            if (!is_string($p) || $p === '' || mb_strlen($p) > 30) {
                throw HttpError::validation('Neplatná vlastnost zbraně.', 'weapon');
            }
            $cleanProps[] = $p;
        }
        $type = $w['damageType'] ?? 'Bludgeoning';
        if (!is_string($type) || mb_strlen($type) > 30) {
            throw HttpError::validation('Neplatný typ zranění.', 'weapon');
        }
        return [
            'damageDice' => $dice, 'damageType' => $type, 'category' => $category, 'range' => $range, 'properties' => $cleanProps, 'magicBonus' => $magic,
            'extraDamage' => self::extraDamage($w['extraDamage'] ?? []),
        ];
    }

    // ------------------------------------------------------------------ výstup

    /**
     * @param list<array<string, mixed>> $rows
     * @param bool $revealCurses true jen pro DM: jinak se neodhalená kletba do výstupu vůbec nedostane (ani náznak, že existuje)
     * @return array<string, list<array<string, mixed>>> podle id postavy
     */
    public static function loadMany(array $rows, bool $revealCurses = false): array
    {
        $out = [];
        foreach ($rows as $r) {
            $stats = Sheets::json($r['stats'], []);
            $stats = is_array($stats) ? $stats : [];
            $curse = $r['curse'] ?? null;
            $revealed = (bool) ($r['curse_revealed'] ?? false);
            $out[$r['character_id']][] = [
                'id' => $r['id'],
                'ruleId' => $r['rule_id'],
                'name' => $r['name'],
                'description' => $r['description'],
                'kind' => $r['kind'],
                'quantity' => (int) $r['quantity'],
                'equipped' => (bool) $r['equipped'],
                'attuned' => (bool) $r['attuned'],
                'requiresAttunement' => (bool) $r['requires_attunement'],
                'consumable' => (bool) $r['consumable'],
                'curse' => $curse === null || $curse === '' || (!$revealed && !$revealCurses) ? null : ['text' => (string) $curse, 'revealed' => $revealed],
                'rarity' => $r['rarity'],
                'armor' => $stats['armor'] ?? null,
                'weapon' => $stats['weapon'] ?? null,
                'effects' => Sheets::json($r['effects'], []),
                'notes' => (string) ($r['notes'] ?? ''),
            ];
        }
        return $out;
    }

    /**
     * Sloučený item (sloupce, viz `InventoryController::buildItem`) převede zpět na tvar vstupu API. Tak ho ukládá loot DM:
     * jako samostatnou kopii bez vazby na pravidla, která jde upravit ve formuláři a později rozdat stejnou cestou jako vlastní item.
     * @param array<string, mixed> $item
     * @return array<string, mixed>
     */
    public static function toInput(array $item): array
    {
        $stats = is_array($item['stats'] ?? null) ? $item['stats'] : [];
        return [
            'name' => (string) $item['name'],
            'description' => (string) $item['description'],
            'kind' => (string) $item['kind'],
            'quantity' => (int) $item['quantity'],
            'requiresAttunement' => (bool) $item['requires_attunement'],
            'consumable' => (bool) $item['consumable'],
            'rarity' => $item['rarity'],
            'notes' => (string) $item['notes'],
            'armor' => $stats['armor'] ?? null,
            'weapon' => $stats['weapon'] ?? null,
            'effects' => $item['effects'],
            'curse' => $item['curse'],
            'curseRevealed' => $item['curse'] !== null && (int) $item['curse_revealed'] === 1,
        ];
    }

    // ------------------------------------------------------------------ nasazení zbroje

    /**
     * Nově získanou zbroj nebo štít postava rovnou nosí, když nic stejného druhu nenosí a umí ji nosit (jinak by se AC po předání zbroje nezměnilo).
     * Nenasadí se: mnichovi (zbroj i štít mu vezmou Unarmored Defense, Martial Arts a Unarmored Movement), zbroj barbarovi (Unarmored Defense bývá lepší)
     * a postavě bez proficiency (kouzelník ve zbroji nemůže sesílat). Attunement nevadí, základní AC zbroje platí i bez něj. Volat pod zámkem postavy.
     */
    public static function autoEquip(string $characterId, string $itemId): bool
    {
        $item = Db::one('SELECT id, kind, stats FROM character_items WHERE id = ? AND character_id = ?', [$itemId, $characterId]);
        if ($item === null || !in_array($item['kind'], ['armor', 'shield'], true)) {
            return false;
        }
        $stats = Sheets::json($item['stats'], []);
        $armor = is_array($stats) ? ($stats['armor'] ?? null) : null;
        if (!is_array($armor)) {
            return false; // bez hodnot by AC nezměnila, jen by blokovala další zbroj
        }
        if (!self::wearsWell($characterId, (string) $item['kind'], $armor)) {
            return false;
        }
        if (Db::one('SELECT id FROM character_items WHERE character_id = ? AND kind = ? AND equipped = 1 AND id <> ?', [$characterId, $item['kind'], $itemId]) !== null) {
            return false;
        }
        Db::exec('UPDATE character_items SET equipped = 1, updated_at = UTC_TIMESTAMP() WHERE id = ?', [$itemId]);
        return true;
    }

    /**
     * Nosí postava zbroj (štít) tohoto druhu bez ztráty? Ne mnich, zbroj ne barbar, a jen s proficiency: první třída dává všechny své,
     * další třídy jen to, co dává multiclassing (SRD). Proficiency z rasy nebo subclassu se nepočítá (pak si zbroj nasadí hráč sám).
     * @param array<string, mixed> $armor hodnoty zbroje (base, dexBonus, maxDexBonus, …)
     */
    private static function wearsWell(string $characterId, string $kind, array $armor): bool
    {
        $classes = array_values(array_unique(array_column(Db::all('SELECT class_idx FROM character_levels WHERE character_id = ? ORDER BY seq', [$characterId]), 'class_idx')));
        if (in_array('monk', $classes, true) || ($kind === 'armor' && in_array('barbarian', $classes, true))) {
            return false;
        }
        $profs = [];
        foreach ($classes as $i => $classIdx) {
            $row = Db::one("SELECT data FROM rules_entries WHERE kind = 'class' AND idx = ? AND campaign_id IS NULL ORDER BY ruleset LIMIT 1", [$classIdx]);
            $data = json_decode((string) ($row['data'] ?? ''), true);
            $list = $i === 0 ? ($data['proficiencies'] ?? []) : ($data['multi_classing']['proficiencies'] ?? []);
            foreach (is_array($list) ? $list : [] as $p) {
                if (is_array($p) && is_string($p['index'] ?? null)) {
                    $profs[$p['index']] = true;
                }
            }
        }
        if ($kind === 'shield') {
            return isset($profs['shields']);
        }
        $category = empty($armor['dexBonus']) ? 'heavy-armor' : (($armor['maxDexBonus'] ?? null) !== null ? 'medium-armor' : 'light-armor');
        return isset($profs['all-armor']) || isset($profs[$category]);
    }

    /**
     * Oprava itemů rozdaných dřív, než se magická zbroj a zbraň převáděly na skutečnou zbroj a zbraň (Dwarven Plate se do AC nepočítala).
     * Idempotentní, běží při každém seedu (i při nasazení). Mění jen to, co je potřeba:
     *  - magická zbroj, štít nebo zbraň s jasným základem bez hodnot dostane druh a hodnoty; zbroj a štít se nasadí podle `autoEquip`
     *    (obecné, např. Armor +1 bez základu, zůstanou a DM je předá znovu s výběrem základu),
     *  - Bracers of Defense: bonus k AC platí jen bez zbroje a štítu (`ac.unarmored`),
     *  - starý druh `item` → `other`.
     * Nesmí běžet uvnitř jiné transakce.
     * @return list<string> co se opravilo („Dwarven Plate (Batan)“), kvůli výpisu při nasazení
     */
    public static function repairMagicGear(): array
    {
        $fixed = [];
        $rows = Db::all(
            "SELECT i.id AS item_id, i.character_id, i.stats AS item_stats, i.effects AS item_effects, i.kind AS item_kind, c.name AS character_name, r.*
             FROM character_items i JOIN rules_entries r ON r.id = i.rule_id JOIN characters c ON c.id = i.character_id
             WHERE r.kind = 'magic_item' AND (i.kind NOT IN ('armor', 'shield', 'weapon') OR r.name = 'Bracers of Defense')",
        );
        foreach ($rows as $row) {
            $label = $row['name'] . ' (' . $row['character_name'] . ')';
            if ($row['name'] === 'Bracers of Defense') {
                $effects = Sheets::json($row['item_effects'], []);
                $changed = false;
                foreach (is_array($effects) ? $effects : [] as $i => $e) {
                    if (is_array($e) && ($e['target'] ?? null) === 'ac') {
                        $effects[$i]['target'] = 'ac.unarmored';
                        $changed = true;
                    }
                }
                if ($changed) {
                    Db::exec('UPDATE character_items SET effects = ?, updated_at = UTC_TIMESTAMP() WHERE id = ?', [Sheets::enc($effects), $row['item_id']]);
                    $fixed[] = $label;
                }
                continue;
            }
            $gear = self::magicGear($row);
            $stats = Sheets::json($row['item_stats'], []);
            if ($gear === null || (is_array($stats) && (isset($stats['armor']) || isset($stats['weapon'])))) {
                continue;
            }
            $baseRule = self::baseRuleFor($gear);
            if ($baseRule === null) {
                continue;
            }
            $item = self::fromRule($row, $baseRule);
            Db::transaction(static function () use ($row, $item): void {
                Db::one('SELECT id FROM characters WHERE id = ? FOR UPDATE', [$row['character_id']]);
                $wearable = in_array($item['kind'], ['armor', 'shield'], true);
                // Zbroj „u sebe“ nemusí znamenat oblečenou (mnich, kouzelník): nasadí se znovu podle stejných pravidel jako nově získaná.
                Db::exec(
                    'UPDATE character_items SET kind = ?, stats = ?' . ($wearable ? ', equipped = 0' : '') . ', updated_at = UTC_TIMESTAMP() WHERE id = ?',
                    [$item['kind'], Sheets::enc($item['stats']), $row['item_id']],
                );
                if ($wearable) {
                    self::autoEquip((string) $row['character_id'], (string) $row['item_id']);
                }
            });
            $fixed[] = $label;
        }
        // Druh `item` už neexistuje (mohl ho zapsat starý kód během nasazování, před migrací).
        foreach (Db::all("SELECT i.id, i.name, c.name AS character_name FROM character_items i JOIN characters c ON c.id = i.character_id WHERE i.kind = 'item'") as $row) {
            Db::exec("UPDATE character_items SET kind = 'other' WHERE id = ?", [$row['id']]);
            $fixed[] = $row['name'] . ' (' . $row['character_name'] . ')';
        }
        return $fixed;
    }
}
