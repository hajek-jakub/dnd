<?php

declare(strict_types=1);

namespace Dnd;

use RuntimeException;

/**
 * Načte pravidla z api/data do tabulky rules_entries (idempotentně).
 *  - srd51/*.json: SRD 5.1 z 5e-bits/5e-database
 *  - extra/item-catalog.json: katalog magických itemů (fakta, ceny, odkazy; bez popisů mimo SRD)
 *  - extra/warlock-spells.json: warlocková kouzla mimo SRD (jen fakta, bez popisů)
 * Existující záznamy se aktualizují (české překlady a homebrew zůstávají), zmizelé se smažou.
 * Pokud se data od posledního běhu nezměnila, seed se přeskočí.
 */
final class Seeder
{
    /** Zvýšit při změně mapování, aby se data znovu načetla i bez změny souborů. */
    private const VERSION = 1;
    private const BASE = 'https://www.aidedd.org/dnd/om.php?vo=';
    private const COINS = ['cp' => 0.01, 'sp' => 0.1, 'ep' => 0.5, 'gp' => 1.0, 'pp' => 10.0];

    /** @return array{skipped: bool, counts: array<string, int>, removed: int} */
    public static function run(bool $force = false): array
    {
        $dir = dirname(__DIR__) . '/data';
        $files = glob($dir . '/srd51/*.json') ?: [];
        $files[] = $dir . '/extra/item-catalog.json';
        $files[] = $dir . '/extra/warlock-spells.json';
        sort($files);
        $hashInput = 'v' . self::VERSION;
        foreach ($files as $f) {
            $hashInput .= basename($f) . hash_file('sha256', $f);
        }
        $hash = hash('sha256', $hashInput);

        $state = Db::value("SELECT hash FROM seed_state WHERE name = 'rules'");
        if (!$force && $state === $hash) {
            return ['skipped' => true, 'counts' => [], 'removed' => 0];
        }

        if (function_exists('set_time_limit')) {
            @set_time_limit(300);
        }

        $rows = self::collect($dir);
        $batch = substr($hash, 0, 12);

        $counts = [];
        $removed = Db::transaction(static function () use ($rows, $batch, $hash, &$counts): int {
            foreach (array_chunk($rows, 40) as $chunk) {
                self::upsert($chunk, $batch);
            }
            foreach ($rows as $row) {
                $counts[$row['kind']] = ($counts[$row['kind']] ?? 0) + 1;
            }
            // Smazat oficiální záznamy, které už v datech nejsou (homebrew má scope = id kampaně, ten se nemaže).
            $removed = Db::exec(
                "DELETE FROM rules_entries WHERE scope = '' AND (seed_batch IS NULL OR seed_batch <> ?)",
                [$batch],
            );
            Db::exec(
                "INSERT INTO seed_state (name, hash, seeded_at) VALUES ('rules', ?, UTC_TIMESTAMP())
                 ON DUPLICATE KEY UPDATE hash = VALUES(hash), seeded_at = VALUES(seeded_at)",
                [$hash],
            );
            return $removed;
        });

        ksort($counts);
        return ['skipped' => false, 'counts' => $counts, 'removed' => $removed];
    }

    // ------------------------------------------------------------------ sběr řádků

