<?php

declare(strict_types=1);

namespace Dnd;

/** Character sheet: validace vstupu, načtení a uložení (vlastnosti, levely, zdroje, stav). */
final class Sheets
{
    public const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
    public const SKILLS = [
        'acrobatics', 'animal-handling', 'arcana', 'athletics', 'deception', 'history', 'insight', 'intimidation', 'investigation',
        'medicine', 'nature', 'perception', 'performance', 'persuasion', 'religion', 'sleight-of-hand', 'stealth', 'survival',
    ];
    /** Level třídy, na kterém se vybírá subclass. */
    public const SUBCLASS_LEVEL = [
        'cleric' => 1, 'sorcerer' => 1, 'warlock' => 1, 'druid' => 2, 'wizard' => 2,
        'barbarian' => 3, 'bard' => 3, 'fighter' => 3, 'monk' => 3, 'paladin' => 3, 'ranger' => 3, 'rogue' => 3,
    ];
    public const MAX_LEVEL = 20;
    private const RECHARGE = ['short', 'long', 'dawn', 'manual'];

    // ------------------------------------------------------------------ čtení

    /**
     * Doplní k řádkům postav levely a zdroje a vrátí kompletní sheet pro každou.
     * @param list<array<string, mixed>> $rows
     * @param bool $revealCurses jen pro DM: jinak neodhalené kletby na itemech ve výstupu nejsou (viz Items::loadMany)
     * @return array<string, array<string, mixed>> podle id postavy
     */
    public static function loadMany(array $rows, bool $revealCurses = false): array
    {
        if ($rows === []) {
            return [];
        }
        $ids = array_map(static fn (array $r): string => (string) $r['id'], $rows);
        $in = implode(',', array_fill(0, count($ids), '?'));
        $levels = [];
        foreach (Db::all("SELECT character_id, class_idx, hp_roll, choices FROM character_levels WHERE character_id IN ($in) ORDER BY character_id, seq", $ids) as $l) {
            $levels[$l['character_id']][] = ['classIndex' => $l['class_idx'], 'hpRoll' => $l['hp_roll'] === null ? null : (int) $l['hp_roll'], 'choices' => self::json($l['choices'], new \stdClass())];
        }
        $current = [];
        $custom = [];
        foreach (Db::all("SELECT * FROM character_resources WHERE character_id IN ($in)", $ids) as $r) {
            $current[$r['character_id']][$r['rkey']] = (int) $r['current_value'];
            if ($r['is_custom']) {
                $custom[$r['character_id']][] = ['key' => $r['rkey'], 'name' => (string) $r['name'], 'max' => (int) $r['max_value'], 'recharge' => (string) $r['recharge']];
            }
        }

        $items = Items::loadMany(Db::all("SELECT * FROM character_items WHERE character_id IN ($in) ORDER BY created_at, id", $ids), $revealCurses);
        $spells = [];
        foreach (Db::all(
            "SELECT cs.id, cs.character_id, cs.rule_id, cs.class_idx, cs.prepared, cs.always_prepared, cs.source, e.name, e.level, e.category, e.data
             FROM character_spells cs JOIN rules_entries e ON e.id = cs.rule_id
             WHERE cs.character_id IN ($in) ORDER BY e.level, e.name",
            $ids,
        ) as $sp) {
            $d = Sheets::json($sp['data'], []);
            $d = is_array($d) ? $d : [];
            $components = $d['components'] ?? '';
            $spells[$sp['character_id']][] = [
                'id' => $sp['id'],
                'ruleId' => $sp['rule_id'],
                'classIdx' => $sp['class_idx'],
                'prepared' => (bool) $sp['prepared'],
                'alwaysPrepared' => (bool) $sp['always_prepared'],
                'source' => $sp['source'],
                'name' => $sp['name'],
                'level' => (int) $sp['level'],
                'school' => (string) ($sp['category'] ?? ''),
                'castingTime' => (string) ($d['casting_time'] ?? ''),
                'range' => (string) ($d['range'] ?? ''),
                'components' => is_array($components) ? implode(', ', $components) : (string) $components,
                'duration' => (string) ($d['duration'] ?? ''),
                'concentration' => ($d['concentration'] ?? false) === true,
                'ritual' => ($d['ritual'] ?? false) === true,
            ];
        }

        $effects = [];
        foreach (Db::all("SELECT id, character_id, target, value, source, duration FROM character_effects WHERE character_id IN ($in) ORDER BY created_at, id", $ids) as $e) {
            $effects[$e['character_id']][] = ['id' => $e['id'], 'target' => $e['target'], 'value' => (int) $e['value'], 'source' => $e['source'], 'duration' => $e['duration']];
        }

        $out = [];
        foreach ($rows as $r) {
            $id = (string) $r['id'];
            $out[$id] = [
                'id' => $id,
                'campaignId' => $r['campaign_id'],
                'ownerId' => $r['owner_id'],
                'kind' => $r['kind'],
                'name' => $r['name'],
                'race' => $r['race'],
                'subrace' => $r['subrace'],
                'background' => $r['background'],
                'alignment' => $r['alignment'],
                'inspiration' => (bool) $r['inspiration'],
                'description' => (string) ($r['description'] ?? ''),
                'personality' => self::json($r['personality'], ['traits' => '', 'ideals' => '', 'bonds' => '', 'flaws' => '']),
                'notes' => $r['notes'],
                'visibility' => $r['visibility'],
                'photoVersion' => $r['photo_path'] === null ? null : substr(md5((string) $r['photo_path']), 0, 10),
                'abilityScores' => [
                    'str' => (int) $r['abil_str'], 'dex' => (int) $r['abil_dex'], 'con' => (int) $r['abil_con'],
                    'int' => (int) $r['abil_int'], 'wis' => (int) $r['abil_wis'], 'cha' => (int) $r['abil_cha'],
                ],
                'baseSpeed' => (int) $r['base_speed'],
                'levels' => $levels[$id] ?? [],
                'subclasses' => self::json($r['subclasses'], new \stdClass()),
                'skillProficiencies' => self::json($r['skill_proficiencies'], new \stdClass()),
                'extraSaveProficiencies' => self::json($r['extra_save_proficiencies'], []),
                'extraProficiencies' => self::json($r['extra_proficiencies'], []),
                'overrides' => self::json($r['overrides'], new \stdClass()),
                'customResources' => $custom[$id] ?? [],
                'effects' => $effects[$id] ?? [],
                'items' => $items[$id] ?? [],
                'spells' => $spells[$id] ?? [],
                'currency' => self::json($r['currency'], ['cp' => 0, 'sp' => 0, 'ep' => 0, 'gp' => 0, 'pp' => 0]),
                'state' => [
                    'hpCurrent' => $r['hp_current'] === null ? null : (int) $r['hp_current'],
                    'hpTemp' => (int) $r['hp_temp'],
                    'deathSuccesses' => (int) $r['death_successes'],
                    'deathFailures' => (int) $r['death_failures'],
                    'hitDiceUsed' => self::json($r['hit_dice_used'], new \stdClass()),
                    'slotsUsed' => self::json($r['slots_used'], new \stdClass()),
                    'pactSlotsUsed' => (int) $r['pact_slots_used'],
                    'resources' => $current[$id] ?? new \stdClass(),
                    'conditions' => self::json($r['conditions'], []),
                    'concentration' => $r['concentration'] ?? null,
                ],
                'rev' => (int) $r['rev'],
                'createdAt' => Ids::iso((string) $r['created_at']),
                'updatedAt' => Ids::iso((string) $r['updated_at']),
            ];
        }
        return $out;
    }

