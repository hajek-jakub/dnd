<?php

declare(strict_types=1);

namespace Dnd\Controllers;

use Dnd\Access;
use Dnd\Db;
use Dnd\HttpError;
use Dnd\Ids;
use Dnd\Images;
use Dnd\Input;
use Dnd\Push;
use Dnd\Request;
use Dnd\Response;

/**
 * Mapy kampaně a body (piny) na nich.
 *  - mapu nahrává, přejmenovává, zveřejňuje, řadí a maže jen DM; hráči vidí a stahují jen zveřejněné mapy (skrytá mapa je pro ně 404),
 *  - pin má viditelnost: all (všichni, kdo mapu vidí), selected (vybraní hráči a DM), dm (jen DM), owner (stará soukromá poznámka hráče),
 *  - DM přidává piny all / selected / dm, hráč body pro všechny (all); soukromé poznámky (owner) už nově nevznikají,
 *    starou smí autor nechat soukromou nebo zveřejnit (owner → all), zpět ne,
 *  - upravit nebo smazat pin smí jeho autor a DM (piny, které vidí; cizí soukromé poznámky ne),
 *  - pin může mít NPC a postavy z přehledu deníku (`npcIds`, kdo se tam nachází); skrytá NPC DM hráč nevidí ani nepřiřadí,
 *  - pin může mít zápisy deníku (`entryIds`, co se tu stalo): přiřadit jde jen zápis, který autor změny vidí; propojení se zápisy,
 *    které nevidí, zůstanou a nikomu, kdo zápis nevidí, se nevrací.
 */
final class MapController
{
    public const ICONS = ['pin', 'castle', 'camp', 'danger', 'treasure', 'quest', 'town', 'cave', 'door', 'skull', 'npc'];
    private const MAX_MAPS = 30;
    private const MAX_PINS = 300;
    private const MAX_ENTRY_LINKS = 30;

    // ------------------------------------------------------------------ mapy

    /** @param array{id:string} $user */
    public static function index(Request $req, array $params, array $user): array
    {
        $role = Access::requireMember($user, $params['id']);
        $rows = Db::all(
            'SELECT id, campaign_id, name, image_path, width, height, visible, created_at FROM maps WHERE campaign_id = ?' . ($role === 'dm' ? '' : ' AND visible = 1') . ' ORDER BY position, created_at',
            [$params['id']],
        );
        return ['maps' => array_map([self::class, 'mapPayload'], $rows)];
    }

    /** Nahraje mapu (multipart: name, image). Obrázek se přegeneruje a zmenší na 4096 px. @param array{id:string} $user */
    public static function create(Request $req, array $params, array $user): Response
    {
        Access::requireDm($user, $params['id']);
        $name = trim((string) $req->field('name'));
        if ($name === '' || mb_strlen($name) > 100) {
            throw HttpError::validation('Název mapy je povinný (nejvýš 100 znaků).', 'name');
        }
        if ((int) Db::value('SELECT COUNT(*) FROM maps WHERE campaign_id = ?', [$params['id']]) >= self::MAX_MAPS) {
            throw HttpError::validation('Kampaň může mít nejvýš ' . self::MAX_MAPS . ' map.', 'image');
        }
        $img = Images::scaledJpeg($req->file('image'));
        $id = Ids::uuid();
        $path = Images::store('maps', $id . '-' . bin2hex(random_bytes(4)) . '.jpg', $img['bytes']);
        // nová mapa jde na konec seznamu
        $position = (int) Db::value('SELECT COALESCE(MAX(position), 0) + 1 FROM maps WHERE campaign_id = ?', [$params['id']]);
        Db::exec(
            'INSERT INTO maps (id, campaign_id, name, image_path, width, height, visible, position, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, UTC_TIMESTAMP())',
            [$id, $params['id'], $name, $path, $img['width'], $img['height'], $position, $user['id']],
        );
        $row = Db::one('SELECT id, campaign_id, name, image_path, width, height, visible, created_at FROM maps WHERE id = ?', [$id]) ?? [];
        return Response::json(['map' => self::mapPayload($row)], 201);
    }