    /** @return list<array<string, mixed>> */
    private static function collect(string $dir): array
    {
        $catalog = self::loadCatalog($dir . '/extra/item-catalog.json');
        $rows = [];

        foreach (self::load($dir, 'Spells') as $r) {
            $rows[] = self::spell($r);
        }
        foreach (self::catalogSpells($dir . '/extra/warlock-spells.json') as $r) {
            $rows[] = $r;
        }
        $usedCatalog = [];
        foreach (self::load($dir, 'Magic-Items') as $r) {
            $rows[] = self::magicItem($r, $catalog, $usedCatalog);
        }
        foreach (self::catalogOnlyItems($catalog, $usedCatalog) as $r) {
            $rows[] = $r;
        }
        foreach (self::load($dir, 'Equipment') as $r) {
            $rows[] = self::equipment($r);
        }
        foreach (self::load($dir, 'Classes') as $r) {
            $rows[] = self::entry('class', $r, ['name' => $r['name'], 'category' => null], self::strip($r, ['index', 'name', 'url']));
        }
        foreach (self::load($dir, 'Subclasses') as $r) {
            $rows[] = self::entry(
                'subclass',
                $r,
                ['name' => $r['name'], 'desc' => self::join($r['desc'] ?? []), 'category' => $r['class']['name'] ?? null, 'tags' => self::tags([$r['class']['name'] ?? ''])],
                self::strip($r, ['index', 'name', 'desc', 'url']),
            );
        }
        foreach (self::load($dir, 'Levels') as $r) {
            $owner = $r['subclass']['name'] ?? ($r['class']['name'] ?? '');
            $rows[] = self::entry(
                'class_level',
                $r,
                ['name' => $owner . ' ' . $r['level'], 'level' => (int) $r['level'], 'category' => $r['class']['name'] ?? null],
                self::strip($r, ['index', 'url']),
            );
        }
        foreach (self::load($dir, 'Features') as $r) {
            $rows[] = self::entry(
                'feature',
                $r,
                [
                    'name' => $r['name'],
                    'desc' => self::join($r['desc'] ?? []),
                    'level' => isset($r['level']) ? (int) $r['level'] : null,
                    'category' => $r['class']['name'] ?? null,
                    'tags' => self::tags([$r['class']['name'] ?? '', $r['subclass']['name'] ?? '']),
                ],
                self::strip($r, ['index', 'name', 'desc', 'level', 'url']),
            );
        }
        foreach (self::load($dir, 'Races') as $r) {
            $parts = [];
            foreach (['age' => 'Age', 'alignment' => 'Alignment', 'size_description' => 'Size', 'language_desc' => 'Languages'] as $key => $label) {
                if (!empty($r[$key])) {
                    $parts[] = $label . '. ' . $r[$key];
                }
            }
            $rows[] = self::entry('race', $r, ['name' => $r['name'], 'desc' => implode("\n\n", $parts)], self::strip($r, ['index', 'name', 'url']));
        }
        foreach (self::load($dir, 'Subraces') as $r) {
            $rows[] = self::entry(
                'subrace',
                $r,
                ['name' => $r['name'], 'desc' => (string) ($r['desc'] ?? ''), 'category' => $r['race']['name'] ?? null],
                self::strip($r, ['index', 'name', 'desc', 'url']),
            );
        }
        foreach (self::load($dir, 'Traits') as $r) {
            $rows[] = self::entry(
                'trait',
                $r,
                [
                    'name' => $r['name'],
                    'desc' => self::join($r['desc'] ?? []),
                    'category' => $r['races'][0]['name'] ?? ($r['subraces'][0]['name'] ?? null),
                    'tags' => self::tags(array_merge(self::names($r['races'] ?? []), self::names($r['subraces'] ?? []))),
                ],
                self::strip($r, ['index', 'name', 'desc', 'url']),
            );
        }
        foreach (self::load($dir, 'Conditions') as $r) {
            $rows[] = self::entry('condition', $r, ['name' => $r['name'], 'desc' => self::join($r['desc'] ?? [])], self::strip($r, ['index', 'name', 'desc', 'url']));
        }
        foreach (self::load($dir, 'Skills') as $r) {
            $rows[] = self::entry(
                'skill',
                $r,
                ['name' => $r['name'], 'desc' => self::join($r['desc'] ?? []), 'category' => $r['ability_score']['name'] ?? null],
                self::strip($r, ['index', 'name', 'desc', 'url']),
            );
        }
        foreach (self::load($dir, 'Backgrounds') as $r) {
            $feature = $r['feature'] ?? null;
            $desc = $feature ? ($feature['name'] . '. ' . self::join($feature['desc'] ?? [])) : '';
            $rows[] = self::entry('background', $r, ['name' => $r['name'], 'desc' => $desc], self::strip($r, ['index', 'name', 'url']));
        }
        foreach (self::load($dir, 'Feats') as $r) {
            $rows[] = self::entry('feat', $r, ['name' => $r['name'], 'desc' => self::join($r['desc'] ?? [])], self::strip($r, ['index', 'name', 'desc', 'url']));
        }
        foreach (self::load($dir, 'Languages') as $r) {
            $speakers = implode(', ', $r['typical_speakers'] ?? []);
            $rows[] = self::entry(
                'language',
                $r,
                ['name' => $r['name'], 'desc' => $speakers !== '' ? 'Typical speakers: ' . $speakers : '', 'category' => $r['type'] ?? null],
                self::strip($r, ['index', 'name', 'url']),
            );
        }
        foreach (self::load($dir, 'Weapon-Properties') as $r) {
            $rows[] = self::entry('weapon_property', $r, ['name' => $r['name'], 'desc' => self::join($r['desc'] ?? [])], self::strip($r, ['index', 'name', 'desc', 'url']));
        }
        foreach (self::load($dir, 'Ability-Scores') as $r) {
            $rows[] = self::entry(
                'ability',
                $r,
                ['name' => (string) ($r['full_name'] ?? $r['name']), 'desc' => self::join($r['desc'] ?? []), 'category' => $r['name'] ?? null],
                self::strip($r, ['index', 'name', 'full_name', 'desc', 'url']),
            );
        }
        foreach (self::load($dir, 'Proficiencies') as $r) {
            $rows[] = self::entry('proficiency', $r, ['name' => $r['name'], 'category' => $r['type'] ?? null], self::strip($r, ['index', 'name', 'url']));
        }

        // Kontrola unikátnosti (ruleset, kind, idx), ať chyba v datech nespadne až v DB.
        $seen = [];
        foreach ($rows as $row) {
            $key = $row['ruleset'] . '|' . $row['kind'] . '|' . $row['idx'];
            if (isset($seen[$key])) {
                throw new RuntimeException("Duplicitní záznam v datech: $key");
            }
            $seen[$key] = true;
        }
        return $rows;
    }

