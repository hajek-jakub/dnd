<?php

declare(strict_types=1);

namespace Dnd;

/** Inventář: validace položek, převod pravidel (SRD) na položku inventáře a výstup. */
final class Items
{
    public const KINDS = ['armor', 'shield', 'weapon', 'item'];
    public const RARITIES = ['common', 'uncommon', 'rare', 'very rare', 'legendary', 'artifact', 'varies'];
    public const MAX_ATTUNED = 3;
    private const SKILLS_PATTERN = 'acrobatics|animal-handling|arcana|athletics|deception|history|insight|intimidation|investigation|medicine|nature|perception|performance|persuasion|religion|sleight-of-hand|stealth|survival';
    private const EFFECT_TARGET = '/^(ac|speed|initiative|hp\.max|hp\.perLevel|proficiency|passive\.perception|damage\.all|spell\.dc|spell\.attack|ability\.(str|dex|con|int|wis|cha)|save\.(all|str|dex|con|int|wis|cha)|skill\.(all|' . self::SKILLS_PATTERN . ')|attack\.(all|melee|ranged))$/';

    // ------------------------------------------------------------------ převod pravidla na položku

    /**
     * Vytvoří položku inventáře z řádku pravidel (rules_entries).
     * @param array<string, mixed> $rule
     * @return array<string, mixed> pole pro insert (camelCase jako vstup API)
     */
    public static function fromRule(array $rule): array
    {
        $data = json_decode((string) $rule['data'], true);
        $data = is_array($data) ? $data : [];
        $kind = 'item';
        $stats = [];
        $effects = [];
        $requires = false;

        switch ($rule['kind']) {
            case 'weapon':
                $kind = 'weapon';
                $damage = $data['damage'] ?? [];
                $stats['weapon'] = [
                    'damageDice' => (string) ($damage['dice'] ?? '1'),
                    'damageType' => (string) ($damage['type'] ?? 'Bludgeoning'),
                    'category' => strtolower((string) ($data['weapon_category'] ?? 'simple')) === 'martial' ? 'martial' : 'simple',
                    'range' => strtolower((string) ($data['weapon_range'] ?? 'melee')) === 'ranged' ? 'ranged' : 'melee',
                    'properties' => array_values(array_map('strval', $data['properties'] ?? [])),
                    // Homebrew zbraně (a jen ony) nesou magický bonus a doplňková zranění v datech záznamu.
                    'magicBonus' => max(0, min(5, (int) ($data['magic_bonus'] ?? 0))),
                    'extraDamage' => self::extraDamageFromData($data['extra_damage'] ?? []),
                ];
                break;
            case 'armor':
                $ac = $data['armor_class'] ?? [];
                $isShield = strtolower((string) ($data['armor_category'] ?? '')) === 'shield';
                $kind = $isShield ? 'shield' : 'armor';
                $stats['armor'] = [
                    'base' => (int) ($ac['base'] ?? 0),
                    'dexBonus' => (bool) ($ac['dex_bonus'] ?? false),
                    'maxDexBonus' => isset($ac['max_bonus']) && $ac['max_bonus'] !== null ? (int) $ac['max_bonus'] : null,
                    'magicBonus' => 0,
                    'stealthDisadvantage' => (bool) ($data['stealth_disadvantage'] ?? false),
                    'strMinimum' => (int) ($data['str_minimum'] ?? 0),
                ];
                break;
            case 'magic_item':
                $header = (string) ($data['header'] ?? '');
                $requires = preg_match('/requires attunement/i', $header) === 1;
                $effects = self::knownEffects((string) $rule['name']);
                break;
        }

        return [
            'name' => (string) $rule['name'],
            'description' => (string) $rule['desc_text'],
            'kind' => $kind,
            'quantity' => 1,
            'requiresAttunement' => $requires,
            // munice, lektvary a svitky se používáním spotřebují
            'consumable' => preg_match('/^(arrow|crossbow bolt|blowgun needle|sling bullet|potion|scroll|oil|elixir|antitoxin|holy water|acid|rations|torch)/i', (string) $rule['name']) === 1,
            'rarity' => in_array($rule['rarity'], self::RARITIES, true) ? $rule['rarity'] : null,
            'stats' => $stats,
            'effects' => $effects,
            'ruleId' => (string) $rule['id'],
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
     * ty si hráč nebo DM doplní ručně.
     * @return list<array{target:string,value:int,source:string}>
     */
    private static function knownEffects(string $name): array
    {
        if (preg_match('/^(Armor|Shield), \+(\d)$/', $name, $m) === 1) {
            return [['target' => 'ac', 'value' => (int) $m[2], 'source' => $name]];
        }
        if (preg_match('/^Weapon, \+(\d)$/', $name, $m) === 1) {
            return [['target' => 'attack.all', 'value' => (int) $m[1], 'source' => $name], ['target' => 'damage.all', 'value' => (int) $m[1], 'source' => $name]];
        }
        return match ($name) {
            'Ring of Protection', 'Cloak of Protection' => [
                ['target' => 'ac', 'value' => 1, 'source' => $name],
                ['target' => 'save.all', 'value' => 1, 'source' => $name],
            ],
            'Bracers of Defense' => [['target' => 'ac', 'value' => 2, 'source' => $name]],
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
        foreach (['equipped' => 'equipped', 'attuned' => 'attuned', 'requiresAttunement' => 'requires_attunement', 'consumable' => 'consumable'] as $key => $column) {
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
     * @return array<string, list<array<string, mixed>>> podle id postavy
     */
    public static function loadMany(array $rows): array
    {
        $out = [];
        foreach ($rows as $r) {
            $stats = Sheets::json($r['stats'], []);
            $stats = is_array($stats) ? $stats : [];
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
                'rarity' => $r['rarity'],
                'armor' => $stats['armor'] ?? null,
                'weapon' => $stats['weapon'] ?? null,
                'effects' => Sheets::json($r['effects'], []),
                'notes' => (string) ($r['notes'] ?? ''),
            ];
        }
        return $out;
    }
}