    /**
     * Nové pořadí map (jen DM): `ids` musí být přesně všechny mapy kampaně, první = nahoře.
     * @param array{id:string} $user
     */
    public static function reorder(Request $req, array $params, array $user): array
    {
        Access::requireDm($user, $params['id']);
        $ids = $req->json()['ids'] ?? null;
        $existing = array_map('strval', array_column(Db::all('SELECT id FROM maps WHERE campaign_id = ?', [$params['id']]), 'id'));
        if (!is_array($ids) || array_values($ids) !== $ids || count($ids) !== count($existing) || count(array_unique(array_filter($ids, 'is_string'))) !== count($ids)) {
            throw HttpError::validation('Pořadí musí obsahovat každou mapu kampaně právě jednou.', 'ids');
        }
        $a = $ids;
        $b = $existing;
        sort($a);
        sort($b);
        if ($a !== $b) {
            throw HttpError::validation('Pořadí musí obsahovat každou mapu kampaně právě jednou.', 'ids');
        }
        Db::transaction(static function () use ($ids, $params): void {
            foreach ($ids as $i => $id) {
                Db::exec('UPDATE maps SET position = ? WHERE id = ? AND campaign_id = ?', [$i + 1, $id, $params['id']]);
            }
        });
        return self::index($req, $params, $user);
    }

    /** @param array{id:string} $user */
    public static function update(Request $req, array $params, array $user): array
    {
        [$map] = self::loadMap($params['id'], $user, dmOnly: true);
        $data = $req->json();
        $sets = [];
        $values = [];
        if (array_key_exists('name', $data)) {
            $sets[] = 'name = ?';
            $values[] = Input::string($data, 'name', 1, 100, 'Název mapy');
        }
        if (array_key_exists('visible', $data)) {
            if (!is_bool($data['visible'])) {
                throw HttpError::validation('visible musí být true/false.', 'visible');
            }
            $sets[] = 'visible = ?';
            $values[] = $data['visible'] ? 1 : 0;
        }
        if ($sets !== []) {
            $values[] = $map['id'];
            Db::exec('UPDATE maps SET ' . implode(', ', $sets) . ' WHERE id = ?', $values);
        }
        $row = Db::one('SELECT id, campaign_id, name, image_path, width, height, visible, created_at FROM maps WHERE id = ?', [$map['id']]) ?? [];
        // Zveřejnění mapy (skrytá → viditelná) dostanou hráči i jako push.
        if (!(bool) $map['visible'] && (bool) $row['visible']) {
            $players = array_map(static fn (array $r): string => (string) $r['user_id'], Db::all("SELECT user_id FROM campaign_members WHERE campaign_id = ? AND role = 'player'", [$row['campaign_id']]));
            Push::queue($players, 'maps', (string) $row['campaign_id'], 'DM zveřejnil mapu: ' . $row['name'], 'campaigns/' . $row['campaign_id'] . '/maps/' . $row['id'], 'map-' . $row['id']);
        }
        return ['map' => self::mapPayload($row)];
    }

    /** @param array{id:string} $user */
    public static function delete(Request $req, array $params, array $user): ?array
    {
        [$map] = self::loadMap($params['id'], $user, dmOnly: true);
        Db::exec('DELETE FROM maps WHERE id = ?', [$map['id']]);
        Images::delete((string) $map['image_path']);
        return null;
    }

    /** Obrázek mapy vydává jen API a jen tomu, kdo mapu smí vidět. @param array{id:string} $user */
    public static function image(Request $req, array $params, array $user): Response
    {
        [$map] = self::loadMap($params['id'], $user);
        $bytes = Images::read((string) $map['image_path']);
        if ($bytes === null) {
            throw HttpError::notFound('Obrázek mapy chybí.');
        }
        $etag = '"' . md5((string) $map['image_path']) . '"';
        $headers = ['ETag' => $etag, 'Cache-Control' => 'private, max-age=604800'];
        if ($req->header('if-none-match') === $etag) {
            return new Response(304, null, null, null, $headers);
        }
        return Response::binary($bytes, 'image/jpeg', $headers);
    }

    // ------------------------------------------------------------------ piny

    /** @param array{id:string} $user */
    public static function pins(Request $req, array $params, array $user): array
    {
        [$map, $role] = self::loadMap($params['id'], $user);
        $rows = Db::all(
            'SELECT p.*, u.display_name AS creator_name FROM map_pins p JOIN users u ON u.id = p.created_by
             WHERE p.map_id = ? AND ' . self::visibleSql() . ' ORDER BY p.created_at',
            [$map['id'], ...self::visibleArgs($user['id'], $role)],
        );
        return ['pins' => self::payloads($rows, $user['id'], $role)];
    }