    // ------------------------------------------------------------------ mapování druhů

    /**
     * @param array<string, mixed> $r
     * @return array<string, mixed>
     */
    private static function spell(array $r): array
    {
        $classes = self::names($r['classes'] ?? []);
        $data = self::strip($r, ['index', 'name', 'desc', 'url', 'level', 'school', 'classes', 'subclasses']);
        $data['classes'] = $classes;
        $data['subclasses'] = self::names($r['subclasses'] ?? []);
        if (!empty($r['higher_level'])) {
            $data['higher_level'] = self::join($r['higher_level']);
        } else {
            unset($data['higher_level']);
        }
        return self::entry(
            'spell',
            $r,
            [
                'name' => $r['name'],
                'desc' => self::join($r['desc'] ?? []),
                'level' => (int) $r['level'],
                'category' => $r['school']['name'] ?? null,
                'tags' => self::tags($classes),
            ],
            $data,
        );
    }

    /**
     * Kouzla mimo SRD z katalogu (jen fakta, bez popisů): záznamy sady 'ref', viditelné všem, jdou přidat postavě.
     * @return list<array<string, mixed>>
     */
    private static function catalogSpells(string $file): array
    {
        $json = json_decode((string) file_get_contents($file), true);
        $rows = [];
        foreach (is_array($json['spells'] ?? null) ? $json['spells'] : [] as $c) {
            $classes = array_map('strval', $c['classes'] ?? []);
            $data = [
                'casting_time' => (string) $c['castingTime'],
                'range' => (string) $c['range'],
                'components' => (string) $c['components'],
                'duration' => (string) $c['duration'],
                'concentration' => (bool) $c['concentration'],
                'ritual' => (bool) ($c['ritual'] ?? false),
                'classes' => $classes,
            ];
            $rows[] = [
                'ruleset' => 'ref',
                'kind' => 'spell',
                'idx' => substr(trim((string) preg_replace('/[^a-z0-9]+/', '-', strtolower((string) $c['name'])), '-'), 0, 100),
                'name' => (string) $c['name'],
                'desc_text' => '',
                'level' => (int) $c['level'],
                'category' => (string) $c['school'],
                'rarity' => null,
                'attunement' => null,
                'source' => (string) $c['source'],
                'is_srd' => 0,
                'price_gp' => null,
                'price_note' => null,
                'ref_url' => null,
                'tags' => self::tags($classes),
                'data' => json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR),
            ];
        }
        return $rows;
    }

    /**
     * @param array<string, mixed> $r
     * @param array<string, array<string, mixed>> $catalog
     * @param array<string, bool> $used
     * @return array<string, mixed>
     */
    private static function magicItem(array $r, array $catalog, array &$used): array
    {
        $desc = $r['desc'] ?? [];
        $header = (string) ($desc[0] ?? '');
        $key = self::normalize((string) $r['name']);
        $cat = $catalog[$key] ?? null;
        if ($cat !== null) {
            $used[$key] = true;
        }
        $rarity = strtolower((string) ($r['rarity']['name'] ?? ''));
        $data = self::strip($r, ['index', 'name', 'desc', 'url', 'image', 'equipment_category', 'rarity']);
        $data['header'] = $header;
        return self::entry(
            'magic_item',
            $r,
            [
                'name' => $r['name'],
                'desc' => self::join(array_slice($desc, 1)),
                'category' => $r['equipment_category']['name'] ?? null,
                'rarity' => $rarity !== '' ? $rarity : null,
                'attunement' => preg_match('/requires attunement/i', $header) === 1 ? 1 : 0,
                'price_gp' => $cat['priceGp'] ?? null,
                'price_note' => $cat['priceNote'] ?? null,
                'ref_url' => !empty($cat['slug']) ? self::BASE . $cat['slug'] : null,
            ],
            $data,
        );
    }

    /**
     * Položky z katalogu, které nejsou v SRD: jen fakta + odkaz, popis se nekopíruje.
     * @param array<string, array<string, mixed>> $catalog
     * @param array<string, bool> $used
     * @return list<array<string, mixed>>
     */
    private static function catalogOnlyItems(array $catalog, array $used): array
    {
        $rows = [];
        foreach ($catalog as $key => $c) {
            if (isset($used[$key])) {
                continue;
            }
            // Obecné položky označené (SRD) (např. "Ammunition +1, +2, or +3") pokrývají konkrétní SRD itemy.
            if (!empty($c['inSrd'])) {
                continue;
            }
            $idx = !empty($c['slug']) ? (string) $c['slug'] : trim((string) preg_replace('/[^a-z0-9]+/', '-', strtolower((string) $c['name'])), '-');
            $data = array_filter([
                'rarityText' => $c['rarityText'] ?? null,
                'attunementNote' => $c['attunementNote'] ?? null,
                'basicRules' => !empty($c['basicRules']) ? true : null,
            ], static fn ($v): bool => $v !== null);
            $rows[] = [
                'ruleset' => 'ref',
                'kind' => 'magic_item',
                'idx' => substr($idx, 0, 100),
                'name' => (string) $c['name'],
                'desc_text' => '',
                'level' => null,
                'category' => $c['type'] ?? null,
                'rarity' => $c['rarity'] ?? null,
                'attunement' => $c['attunement'] === null ? null : ($c['attunement'] ? 1 : 0),
                'source' => (string) $c['source'],
                'is_srd' => 0,
                'price_gp' => $c['priceGp'] ?? null,
                'price_note' => $c['priceNote'] ?? null,
                'ref_url' => !empty($c['slug']) ? self::BASE . $c['slug'] : null,
                'tags' => '',
                'data' => json_encode($data === [] ? new \stdClass() : $data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
            ];
        }
        return $rows;
    }

    /**
     * @param array<string, mixed> $r
     * @return array<string, mixed>
     */
    private static function equipment(array $r): array
    {
        $cat = $r['equipment_category']['index'] ?? '';
        $kind = $cat === 'weapon' ? 'weapon' : ($cat === 'armor' ? 'armor' : 'equipment');
        $price = null;
        $note = null;
        if (isset($r['cost']['quantity'], $r['cost']['unit'])) {
            $unit = (string) $r['cost']['unit'];
            $price = round((float) $r['cost']['quantity'] * (self::COINS[$unit] ?? 1.0), 2);
            $note = $r['cost']['quantity'] . ' ' . $unit;
        }
        $data = self::strip($r, ['index', 'name', 'desc', 'url', 'cost', 'equipment_category']);
        if (!empty($r['properties'])) {
            $data['properties'] = self::names($r['properties']);
        }
        if (!empty($r['damage']['damage_type'])) {
            $data['damage'] = ['dice' => $r['damage']['damage_dice'] ?? null, 'type' => $r['damage']['damage_type']['name'] ?? null];
        }
        if (!empty($r['two_handed_damage']['damage_type'])) {
            $data['two_handed_damage'] = ['dice' => $r['two_handed_damage']['damage_dice'] ?? null, 'type' => $r['two_handed_damage']['damage_type']['name'] ?? null];
        }
        return self::entry(
            $kind,
            $r,
            [
                'name' => $r['name'],
                'desc' => self::join($r['desc'] ?? []),
                'category' => $r['equipment_category']['name'] ?? null,
                'price_gp' => $price,
                'price_note' => $note,
            ],
            $data,
        );
    }

    // ------------------------------------------------------------------ pomocné

    /**
     * @param array<string, mixed> $src  původní záznam (kvůli index)
     * @param array<string, mixed> $f    pole sloupců
     * @param array<string, mixed> $data zbytek do JSON sloupce
     * @return array<string, mixed>
     */
    private static function entry(string $kind, array $src, array $f, array $data): array
    {
        return [
            'ruleset' => 'srd51',
            'kind' => $kind,
            'idx' => substr((string) $src['index'], 0, 100),
            'name' => substr((string) $f['name'], 0, 200),
            'desc_text' => (string) ($f['desc'] ?? ''),
            'level' => $f['level'] ?? null,
            'category' => isset($f['category']) ? substr((string) $f['category'], 0, 80) : null,
            'rarity' => $f['rarity'] ?? null,
            'attunement' => $f['attunement'] ?? null,
            'source' => 'SRD 5.1',
            'is_srd' => 1,
            'price_gp' => $f['price_gp'] ?? null,
            'price_note' => $f['price_note'] ?? null,
            'ref_url' => $f['ref_url'] ?? null,
            'tags' => (string) ($f['tags'] ?? ''),
            'data' => json_encode($data === [] ? new \stdClass() : $data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR),
        ];
    }

    /**
     * @param list<array<string, mixed>> $rows
     */
    private static function upsert(array $rows, string $batch): void
    {
        $cols = ['id', 'ruleset', 'kind', 'idx', 'scope', 'name', 'desc_text', 'level', 'category', 'rarity', 'attunement', 'source', 'is_srd', 'price_gp', 'price_note', 'ref_url', 'tags', 'data', 'seed_batch', 'created_at', 'updated_at'];
        $place = [];
        $params = [];
        foreach ($rows as $r) {
            $place[] = '(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,UTC_TIMESTAMP(),UTC_TIMESTAMP())';
            array_push(
                $params,
                Ids::uuid(),
                $r['ruleset'],
                $r['kind'],
                $r['idx'],
                '',
                $r['name'],
                $r['desc_text'],
                $r['level'],
                $r['category'],
                $r['rarity'],
                $r['attunement'],
                $r['source'],
                $r['is_srd'],
                $r['price_gp'],
                $r['price_note'],
                $r['ref_url'],
                $r['tags'],
                $r['data'],
                $batch,
            );
        }
        // id, name_cs a desc_cs se při aktualizaci nemění (překlady přežijí nový seed).
        Db::exec(
            'INSERT INTO rules_entries (' . implode(',', $cols) . ') VALUES ' . implode(',', $place) . '
             ON DUPLICATE KEY UPDATE name = VALUES(name), desc_text = VALUES(desc_text), level = VALUES(level),
               category = VALUES(category), rarity = VALUES(rarity), attunement = VALUES(attunement), source = VALUES(source),
               is_srd = VALUES(is_srd), price_gp = VALUES(price_gp), price_note = VALUES(price_note), ref_url = VALUES(ref_url),
               tags = VALUES(tags), data = VALUES(data), seed_batch = VALUES(seed_batch), updated_at = UTC_TIMESTAMP()',
            $params,
        );
    }

    /** @return list<array<string, mixed>> */
    private static function load(string $dir, string $name): array
    {
        $file = $dir . '/srd51/5e-SRD-' . $name . '.json';
        $data = json_decode((string) file_get_contents($file), true);
        if (!is_array($data)) {
            throw new RuntimeException("Nejde načíst $file");
        }
        return $data;
    }

    /** @return array<string, array<string, mixed>> */
    private static function loadCatalog(string $file): array
    {
        $items = json_decode((string) file_get_contents($file), true);
        if (!is_array($items)) {
            throw new RuntimeException('Nejde načíst katalog itemů');
        }
        $map = [];
        foreach ($items as $item) {
            $map[self::normalize((string) $item['name'])] = $item;
        }
        return $map;
    }

    private static function normalize(string $name): string
    {
        return (string) preg_replace('/[^a-z0-9]+/', '', strtolower($name));
    }

    /** @param list<string> $paragraphs */
    private static function join(array $paragraphs): string
    {
        return implode("\n\n", array_map('strval', $paragraphs));
    }

    /**
     * @param list<array<string, mixed>> $refs
     * @return list<string>
     */
    private static function names(array $refs): array
    {
        return array_values(array_filter(array_map(static fn (array $x): string => (string) ($x['name'] ?? ''), $refs), static fn (string $n): bool => $n !== ''));
    }

    /** @param list<string> $names */
    private static function tags(array $names): string
    {
        $names = array_values(array_unique(array_filter($names, static fn (string $n): bool => $n !== '')));
        return $names === [] ? '' : '|' . implode('|', $names) . '|';
    }

    /**
     * @param array<string, mixed> $r
     * @param list<string> $keys
     * @return array<string, mixed>
     */
    private static function strip(array $r, array $keys): array
    {
        foreach ($keys as $k) {
            unset($r[$k]);
        }
        return $r;
    }
}