    /** @return mixed */
    public static function json(mixed $value, mixed $default): mixed
    {
        if (!is_string($value) || $value === '') {
            return $default;
        }
        $decoded = json_decode($value, true);
        if ($decoded === null) {
            return $default;
        }
        // Prázdné pole z JSON objektu by se v odpovědi změnilo na [], proto se vrací výchozí objekt.
        return ($decoded === [] && $default instanceof \stdClass) ? $default : $decoded;
    }

    public static function enc(mixed $value): string
    {
        return json_encode($value === [] ? new \stdClass() : $value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    }

    /**
     * Načte postavu, kterou smí volající měnit (majitel nebo DM). Cizinec dostane 404, jiný hráč 403.
     * @param array{id:string} $user
     * @return array<string, mixed>
     */
    public static function loadMutable(string $id, array $user): array
    {
        $row = Ids::isUuid($id) ? Db::one('SELECT * FROM characters WHERE id = ?', [$id]) : null;
        $role = $row === null ? null : Access::role($user['id'], (string) $row['campaign_id']);
        if ($row === null || $role === null) {
            throw HttpError::notFound('Postava nenalezena.');
        }
        if ($row['owner_id'] !== $user['id'] && $role !== 'dm') {
            throw HttpError::forbidden('Cizí postavu nemůžeš upravovat.');
        }
        return $row;
    }

    /**
     * Zranění nebo léčení: zranění nejdřív spotřebuje dočasná HP, výsledek se ořízne na 0 až max.
     * @return array{hp:int, temp:int}
     */
    public static function applyHp(?int $hp, int $temp, int $delta, int $max): array
    {
        $hp ??= $max;
        if ($delta < 0) {
            $absorbed = min($temp, -$delta);
            $temp -= $absorbed;
            $delta += $absorbed;
        }
        return ['hp' => max(0, min($max, $hp + $delta)), 'temp' => $temp];
    }

    // ------------------------------------------------------------------ validace

    /** @param array<string, mixed> $in @return array<string, int> */
    public static function abilityScores(array $in, string $field = 'abilityScores'): array
    {
        $scores = $in[$field] ?? null;
        if (!is_array($scores)) {
            throw HttpError::validation('Vlastnosti jsou povinné.', $field);
        }
        $out = [];
        foreach (self::ABILITIES as $a) {
            $v = $scores[$a] ?? null;
            if (!is_int($v) || $v < 1 || $v > 30) {
                throw HttpError::validation("Vlastnost $a musí být celé číslo od 1 do 30.", $field);
            }
            $out[$a] = $v;
        }
        return $out;
    }

    /** @param array<string, mixed> $in @return array<string, int> */
    public static function skills(array $in): array
    {
        $skills = $in['skillProficiencies'] ?? [];
        if (!is_array($skills)) {
            throw HttpError::validation('Dovednosti mají neplatný tvar.', 'skillProficiencies');
        }
        $out = [];
        foreach ($skills as $key => $level) {
            if (!in_array($key, self::SKILLS, true) || !in_array($level, [0, 1, 2], true)) {
                throw HttpError::validation('Neplatná dovednost nebo úroveň (0, 1 nebo 2).', 'skillProficiencies');
            }
            if ($level > 0) {
                $out[$key] = $level;
            }
        }
        return $out;
    }

    /** @param array<string, mixed> $in @return list<string> */
    public static function stringList(array $in, string $field, int $maxItems = 40, int $maxLen = 60): array
    {
        $list = $in[$field] ?? [];
        if (!is_array($list) || count($list) > $maxItems) {
            throw HttpError::validation('Seznam má neplatný tvar nebo je příliš dlouhý.', $field);
        }
        $out = [];
        foreach ($list as $item) {
            if (!is_string($item) || mb_strlen(trim($item)) === 0 || mb_strlen($item) > $maxLen) {
                throw HttpError::validation('Položky seznamu musí být neprázdné texty.', $field);
            }
            $out[] = trim($item);
        }
        return array_values(array_unique($out));
    }

    /** @param array<string, mixed> $in @return list<string> */
    public static function saveProficiencies(array $in): array
    {
        $list = self::stringList($in, 'extraSaveProficiencies', 6, 3);
        foreach ($list as $a) {
            if (!in_array($a, self::ABILITIES, true)) {
                throw HttpError::validation('Neplatná vlastnost pro záchranný hod.', 'extraSaveProficiencies');
            }
        }
        return $list;
    }

    /** @param array<string, mixed> $in @return array<string, int|float> */
    public static function overrides(array $in): array
    {
        $o = $in['overrides'] ?? [];
        if (!is_array($o) || count($o) > 80) {
            throw HttpError::validation('Přepisy mají neplatný tvar.', 'overrides');
        }
        $out = [];
        foreach ($o as $key => $value) {
            if (!is_string($key) || preg_match('/^[a-zA-Z0-9._-]{1,80}$/', $key) !== 1 || (!is_int($value) && !is_float($value)) || abs($value) > 100000) {
                throw HttpError::validation('Neplatný přepis hodnoty.', 'overrides');
            }
            $out[$key] = $value;
        }
        return $out;
    }

    /** @param array<string, mixed> $in @return list<array{key:string,name:string,max:int,recharge:string}> */
    public static function customResources(array $in): array
    {
        $list = $in['customResources'] ?? [];
        if (!is_array($list) || count($list) > 20) {
            throw HttpError::validation('Vlastních zdrojů je nejvýš 20.', 'customResources');
        }
        $out = [];
        foreach ($list as $r) {
            if (!is_array($r)) {
                throw HttpError::validation('Neplatný zdroj.', 'customResources');
            }
            $key = $r['key'] ?? null;
            $max = $r['max'] ?? null;
            $recharge = $r['recharge'] ?? null;
            if (!is_string($key) || preg_match('/^custom\.[a-zA-Z0-9_-]{1,60}$/', $key) !== 1 || !is_string($recharge) || !in_array($recharge, self::RECHARGE, true)
                || !is_int($max) || $max < 0 || $max > 9999) {
                throw HttpError::validation('Neplatný vlastní zdroj.', 'customResources');
            }
            $out[] = ['key' => $key, 'name' => Input::string($r, 'name', 1, 60, 'Název zdroje'), 'max' => $max, 'recharge' => $recharge];
        }
        return $out;
    }

    /** @param array<string, mixed> $in @return array<string, mixed> */
    public static function personality(array $in): array
    {
        $p = $in['personality'] ?? [];
        if (!is_array($p)) {
            throw HttpError::validation('Osobnost má neplatný tvar.', 'personality');
        }
        $out = [];
        foreach (['traits', 'ideals', 'bonds', 'flaws'] as $k) {
            $out[$k] = isset($p[$k]) ? Input::string($p, $k, 0, 2000, 'Osobnost') : '';
        }
        return $out;
    }

    /** @param array<string, mixed> $in @return array<string, int> */
    public static function currency(array $in): array
    {
        $c = $in['currency'] ?? [];
        if (!is_array($c)) {
            throw HttpError::validation('Peníze mají neplatný tvar.', 'currency');
        }
        $out = [];
        foreach (['cp', 'sp', 'ep', 'gp', 'pp'] as $coin) {
            $v = $c[$coin] ?? 0;
            if (!is_int($v) || $v < 0 || $v > 1_000_000_000) {
                throw HttpError::validation("Mince $coin musí být celé číslo od 0.", 'currency');
            }
            $out[$coin] = $v;
        }
        return $out;
    }

    /**
     * Ověří a normalizuje stav postavy (HP, sloty, zdroje, ...).
     * @param array<string, mixed> $s
     * @return array<string, mixed>
     */
    public static function state(array $s): array
    {
        $int = static function (mixed $v, string $name, int $min = 0, int $max = 100000): int {
            if (!is_int($v) || $v < $min || $v > $max) {
                throw HttpError::validation("Neplatná hodnota: $name.", 'state');
            }
            return $v;
        };
        $map = static function (mixed $v, string $name, string $keyPattern) use ($int): array {
            if ($v === null || $v === []) {
                return [];
            }
            if (!is_array($v) || count($v) > 40) {
                throw HttpError::validation("Neplatná hodnota: $name.", 'state');
            }
            $out = [];
            foreach ($v as $k => $n) {
                if (preg_match($keyPattern, (string) $k) !== 1) {
                    throw HttpError::validation("Neplatný klíč v $name.", 'state');
                }
                $out[(string) $k] = $int($n, $name);
            }
            return $out;
        };
        $conditions = $s['conditions'] ?? [];
        if (!is_array($conditions) || count($conditions) > 30) {
            throw HttpError::validation('Neplatné stavy (conditions).', 'state');
        }
        foreach ($conditions as $c) {
            if (!is_string($c) || mb_strlen($c) > 40 || $c === '') {
                throw HttpError::validation('Neplatný stav (condition).', 'state');
            }
        }
        $concentration = $s['concentration'] ?? null;
        if ($concentration !== null && (!is_string($concentration) || mb_strlen($concentration) > 200)) {
            throw HttpError::validation('Neplatná koncentrace.', 'state');
        }
        return [
            'concentration' => $concentration === '' ? null : $concentration,
            'hpCurrent' => array_key_exists('hpCurrent', $s) && $s['hpCurrent'] !== null ? $int($s['hpCurrent'], 'hpCurrent') : null,
            'hpTemp' => $int($s['hpTemp'] ?? 0, 'hpTemp'),
            'deathSuccesses' => $int($s['deathSuccesses'] ?? 0, 'deathSuccesses', 0, 3),
            'deathFailures' => $int($s['deathFailures'] ?? 0, 'deathFailures', 0, 3),
            'hitDiceUsed' => $map($s['hitDiceUsed'] ?? [], 'hitDiceUsed', '/^d(4|6|8|10|12|20)$/'),
            'slotsUsed' => $map($s['slotsUsed'] ?? [], 'slotsUsed', '/^[1-9]$/'),
            'pactSlotsUsed' => $int($s['pactSlotsUsed'] ?? 0, 'pactSlotsUsed', 0, 20),
            'resources' => $map($s['resources'] ?? [], 'resources', '/^[a-zA-Z0-9._-]{1,80}$/'),
            'conditions' => array_values(array_unique($conditions)),
        ];
    }

    // ------------------------------------------------------------------ levely a odvozené údaje

    /**
     * Ověří seznam levelů (třídy existují, součet ≤ 20) a subclassy.
     * @param array<string, mixed> $in
     * @return array{levels: list<array{classIndex:string,hpRoll:?int}>, subclasses: array<string,string>}
     */
    public static function levels(array $in, string $campaignId): array
    {
        $list = $in['levels'] ?? null;
        if (!is_array($list) || $list === [] || count($list) > self::MAX_LEVEL) {
            throw HttpError::validation('Postava musí mít 1 až 20 levelů.', 'levels');
        }
        $levels = [];
        $counts = [];
        foreach ($list as $i => $entry) {
            $classIndex = is_array($entry) ? ($entry['classIndex'] ?? null) : null;
            $roll = is_array($entry) ? ($entry['hpRoll'] ?? null) : null;
            if (!is_string($classIndex) || Db::value("SELECT 1 FROM rules_entries WHERE kind = 'class' AND idx = ? AND scope = ''", [$classIndex]) === null) {
                throw HttpError::validation('Neznámá třída.', 'levels');
            }
            if ($roll !== null && (!is_int($roll) || $roll < 1 || $roll > 20)) {
                throw HttpError::validation('Hozená hodnota HP musí být 1 až 20.', 'levels');
            }
            $levels[] = ['classIndex' => $classIndex, 'hpRoll' => $i === 0 ? null : $roll];
            $counts[$classIndex] = ($counts[$classIndex] ?? 0) + 1;
        }

        $subclasses = $in['subclasses'] ?? [];
        if (!is_array($subclasses)) {
            throw HttpError::validation('Subclassy mají neplatný tvar.', 'subclasses');
        }
        $outSub = [];
        foreach ($subclasses as $classIndex => $subIdx) {
            if (!is_string($subIdx) || !isset($counts[$classIndex])) {
                throw HttpError::validation('Subclass patří ke třídě, kterou postava nemá.', 'subclasses');
            }
            if ($counts[$classIndex] < (self::SUBCLASS_LEVEL[$classIndex] ?? 3)) {
                throw HttpError::validation('Subclass lze vybrat až od ' . (self::SUBCLASS_LEVEL[$classIndex] ?? 3) . '. levelu třídy.', 'subclasses');
            }
            $className = (string) Db::value("SELECT name FROM rules_entries WHERE kind = 'class' AND idx = ? AND scope = ''", [$classIndex]);
            $ok = Db::value(
                "SELECT 1 FROM rules_entries WHERE kind = 'subclass' AND idx = ? AND (scope = '' OR scope = ?) AND tags LIKE ?",
                [$subIdx, $campaignId, '%|' . $className . '|%'],
            );
            if ($ok === null) {
                throw HttpError::validation('Tento subclass nepatří k dané třídě.', 'subclasses');
            }
            $outSub[$classIndex] = $subIdx;
        }
        return ['levels' => $levels, 'subclasses' => $outSub];
    }

    /** Přepíše řádky levelů postavy a přepočítá level a shrnutí tříd (zobrazuje se ostatním hráčům). @param list<array{classIndex:string,hpRoll:?int}> $levels */
    public static function saveLevels(string $characterId, array $levels): void
    {
        Db::exec('DELETE FROM character_levels WHERE character_id = ?', [$characterId]);
        foreach ($levels as $i => $l) {
            Db::exec(
                'INSERT INTO character_levels (id, character_id, seq, class_idx, hp_roll, choices, created_at) VALUES (?, ?, ?, ?, ?, NULL, UTC_TIMESTAMP())',
                [Ids::uuid(), $characterId, $i + 1, $l['classIndex'], $l['hpRoll']],
            );
        }
        self::syncDerived($characterId);
    }

    public static function syncDerived(string $characterId): void
    {
        $rows = Db::all(
            "SELECT l.class_idx, COUNT(*) AS n, MIN(l.seq) AS first_seq, COALESCE(MAX(e.name), l.class_idx) AS class_name
             FROM character_levels l LEFT JOIN rules_entries e ON e.kind = 'class' AND e.idx = l.class_idx AND e.scope = ''
             WHERE l.character_id = ? GROUP BY l.class_idx ORDER BY first_seq",
            [$characterId],
        );
        $total = 0;
        $parts = [];
        foreach ($rows as $r) {
            $total += (int) $r['n'];
            $parts[] = $r['class_name'] . ' ' . $r['n'];
        }
        Db::exec(
            'UPDATE characters SET level = ?, class_summary = ?, updated_at = UTC_TIMESTAMP() WHERE id = ?',
            [max(1, min(20, $total)), mb_substr(implode(' / ', $parts), 0, 200), $characterId],
        );
    }

    /** Uloží zdroje postavy: aktuální hodnoty (třídní i vlastní) a definice vlastních zdrojů. @param list<array{key:string,name:string,max:int,recharge:string}> $custom @param array<string,int> $current */
    public static function saveResources(string $characterId, array $current, array $custom): void
    {
        Db::exec('DELETE FROM character_resources WHERE character_id = ?', [$characterId]);
        $customByKey = [];
        foreach ($custom as $c) {
            $customByKey[$c['key']] = $c;
        }
        foreach ($customByKey as $key => $c) {
            Db::exec(
                'INSERT INTO character_resources (character_id, rkey, current_value, is_custom, name, max_value, recharge) VALUES (?, ?, ?, 1, ?, ?, ?)',
                [$characterId, $key, min($c['max'], $current[$key] ?? $c['max']), $c['name'], $c['max'], $c['recharge']],
            );
        }
        foreach ($current as $key => $value) {
            if (!isset($customByKey[$key])) {
                Db::exec('INSERT INTO character_resources (character_id, rkey, current_value, is_custom) VALUES (?, ?, ?, 0)', [$characterId, $key, $value]);
            }
        }
    }
}