    /**
     * Všechny body kampaně, které uživatel vidí (na mapách, které vidí), pro výběr „kde se NPC nachází“.
     * @param array{id:string} $user
     */
    public static function campaignPins(Request $req, array $params, array $user): array
    {
        $role = Access::requireMember($user, $params['id']);
        return ['pins' => self::placesSql($params['id'], $user['id'], $role)];
    }

    /**
     * Body kampaně, které uživatel vidí, ve tvaru místa (`pinId`, `mapId`, `mapName`, `title`, `icon`), seřazené podle map a názvu.
     * @param list<string>|null $pinIds jen tyto body (null = všechny)
     * @return list<array<string, mixed>>
     */
    public static function placesSql(string $campaignId, string $userId, string $role, ?array $pinIds = null): array
    {
        if ($pinIds === []) {
            return [];
        }
        $only = $pinIds === null ? '' : ' AND p.id IN (' . implode(',', array_fill(0, count($pinIds), '?')) . ')';
        $rows = Db::all(
            'SELECT p.id, p.map_id, p.title, p.icon, m.name AS map_name FROM map_pins p JOIN maps m ON m.id = p.map_id
             WHERE m.campaign_id = ? AND (m.visible = 1 OR ? = \'dm\') AND ' . self::visibleSql() . $only . '
             ORDER BY m.position, m.created_at, p.title',
            [$campaignId, $role, ...self::visibleArgs($userId, $role), ...($pinIds ?? [])],
        );
        return array_map(static fn (array $r): array => ['pinId' => $r['id'], 'mapId' => $r['map_id'], 'mapName' => $r['map_name'], 'title' => $r['title'], 'icon' => $r['icon']], $rows);
    }

    /** @param array{id:string} $user */
    public static function createPin(Request $req, array $params, array $user): Response
    {
        [$map, $role] = self::loadMap($params['id'], $user);
        if ((int) Db::value('SELECT COUNT(*) FROM map_pins WHERE map_id = ?', [$map['id']]) >= self::MAX_PINS) {
            throw HttpError::validation('Na mapě může být nejvýš ' . self::MAX_PINS . ' bodů.', 'x');
        }
        $data = $req->json();
        $fields = self::pinFields($data, $map, true);
        $visibility = $data['visibility'] ?? 'all';
        $viewers = self::checkVisibility($visibility, $data, $role, (string) $map['campaign_id'], null);
        $npcIds = JournalNpcController::checkLinks($data['npcIds'] ?? [], (string) $map['campaign_id'], $role);
        $entryIds = self::checkEntries($data['entryIds'] ?? [], (string) $map['campaign_id'], $user['id'], $role);

        $id = Ids::uuid();
        Db::transaction(static function () use ($id, $map, $user, $fields, $visibility, $viewers, $npcIds, $entryIds, $role): void {
            Db::exec(
                'INSERT INTO map_pins (id, map_id, x, y, title, description, icon, visibility, created_by, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())',
                [$id, $map['id'], $fields['x'], $fields['y'], $fields['title'], $fields['description'], $fields['icon'], $visibility, $user['id']],
            );
            foreach ($viewers as $v) {
                Db::exec('INSERT INTO map_pin_viewers (pin_id, user_id) VALUES (?, ?)', [$id, $v]);
            }
            JournalNpcController::replacePinLinks($id, $npcIds, $role);
            self::replaceEntries($id, $entryIds, $user['id'], $role);
        });
        return Response::json(['pin' => self::onePayload($id, $user['id'], $role)], 201);
    }

    /** @param array{id:string} $user */
    public static function updatePin(Request $req, array $params, array $user): array
    {
        [$pin, $map, $role] = self::loadPin($params['id'], $user);
        $data = $req->json();
        $fields = self::pinFields($data, $map, false);

        $sets = [];
        $values = [];
        foreach (['x', 'y', 'title', 'description', 'icon'] as $k) {
            if (array_key_exists($k, $fields)) {
                $sets[] = "$k = ?";
                $values[] = $fields[$k];
            }
        }
        $viewers = null;
        if (array_key_exists('visibility', $data) || array_key_exists('viewerIds', $data)) {
            $visibility = $data['visibility'] ?? $pin['visibility'];
            $viewers = self::checkVisibility($visibility, $data + ['viewerIds' => self::viewerIds((string) $pin['id'])], $role, (string) $map['campaign_id'], (string) $pin['visibility']);
            $sets[] = 'visibility = ?';
            $values[] = $visibility;
        }
        $npcIds = array_key_exists('npcIds', $data) ? JournalNpcController::checkLinks($data['npcIds'], (string) $map['campaign_id'], $role) : null;
        $entryIds = array_key_exists('entryIds', $data) ? self::checkEntries($data['entryIds'], (string) $map['campaign_id'], $user['id'], $role) : null;
        Db::transaction(static function () use ($pin, $sets, $values, $viewers, $npcIds, $entryIds, $user, $role): void {
            $linksChanged = $npcIds !== null && JournalNpcController::replacePinLinks((string) $pin['id'], $npcIds, $role);
            $linksChanged = ($entryIds !== null && self::replaceEntries((string) $pin['id'], $entryIds, $user['id'], $role)) || $linksChanged;
            if ($sets !== []) {
                $sets[] = 'updated_at = UTC_TIMESTAMP()';
                $values[] = $pin['id'];
                Db::exec('UPDATE map_pins SET ' . implode(', ', $sets) . ' WHERE id = ?', $values);
            } elseif ($linksChanged) {
                Db::exec('UPDATE map_pins SET updated_at = UTC_TIMESTAMP() WHERE id = ?', [$pin['id']]);
            }
            if ($viewers !== null) {
                Db::exec('DELETE FROM map_pin_viewers WHERE pin_id = ?', [$pin['id']]);
                foreach ($viewers as $v) {
                    Db::exec('INSERT INTO map_pin_viewers (pin_id, user_id) VALUES (?, ?)', [$pin['id'], $v]);
                }
            }
        });
        return ['pin' => self::onePayload((string) $pin['id'], $user['id'], $role)];
    }

    /** @param array{id:string} $user */
    public static function deletePin(Request $req, array $params, array $user): ?array
    {
        [$pin] = self::loadPin($params['id'], $user);
        Db::exec('DELETE FROM map_pins WHERE id = ?', [$pin['id']]);
        return null;
    }

    // ------------------------------------------------------------------ zápisy deníku u bodů

    /**
     * Ověří zápisy pro bod: musí být z kampaně a autor změny je musí vidět (jinak 422, jako by neexistovaly).
     * @return list<string>
     */
    private static function checkEntries(mixed $ids, string $campaignId, string $userId, string $role): array
    {
        if (!is_array($ids) || count($ids) > self::MAX_ENTRY_LINKS) {
            throw HttpError::validation('Seznam zápisů je neplatný (nejvýš ' . self::MAX_ENTRY_LINKS . ').', 'entryIds');
        }
        $out = [];
        foreach ($ids as $id) {
            if (!is_string($id) || !Ids::isUuid($id)) {
                throw HttpError::validation('Neplatný zápis.', 'entryIds');
            }
            $out[$id] = $id;
        }
        $out = array_values($out);
        if ($out === []) {
            return [];
        }
        $in = implode(',', array_fill(0, count($out), '?'));
        $found = (int) Db::value(
            "SELECT COUNT(*) FROM journal_entries e WHERE e.campaign_id = ? AND e.id IN ($in) AND " . JournalController::entryVisibleSql(),
            [$campaignId, ...$out, ...JournalController::entryVisibleArgs($userId, $role)],
        );
        if ($found !== count($out)) {
            throw HttpError::validation('Některý zápis v deníku téhle kampaně neexistuje.', 'entryIds');
        }
        return $out;
    }

    /**
     * Nastaví zápisy bodu na `$requested`; propojení se zápisy, které autor změny nevidí, zůstanou. Vrací, jestli se sada změnila.
     * @param list<string> $requested
     */
    private static function replaceEntries(string $pinId, array $requested, string $userId, string $role): bool
    {
        $existing = array_map('strval', array_column(Db::all('SELECT entry_id FROM map_pin_entries WHERE pin_id = ?', [$pinId]), 'entry_id'));
        $visible = $existing === [] ? [] : array_map('strval', array_column(Db::all(
            'SELECT e.id FROM journal_entries e WHERE e.id IN (' . implode(',', array_fill(0, count($existing), '?')) . ') AND ' . JournalController::entryVisibleSql(),
            [...$existing, ...JournalController::entryVisibleArgs($userId, $role)],
        ), 'id'));
        $final = array_values(array_unique(array_merge($requested, array_diff($existing, $visible))));
        $a = $existing;
        $b = $final;
        sort($a);
        sort($b);
        if ($a === $b) {
            return false;
        }
        Db::exec('DELETE FROM map_pin_entries WHERE pin_id = ?', [$pinId]);
        foreach ($final as $entryId) {
            Db::exec('INSERT INTO map_pin_entries (pin_id, entry_id) VALUES (?, ?)', [$pinId, $entryId]);
        }
        return true;
    }

    /**
     * Nastaví body zápisu (ze strany zápisu): mění se jen body, které uživatel vidí; propojení se skrytými body zůstanou.
     * @param list<string> $pinIds už ověřené (`JournalNpcController::checkPins`)
     */
    public static function replaceEntryPins(string $entryId, string $campaignId, array $pinIds, string $userId, string $role): bool
    {
        $existing = array_map('strval', array_column(Db::all('SELECT pin_id FROM map_pin_entries WHERE entry_id = ?', [$entryId]), 'pin_id'));
        $visible = array_map(static fn (array $p): string => (string) $p['pinId'], self::placesSql($campaignId, $userId, $role, $existing));
        $remove = array_values(array_diff($visible, $pinIds));
        $add = array_values(array_diff($pinIds, $existing));
        foreach ($remove as $pinId) {
            Db::exec('DELETE FROM map_pin_entries WHERE pin_id = ? AND entry_id = ?', [$pinId, $entryId]);
        }
        foreach ($add as $pinId) {
            Db::exec('INSERT IGNORE INTO map_pin_entries (pin_id, entry_id) VALUES (?, ?)', [$pinId, $entryId]);
        }
        return $remove !== [] || $add !== [];
    }

    /**
     * Zápisy na bodech, jak je vidí uživatel.
     * @param list<string> $pinIds
     * @return array<string, list<string>>
     */
    private static function entryLinkMap(array $pinIds, string $userId, string $role): array
    {
        if ($pinIds === []) {
            return [];
        }
        $in = implode(',', array_fill(0, count($pinIds), '?'));
        $map = [];
        foreach (Db::all(
            "SELECT l.pin_id, l.entry_id FROM map_pin_entries l JOIN journal_entries e ON e.id = l.entry_id WHERE l.pin_id IN ($in) AND " . JournalController::entryVisibleSql() . ' ORDER BY e.created_at',
            [...$pinIds, ...JournalController::entryVisibleArgs($userId, $role)],
        ) as $r) {
            $map[(string) $r['pin_id']][] = (string) $r['entry_id'];
        }
        return $map;
    }

    /**
     * Kde na mapách se zápisy odehrávají: jen body, které uživatel vidí (ve tvaru `placesSql`).
     * @param list<string> $entryIds
     * @return array<string, list<array<string, mixed>>>
     */
    public static function entryPlaces(string $campaignId, array $entryIds, string $userId, string $role): array
    {
        if ($entryIds === []) {
            return [];
        }
        $in = implode(',', array_fill(0, count($entryIds), '?'));
        $links = Db::all("SELECT entry_id, pin_id FROM map_pin_entries WHERE entry_id IN ($in)", $entryIds);
        if ($links === []) {
            return [];
        }
        $places = [];
        foreach (self::placesSql($campaignId, $userId, $role, array_values(array_unique(array_map(static fn (array $l): string => (string) $l['pin_id'], $links)))) as $p) {
            $places[(string) $p['pinId']] = $p;
        }
        $out = [];
        foreach ($links as $l) {
            if (isset($places[(string) $l['pin_id']])) {
                $out[(string) $l['entry_id']][] = $places[(string) $l['pin_id']];
            }
        }
        return $out;
    }

    // ------------------------------------------------------------------ pomocné

    /** Viditelnost pinu (alias `p`) pro jiné třídy, parametry `pinVisibleArgs`. */
    public static function pinVisibleSql(): string
    {
        return self::visibleSql();
    }

    /** @return list<string> */
    public static function pinVisibleArgs(string $userId, string $role): array
    {
        return self::visibleArgs($userId, $role);
    }

    /** Viditelnost pinu pro uživatele: parametry viz visibleArgs. */
    private static function visibleSql(): string
    {
        return "(p.visibility = 'all' OR p.created_by = ? OR (? = 'dm' AND p.visibility IN ('dm', 'selected'))
                 OR (p.visibility = 'selected' AND EXISTS (SELECT 1 FROM map_pin_viewers v WHERE v.pin_id = p.id AND v.user_id = ?)))";
    }

