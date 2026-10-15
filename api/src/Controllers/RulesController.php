<?php

declare(strict_types=1);

namespace Dnd\Controllers;

use Dnd\Access;
use Dnd\Db;
use Dnd\HttpError;
use Dnd\Ids;
use Dnd\Input;
use Dnd\Request;
use Dnd\Response;

/**
 * Pravidla (SRD 5.1 a katalog itemů) a homebrew obsah.
 *
 * Viditelnost:
 *  - oficiální obsah (campaign_id NULL) vidí každý přihlášený,
 *  - homebrew vidí jen členové jeho kampaně; soukromý homebrew (visibility = private) jen autor a DM kampaně.
 * Úpravy: jen homebrew, jen autor nebo DM kampaně. Oficiální obsah je přes API neměnný.
 */
final class RulesController
{
    /** Druhy, které se dají procházet. (class_level a proficiency jsou jen data pro engine.) */
    private const BROWSABLE = [
        'spell', 'magic_item', 'equipment', 'weapon', 'armor', 'feature', 'feat', 'class', 'subclass',
        'race', 'subrace', 'trait', 'condition', 'background', 'skill', 'language', 'weapon_property', 'ability',
    ];
    /** Druhy, které smí uživatel vytvořit jako homebrew. */
    private const HOMEBREW_KINDS = ['spell', 'magic_item', 'feature', 'subclass'];
    private const RARITIES = ['common', 'uncommon', 'rare', 'very rare', 'legendary', 'artifact', 'varies'];

    private const SUMMARY_COLUMNS = 'e.id, e.ruleset, e.kind, e.name, e.name_cs, e.level, e.category, e.rarity, e.attunement, e.source,
        e.is_srd, e.price_gp, e.price_note, e.ref_url, e.campaign_id, e.owner_id, e.visibility,
        SUBSTRING(e.desc_text, 1, 220) AS summary, (CHAR_LENGTH(e.desc_text) > 0) AS has_text';

    /** @param array{id:string} $user */
    public static function index(Request $req, array $params, array $user): array
    {
        [$where, $args] = self::filters($req, $user);

        $limit = max(1, min(100, (int) ($req->query['limit'] ?? 40)));
        $offset = max(0, (int) ($req->query['offset'] ?? 0));
        $order = ($req->query['sort'] ?? '') === 'level' ? 'e.level, e.name' : 'e.name';

        $total = (int) Db::value("SELECT COUNT(*) FROM rules_entries e WHERE $where", $args);
        $rows = Db::all(
            'SELECT ' . self::SUMMARY_COLUMNS . " FROM rules_entries e WHERE $where ORDER BY $order, e.id LIMIT $limit OFFSET $offset",
            $args,
        );
        return ['total' => $total, 'entries' => array_map([self::class, 'summary'], $rows)];
    }

    /** Hodnoty pro filtry (kategorie, vzácnosti, zdroje, třídy, levely) v rámci vybraných druhů. @param array{id:string} $user */
    public static function facets(Request $req, array $params, array $user): array
    {
        // Facety se počítají bez uživatelských filtrů, jen podle druhů a viditelnosti.
        [$where, $args] = self::filters($req, $user, facetsOnly: true);

        $distinct = static fn (string $col): array => array_map(
            static fn (array $r): string => (string) $r['v'],
            Db::all("SELECT DISTINCT e.$col AS v FROM rules_entries e WHERE $where AND e.$col IS NOT NULL AND e.$col <> '' ORDER BY v", $args),
        );

        $tags = [];
        foreach (Db::all("SELECT DISTINCT e.tags AS t FROM rules_entries e WHERE $where AND e.tags <> ''", $args) as $r) {
            foreach (explode('|', trim((string) $r['t'], '|')) as $tag) {
                if ($tag !== '') {
                    $tags[$tag] = true;
                }
            }
        }
        $tagList = array_keys($tags);
        sort($tagList);

        $levels = array_map(
            static fn (array $r): int => (int) $r['v'],
            Db::all("SELECT DISTINCT e.level AS v FROM rules_entries e WHERE $where AND e.level IS NOT NULL ORDER BY v", $args),
        );

        return [
            'categories' => $distinct('category'),
            'rarities' => $distinct('rarity'),
            'sources' => $distinct('source'),
            'levels' => $levels,
            'tags' => $tagList,
        ];
    }