    /** @return list<string> */
    private static function visibleArgs(string $userId, string $role): array
    {
        return [$userId, $role, $userId];
    }

    /**
     * Načte mapu a ověří přístup: nečlen 404, hráč ke skryté mapě 404 (nepozná, že existuje), $dmOnly: hráč 403.
     * @param array{id:string} $user
     * @return array{0: array<string, mixed>, 1: string}
     */
    private static function loadMap(string $id, array $user, bool $dmOnly = false): array
    {
        $map = Ids::isUuid($id) ? Db::one('SELECT * FROM maps WHERE id = ?', [$id]) : null;
        $role = $map === null ? null : Access::role($user['id'], (string) $map['campaign_id']);
        if ($map === null || $role === null) {
            throw HttpError::notFound('Mapa nenalezena.');
        }
        if ($role !== 'dm') {
            if (!(bool) $map['visible']) {
                throw HttpError::notFound('Mapa nenalezena.');
            }
            if ($dmOnly) {
                throw HttpError::forbidden('Tohle může dělat jen DM.');
            }
        }
        return [$map, $role];
    }

    /**
     * Načte pin, který uživatel smí vidět (jinak 404), a ověří, že ho smí měnit.
     * @param array{id:string} $user
     * @return array{0: array<string, mixed>, 1: array<string, mixed>, 2: string}
     */
    private static function loadPin(string $id, array $user): array
    {
        $pin = Ids::isUuid($id) ? Db::one('SELECT * FROM map_pins WHERE id = ?', [$id]) : null;
        if ($pin === null) {
            throw HttpError::notFound('Bod nenalezen.');
        }
        [$map, $role] = self::loadMap((string) $pin['map_id'], $user);
        $visible = Db::value(
            'SELECT 1 FROM map_pins p WHERE p.id = ? AND ' . self::visibleSql(),
            [$id, ...self::visibleArgs($user['id'], $role)],
        );
        if ($visible === null) {
            throw HttpError::notFound('Bod nenalezen.');
        }
        if ($pin['created_by'] !== $user['id'] && $role !== 'dm') {
            throw HttpError::forbidden('Cizí bod nemůžeš měnit.');
        }
        return [$pin, $map, $role];
    }

    /**
     * @param array<string, mixed> $in
     * @param array<string, mixed> $map
     * @return array<string, mixed>
     */
    private static function pinFields(array $in, array $map, bool $create): array
    {
        $out = [];
        foreach (['x' => (int) $map['width'], 'y' => (int) $map['height']] as $axis => $max) {
            if ($create || array_key_exists($axis, $in)) {
                $v = $in[$axis] ?? null;
                if ((!is_int($v) && !is_float($v)) || $v < 0 || $v > $max) {
                    throw HttpError::validation("Souřadnice $axis musí být číslo od 0 do $max (v pixelech mapy).", $axis);
                }
                $out[$axis] = (float) $v;
            }
        }
        if ($create || array_key_exists('title', $in)) {
            $out['title'] = Input::string($in, 'title', 1, 100, 'Název bodu');
        }
        if ($create || array_key_exists('description', $in)) {
            $out['description'] = array_key_exists('description', $in) ? Input::string($in, 'description', 0, 2000, 'Popis') : '';
        }
        if ($create || array_key_exists('icon', $in)) {
            $icon = $in['icon'] ?? 'pin';
            if (!is_string($icon) || !in_array($icon, self::ICONS, true)) {
                throw HttpError::validation('Neznámá ikona.', 'icon');
            }
            $out['icon'] = $icon;
        }
        return $out;
    }