    /**
     * Data pro pravidlový engine v prohlížeči: třídy a tabulky levelů z SRD (stejný tvar jako zdrojová data).
     * @param array{id:string} $user
     */
    public static function engine(Request $req, array $params, array $user): array
    {
        $classes = Db::all("SELECT idx, name, data FROM rules_entries WHERE kind = 'class' AND scope = '' ORDER BY idx");
        $levels = Db::all("SELECT idx, name, level, category, data FROM rules_entries WHERE kind = 'class_level' AND scope = '' ORDER BY idx");
        $decode = static fn (string $json): mixed => json_decode($json, true) ?? new \stdClass();
        return [
            'classes' => array_map(static fn (array $r): array => ['idx' => $r['idx'], 'name' => $r['name'], 'data' => $decode((string) $r['data'])], $classes),
            'levels' => array_map(static fn (array $r): array => [
                'idx' => $r['idx'], 'name' => $r['name'], 'level' => (int) $r['level'], 'category' => $r['category'], 'data' => $decode((string) $r['data']),
            ], $levels),
        ];
    }

    /**
     * Featury třídy (a případně subclassu) získané do daného levelu, s plným popisem.
     * Dotaz: ?class=monk&level=5&subclass=open-hand
     * @param array{id:string} $user
     */
    public static function classFeatures(Request $req, array $params, array $user): array
    {
        $class = (string) ($req->query['class'] ?? '');
        $subclass = (string) ($req->query['subclass'] ?? '');
        $level = max(1, min(20, (int) ($req->query['level'] ?? 1)));
        if (preg_match('/^[a-z0-9-]{1,100}$/', $class) !== 1 || ($subclass !== '' && preg_match('/^[a-z0-9-]{1,100}$/', $subclass) !== 1)) {
            throw HttpError::validation('Neplatná třída nebo subclass.', 'class');
        }

        $byLevel = [];
        $collect = static function (string $prefix, string $source, string $label) use ($level, &$byLevel): void {
            $idxs = array_map(static fn (int $n): string => $prefix . '-' . $n, range(1, $level));
            $rows = Db::all(
                "SELECT level, data FROM rules_entries WHERE kind = 'class_level' AND scope = '' AND idx IN (" . implode(',', array_fill(0, count($idxs), '?')) . ')',
                $idxs,
            );
            foreach ($rows as $r) {
                $data = json_decode((string) $r['data'], true);
                foreach (($data['features'] ?? []) as $f) {
                    $byLevel[] = ['featureIdx' => (string) $f['index'], 'level' => (int) $r['level'], 'source' => $source, 'className' => $label];
                }
            }
        };
        $className = (string) (Db::value("SELECT name FROM rules_entries WHERE kind = 'class' AND idx = ? AND scope = ''", [$class]) ?? '');
        if ($className === '') {
            throw HttpError::notFound('Třída nenalezena.');
        }
        $collect($class, 'class', $className);
        if ($subclass !== '') {
            $subName = (string) (Db::value("SELECT name FROM rules_entries WHERE kind = 'subclass' AND idx = ? AND scope = ''", [$subclass]) ?? '');
            if ($subName !== '') {
                $collect($subclass, 'subclass', $subName);
            }
        }
        if ($byLevel === []) {
            return ['features' => []];
        }

        $featureIdxs = array_values(array_unique(array_column($byLevel, 'featureIdx')));
        $rows = Db::all(
            "SELECT id, idx, name, desc_text FROM rules_entries WHERE kind = 'feature' AND scope = '' AND idx IN (" . implode(',', array_fill(0, count($featureIdxs), '?')) . ')',
            $featureIdxs,
        );
        $byIdx = [];
        foreach ($rows as $r) {
            $byIdx[$r['idx']] = $r;
        }
        usort($byLevel, static fn (array $a, array $b): int => [$a['level'], $a['source'] === 'class' ? 0 : 1] <=> [$b['level'], $b['source'] === 'class' ? 0 : 1]);
        $out = [];
        foreach ($byLevel as $f) {
            $row = $byIdx[$f['featureIdx']] ?? null;
            if ($row === null) {
                continue;
            }
            $out[] = [
                'id' => $row['id'], 'idx' => $row['idx'], 'name' => $row['name'], 'level' => $f['level'], 'source' => $f['source'],
                'className' => $f['className'], 'description' => $row['desc_text'],
            ];
        }
        return ['features' => $out];
    }