    /**
     * Ověří viditelnost pinu pro roli a vrátí seznam vybraných hráčů (jen u 'selected'). `$current` je viditelnost upravovaného pinu (null = nový).
     * @param array<string, mixed> $data
     * @return list<string>
     */
    private static function checkVisibility(mixed $visibility, array $data, string $role, string $campaignId, ?string $current): array
    {
        if (!is_string($visibility) || !in_array($visibility, ['all', 'selected', 'dm', 'owner'], true)) {
            throw HttpError::validation('Neplatná viditelnost.', 'visibility');
        }
        if ($role !== 'dm') {
            // Body hráčů vidí všichni; stará soukromá poznámka smí zůstat soukromá (nebo se zveřejnit), novou soukromou hráč nezaloží.
            if ($visibility !== 'all' && !($visibility === 'owner' && $current === 'owner')) {
                throw HttpError::forbidden('Body hráčů vidí všichni, kdo vidí mapu. Omezit viditelnost může jen DM.');
            }
            return [];
        }
        if ($visibility === 'owner' && $current !== 'owner') {
            throw HttpError::validation("Soukromé poznámky (owner) už nevznikají. DM použije 'dm'.", 'visibility');
        }
        if ($visibility !== 'selected') {
            return [];
        }
        $ids = $data['viewerIds'] ?? null;
        if (!is_array($ids) || $ids === [] || count($ids) > 50) {
            throw HttpError::validation('Vyber aspoň jednoho hráče.', 'viewerIds');
        }
        $out = [];
        foreach ($ids as $id) {
            if (!is_string($id) || !Ids::isUuid($id) || Access::role($id, $campaignId) !== 'player') {
                throw HttpError::validation('Vybraný příjemce musí být hráč z této kampaně.', 'viewerIds');
            }
            $out[] = $id;
        }
        return array_values(array_unique($out));
    }

    /** @return list<string> */
    private static function viewerIds(string $pinId): array
    {
        return array_map('strval', array_column(Db::all('SELECT user_id FROM map_pin_viewers WHERE pin_id = ?', [$pinId]), 'user_id'));
    }

    /** @return array<string, mixed> */
    private static function onePayload(string $pinId, string $userId, string $role): array
    {
        $row = Db::one('SELECT p.*, u.display_name AS creator_name FROM map_pins p JOIN users u ON u.id = p.created_by WHERE p.id = ?', [$pinId]) ?? [];
        return self::payloads([$row], $userId, $role)[0];
    }

    /**
     * @param list<array<string, mixed>> $rows
     * @return list<array<string, mixed>>
     */
    private static function payloads(array $rows, string $userId, string $role): array
    {
        $viewers = [];
        $ids = array_values(array_map(static fn (array $r): string => (string) $r['id'], array_filter($rows, static fn (array $r): bool => $r['visibility'] === 'selected')));
        if ($ids !== []) {
            $in = implode(',', array_fill(0, count($ids), '?'));
            foreach (Db::all("SELECT pin_id, user_id FROM map_pin_viewers WHERE pin_id IN ($in)", $ids) as $v) {
                $viewers[$v['pin_id']][] = $v['user_id'];
            }
        }
        $pinIds = array_values(array_map(static fn (array $r): string => (string) $r['id'], $rows));
        $npcs = JournalNpcController::pinLinkMap($pinIds, $role);
        $entries = self::entryLinkMap($pinIds, $userId, $role);
        return array_map(static function (array $r) use ($userId, $role, $viewers, $npcs, $entries): array {
            $mine = $r['created_by'] === $userId;
            $out = [
                'id' => $r['id'],
                'mapId' => $r['map_id'],
                'x' => (float) $r['x'],
                'y' => (float) $r['y'],
                'title' => $r['title'],
                'description' => $r['description'],
                'icon' => $r['icon'],
                'visibility' => $r['visibility'],
                'createdBy' => $r['created_by'],
                'createdByName' => $r['creator_name'],
                'mine' => $mine,
                'canEdit' => $mine || $role === 'dm',
                'npcIds' => $npcs[(string) $r['id']] ?? [],
                'entryIds' => $entries[(string) $r['id']] ?? [],
                'createdAt' => Ids::iso((string) $r['created_at']),
            ];
            // Kdo smí pin vidět, to ví jen autor a DM.
            if ($r['visibility'] === 'selected' && ($mine || $role === 'dm')) {
                $out['viewerIds'] = $viewers[$r['id']] ?? [];
            }
            return $out;
        }, $rows);
    }

    /** @param array<string, mixed> $r @return array<string, mixed> */
    private static function mapPayload(array $r): array
    {
        return [
            'id' => $r['id'],
            'campaignId' => $r['campaign_id'],
            'name' => $r['name'],
            'width' => (int) $r['width'],
            'height' => (int) $r['height'],
            'visible' => (bool) $r['visible'],
            'imageVersion' => substr(md5((string) $r['image_path']), 0, 10),
            'createdAt' => Ids::iso((string) $r['created_at']),
        ];
    }
}