    /** @param array{id:string} $user */
    public static function show(Request $req, array $params, array $user): array
    {
        $row = self::loadVisible($params['id'], $user);
        return ['entry' => self::detail($row, $user)];
    }

    // ------------------------------------------------------------------ homebrew

    /** @param array{id:string} $user */
    public static function createHomebrew(Request $req, array $params, array $user): Response
    {
        Access::requireMember($user, $params['id']);
        $data = $req->json();

        $kind = $data['kind'] ?? null;
        if (!is_string($kind) || !in_array($kind, self::HOMEBREW_KINDS, true)) {
            throw HttpError::validation('Druh musí být: ' . implode(', ', self::HOMEBREW_KINDS) . '.', 'kind');
        }
        $fields = self::homebrewFields($kind, $data, true);

        $id = Ids::uuid();
        Db::exec(
            'INSERT INTO rules_entries (id, ruleset, kind, idx, scope, name, desc_text, level, category, rarity, attunement, source, is_srd,
                price_gp, price_note, ref_url, tags, data, campaign_id, owner_id, visibility, seed_batch, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, NULL, NULL, ?, ?, ?, ?, ?, NULL, UTC_TIMESTAMP(), UTC_TIMESTAMP())',
            [
                $id, 'srd51', $kind, 'hb-' . $id, $params['id'],
                $fields['name'], $fields['desc'], $fields['level'], $fields['category'], $fields['rarity'], $fields['attunement'],
                'Homebrew', $fields['price_gp'], $fields['tags'], self::encode($fields['extra'] ?? []),
                $params['id'], $user['id'], $fields['visibility'] ?? 'campaign',
            ],
        );
        $row = self::loadVisible($id, $user);
        return Response::json(['entry' => self::detail($row, $user)], 201);
    }

    /** @param array{id:string} $user */
    public static function update(Request $req, array $params, array $user): array
    {
        $row = self::loadEditable($params['id'], $user);
        $fields = self::homebrewFields((string) $row['kind'], $req->json(), false);

        if (isset($fields['extra'])) {
            $current = json_decode((string) $row['data'], true);
            $fields['data'] = self::encode(array_merge(is_array($current) ? $current : [], $fields['extra']));
        }

        $sets = [];
        $values = [];
        $map = [
            'name' => 'name', 'desc' => 'desc_text', 'level' => 'level', 'category' => 'category', 'rarity' => 'rarity',
            'attunement' => 'attunement', 'price_gp' => 'price_gp', 'tags' => 'tags', 'data' => 'data', 'visibility' => 'visibility',
        ];
        foreach ($map as $key => $column) {
            if (array_key_exists($key, $fields)) {
                $sets[] = "$column = ?";
                $values[] = $fields[$key];
            }
        }
        if ($sets !== []) {
            $sets[] = 'updated_at = UTC_TIMESTAMP()';
            $values[] = $params['id'];
            Db::exec('UPDATE rules_entries SET ' . implode(', ', $sets) . ' WHERE id = ?', $values);
        }
        return ['entry' => self::detail(self::loadVisible($params['id'], $user), $user)];
    }

    /** @param array{id:string} $user */
    public static function delete(Request $req, array $params, array $user): ?array
    {
        self::loadEditable($params['id'], $user);
        Db::exec('DELETE FROM rules_entries WHERE id = ?', [$params['id']]);
        return null;
    }

    // ------------------------------------------------------------------ dotazy a oprávnění

    /**
     * Sestaví WHERE podle viditelnosti a filtrů z query řetězce.
     * @param array{id:string} $user
     * @return array{0: string, 1: list<mixed>}
     */
    private static function filters(Request $req, array $user, bool $facetsOnly = false): array
    {
        $q = $req->query;
        $where = [];
        $args = [];

        // Druhy (povinně z povoleného seznamu).
        $kinds = self::BROWSABLE;
        if (isset($q['kinds']) && is_string($q['kinds']) && $q['kinds'] !== '') {
            $kinds = array_values(array_intersect(explode(',', $q['kinds']), self::BROWSABLE));
            if ($kinds === []) {
                throw HttpError::validation('Neznámý druh záznamů.', 'kinds');
            }
        }
        $where[] = 'e.kind IN (' . implode(',', array_fill(0, count($kinds), '?')) . ')';
        array_push($args, ...$kinds);

        // Viditelnost: oficiální obsah vždy; homebrew jen vybrané kampaně, kde je volající členem.
        $campaignId = isset($q['campaignId']) && is_string($q['campaignId']) && $q['campaignId'] !== '' ? $q['campaignId'] : null;
        $scope = isset($q['scope']) && is_string($q['scope']) ? $q['scope'] : 'all';
        if ($campaignId !== null) {
            $role = Access::requireMember($user, $campaignId);
            // Hráč vidí homebrew kampaně, který je 'campaign', nebo vlastní; DM vidí vše.
            $homebrew = $role === 'dm'
                ? 'e.campaign_id = ?'
                : "(e.campaign_id = ? AND (e.visibility = 'campaign' OR e.owner_id = ?))";
            $homebrewArgs = $role === 'dm' ? [$campaignId] : [$campaignId, $user['id']];
        } else {
            $homebrew = '0';
            $homebrewArgs = [];
            if ($scope === 'homebrew') {
                throw HttpError::validation('Pro homebrew je potřeba campaignId.', 'campaignId');
            }
        }

        if ($scope === 'homebrew') {
            $where[] = $homebrew;
            array_push($args, ...$homebrewArgs);
        } else {
            $official = match ($scope) {
                'srd' => '(e.campaign_id IS NULL AND e.is_srd = 1)',
                'other' => '(e.campaign_id IS NULL AND e.is_srd = 0)',
                default => 'e.campaign_id IS NULL',
            };
            if ($scope === 'all') {
                $where[] = "($official OR $homebrew)";
                array_push($args, ...$homebrewArgs);
            } else {
                $where[] = $official;
            }
        }

        if ($facetsOnly) {
            return [implode(' AND ', $where), $args];
        }

        if (isset($q['q']) && is_string($q['q']) && trim($q['q']) !== '') {
            $like = '%' . str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], trim($q['q'])) . '%';
            $where[] = '(e.name LIKE ? OR e.name_cs LIKE ?)';
            array_push($args, $like, $like);
        }
        foreach (['category' => 'e.category', 'rarity' => 'e.rarity', 'source' => 'e.source'] as $param => $column) {
            if (isset($q[$param]) && is_string($q[$param]) && $q[$param] !== '') {
                $where[] = "$column = ?";
                $args[] = $q[$param];
            }
        }
        if (isset($q['level']) && is_string($q['level']) && $q['level'] !== '' && ctype_digit($q['level'])) {
            $where[] = 'e.level = ?';
            $args[] = (int) $q['level'];
        }
        if (isset($q['attunement']) && ($q['attunement'] === '1' || $q['attunement'] === '0')) {
            $where[] = 'e.attunement = ?';
            $args[] = (int) $q['attunement'];
        }
        if (isset($q['tag']) && is_string($q['tag']) && $q['tag'] !== '') {
            $where[] = 'e.tags LIKE ?';
            $args[] = '%|' . str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $q['tag']) . '|%';
        }
        return [implode(' AND ', $where), $args];
    }

    /**
     * Záznam pravidel, který volající smí vidět (jinak 404). Využívá inventář a kouzla postav.
     * @param array{id:string} $user
     * @return array<string, mixed>
     */
    public static function visibleEntry(string $id, array $user): array
    {
        return self::loadVisible($id, $user);
    }

    /**
     * Načte záznam, který volající smí vidět (jinak 404).
     * @param array{id:string} $user
     * @return array<string, mixed>
     */
    private static function loadVisible(string $id, array $user): array
    {
        $row = Ids::isUuid($id) ? Db::one('SELECT e.* FROM rules_entries e WHERE e.id = ?', [$id]) : null;
        if ($row === null) {
            throw HttpError::notFound('Záznam nenalezen.');
        }
        if ($row['campaign_id'] === null) {
            return $row;
        }
        $role = Access::role($user['id'], (string) $row['campaign_id']);
        $visible = $role === 'dm'
            || ($role !== null && ($row['visibility'] === 'campaign' || $row['owner_id'] === $user['id']));
        if (!$visible) {
            // Cizí nebo soukromý homebrew se tváří, že neexistuje.
            throw HttpError::notFound('Záznam nenalezen.');
        }
        return $row;
    }

    /**
     * Načte homebrew, který smí volající upravit (autor nebo DM kampaně).
     * @param array{id:string} $user
     * @return array<string, mixed>
     */
    private static function loadEditable(string $id, array $user): array
    {
        $row = self::loadVisible($id, $user);
        if ($row['campaign_id'] === null) {
            throw HttpError::forbidden('Oficiální obsah nejde upravit. Vytvoř si vlastní homebrew verzi.');
        }
        $role = Access::role($user['id'], (string) $row['campaign_id']);
        if ($role !== 'dm' && $row['owner_id'] !== $user['id']) {
            throw HttpError::forbidden('Cizí homebrew může upravit jen jeho autor nebo DM.');
        }
        return $row;
    }

    // ------------------------------------------------------------------ validace homebrew

    /**
     * Ověří a převede vstup homebrew. Při $create jsou povinná pole vyžadována, při úpravě stačí podmnožina.
     * @param array<string, mixed> $in
     * @return array<string, mixed>
     */
    private static function homebrewFields(string $kind, array $in, bool $create): array
    {
        $out = [];
        $has = static fn (string $k): bool => array_key_exists($k, $in);

        if ($create || $has('name')) {
            $out['name'] = Input::string($in, 'name', 1, 200, 'Název');
        }
        if ($create || $has('description')) {
            $out['desc'] = $has('description') ? Input::string($in, 'description', 0, 20000, 'Popis') : '';
        }
        if ($has('visibility')) {
            $v = $in['visibility'];
            if ($v !== 'campaign' && $v !== 'private') {
                throw HttpError::validation("Viditelnost musí být 'campaign' nebo 'private'.", 'visibility');
            }
            $out['visibility'] = $v;
        }

        $extra = [];
        $tagSource = null;
        switch ($kind) {
            case 'spell':
                if ($create || $has('level')) {
                    $level = Input::optionalInt($in, 'level', 0, 9, 'Úroveň kouzla');
                    if ($level === null) {
                        throw HttpError::validation('Úroveň kouzla je povinná (0 až 9).', 'level');
                    }
                    $out['level'] = $level;
                }
                if ($has('school')) {
                    $out['category'] = Input::string($in, 'school', 0, 40, 'Škola');
                }
                foreach (['castingTime' => 'casting_time', 'range' => 'range', 'components' => 'components', 'duration' => 'duration', 'material' => 'material', 'higherLevel' => 'higher_level'] as $key => $dataKey) {
                    if ($has($key)) {
                        $extra[$dataKey] = Input::string($in, $key, 0, $key === 'higherLevel' ? 5000 : 300, $key);
                    }
                }
                foreach (['ritual', 'concentration'] as $flag) {
                    if ($has($flag)) {
                        if (!is_bool($in[$flag])) {
                            throw HttpError::validation("$flag musí být true/false.", $flag);
                        }
                        $extra[$flag] = $in[$flag];
                    }
                }
                if ($has('classes')) {
                    $tagSource = Input::string($in, 'classes', 0, 200, 'Třídy');
                    $extra['classes'] = array_values(array_filter(array_map('trim', explode(',', $tagSource)), static fn (string $s): bool => $s !== ''));
                }
                break;

            case 'magic_item':
                if ($has('rarity')) {
                    $r = $in['rarity'];
                    if ($r !== null && (!is_string($r) || !in_array($r, self::RARITIES, true))) {
                        throw HttpError::validation('Neplatná vzácnost.', 'rarity');
                    }
                    $out['rarity'] = $r;
                }
                if ($has('attunement')) {
                    if (!is_bool($in['attunement'])) {
                        throw HttpError::validation('attunement musí být true/false.', 'attunement');
                    }
                    $out['attunement'] = $in['attunement'] ? 1 : 0;
                }
                if ($has('itemType')) {
                    $out['category'] = Input::string($in, 'itemType', 0, 60, 'Typ itemu');
                }
                if ($has('priceGp')) {
                    $p = $in['priceGp'];
                    if ($p !== null && ((!is_int($p) && !is_float($p)) || $p < 0 || $p > 100000000)) {
                        throw HttpError::validation('Cena musí být číslo od 0 do 100 000 000 gp.', 'priceGp');
                    }
                    $out['price_gp'] = $p === null ? null : round((float) $p, 2);
                }
                break;

            case 'feature':
                if ($has('level')) {
                    $out['level'] = Input::optionalInt($in, 'level', 1, 20, 'Level');
                }
                if ($has('category')) {
                    $out['category'] = Input::string($in, 'category', 0, 60, 'Třída nebo zdroj');
                }
                break;

            case 'subclass':
                if ($create || $has('category')) {
                    $out['category'] = Input::string($in, 'category', 1, 60, 'Mateřská třída');
                }
                break;
        }

        if ($extra !== []) {
            // Doplňující údaje (komponenty kouzla apod.); při úpravě se sloučí s existujícími.
            $out['extra'] = $extra;
        }
        if ($create) {
            foreach (['level' => null, 'category' => null, 'rarity' => null, 'attunement' => null, 'price_gp' => null] as $k => $default) {
                $out[$k] ??= $default;
            }
        }
        // Tagy (třídy kouzla) se přepočítají, když se změnil seznam tříd; u subclassu je tag mateřská třída.
        if ($kind === 'spell' && $tagSource !== null) {
            $names = array_values(array_filter(array_map('trim', explode(',', $tagSource)), static fn (string $s): bool => $s !== ''));
            $out['tags'] = $names === [] ? '' : '|' . implode('|', $names) . '|';
        } elseif ($kind === 'subclass' && isset($out['category'])) {
            $out['tags'] = '|' . $out['category'] . '|';
        } elseif ($create) {
            $out['tags'] = '';
        }
        return $out;
    }

    /** @param array<string, mixed> $data */
    private static function encode(array $data): string
    {
        return json_encode($data === [] ? new \stdClass() : $data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    }

    // ------------------------------------------------------------------ výstup

    /**
     * @param array<string, mixed> $r
     * @return array<string, mixed>
     */
    private static function summary(array $r): array
    {
        return [
            'id' => $r['id'],
            'kind' => $r['kind'],
            'name' => $r['name'],
            'nameCs' => $r['name_cs'],
            'level' => $r['level'] === null ? null : (int) $r['level'],
            'category' => $r['category'],
            'rarity' => $r['rarity'],
            'attunement' => $r['attunement'] === null ? null : (bool) $r['attunement'],
            'source' => $r['source'],
            'isSrd' => (bool) $r['is_srd'],
            'isHomebrew' => $r['campaign_id'] !== null,
            'campaignId' => $r['campaign_id'],
            'priceGp' => $r['price_gp'] === null ? null : (float) $r['price_gp'],
            'priceNote' => $r['price_note'],
            'summary' => (string) $r['summary'],
            'hasText' => (bool) $r['has_text'],
        ];
    }

    /**
     * @param array<string, mixed> $r  celý řádek
     * @param array{id:string} $user
     * @return array<string, mixed>
     */
    private static function detail(array $r, array $user): array
    {
        $data = json_decode((string) $r['data'], true);
        $canEdit = false;
        $ownerName = null;
        if ($r['campaign_id'] !== null) {
            $role = Access::role($user['id'], (string) $r['campaign_id']);
            $canEdit = $role === 'dm' || $r['owner_id'] === $user['id'];
            if ($r['owner_id'] !== null) {
                $ownerName = Db::value('SELECT display_name FROM users WHERE id = ?', [$r['owner_id']]);
            }
        }
        return [
            'id' => $r['id'],
            'ruleset' => $r['ruleset'],
            'kind' => $r['kind'],
            'name' => $r['name'],
            'nameCs' => $r['name_cs'],
            'description' => $r['desc_text'],
            'descriptionCs' => $r['desc_cs'],
            'level' => $r['level'] === null ? null : (int) $r['level'],
            'category' => $r['category'],
            'rarity' => $r['rarity'],
            'attunement' => $r['attunement'] === null ? null : (bool) $r['attunement'],
            'source' => $r['source'],
            'isSrd' => (bool) $r['is_srd'],
            'isHomebrew' => $r['campaign_id'] !== null,
            'campaignId' => $r['campaign_id'],
            'ownerName' => $ownerName === null ? null : (string) $ownerName,
            'visibility' => $r['campaign_id'] === null ? null : $r['visibility'],
            'priceGp' => $r['price_gp'] === null ? null : (float) $r['price_gp'],
            'priceNote' => $r['price_note'],
            'refUrl' => $r['ref_url'],
            'tags' => $r['tags'] === '' ? [] : explode('|', trim((string) $r['tags'], '|')),
            'data' => is_array($data) && $data !== [] ? $data : new \stdClass(),
            'canEdit' => $canEdit,
        ];
    }
}
