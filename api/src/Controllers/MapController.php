<?php

declare(strict_types=1);

namespace Dnd\Controllers;

use Dnd\Access;
use Dnd\Db;
use Dnd\HttpError;
use Dnd\Ids;
use Dnd\Images;
use Dnd\Input;
use Dnd\Request;
use Dnd\Response;

/**
 * Mapy kampaně a body (piny) na nich.
 *  - mapu nahrává, přejmenovává, zveřejňuje a maže jen DM; hráči vidí a stahují jen zveřejněné mapy (skrytá mapa je pro ně 404),
 *  - pin má viditelnost: all (všichni, kdo mapu vidí), selected (vybraní hráči a DM), dm (jen DM), owner (soukromá poznámka hráče),
 *  - DM přidává piny all / selected / dm, hráč jen soukromé poznámky (owner), které nevidí nikdo jiný, ani DM,
 *  - upravit nebo smazat pin smí jeho autor, DM pouze piny, které vidí (cizí soukromé poznámky ne).
 */
final class MapController
{
    public const ICONS = ['pin', 'castle', 'camp', 'danger', 'treasure', 'quest', 'town', 'cave', 'door', 'skull', 'npc'];
    private const MAX_MAPS = 30;
    private const MAX_PINS = 300;

    // ------------------------------------------------------------------ mapy

    /** @param array{id:string} $user */
    public static function index(Request $req, array $params, array $user): array
    {
        $role = Access::requireMember($user, $params['id']);
        $rows = Db::all(
            'SELECT id, campaign_id, name, image_path, width, height, visible, created_at FROM maps WHERE campaign_id = ?' . ($role === 'dm' ? '' : ' AND visible = 1') . ' ORDER BY created_at',
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
        Db::exec(
            'INSERT INTO maps (id, campaign_id, name, image_path, width, height, visible, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?, UTC_TIMESTAMP())',
            [$id, $params['id'], $name, $path, $img['width'], $img['height'], $user['id']],
        );
        $row = Db::one('SELECT id, campaign_id, name, image_path, width, height, visible, created_at FROM maps WHERE id = ?', [$id]) ?? [];
        return Response::json(['map' => self::mapPayload($row)], 201);
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

    /** @param array{id:string} $user */
    public static function createPin(Request $req, array $params, array $user): Response
    {
        [$map, $role] = self::loadMap($params['id'], $user);
        if ((int) Db::value('SELECT COUNT(*) FROM map_pins WHERE map_id = ?', [$map['id']]) >= self::MAX_PINS) {
            throw HttpError::validation('Na mapě může být nejvýš ' . self::MAX_PINS . ' bodů.', 'x');
        }
        $data = $req->json();
        $fields = self::pinFields($data, $map, true);
        $visibility = $data['visibility'] ?? ($role === 'dm' ? 'all' : 'owner');
        $viewers = self::checkVisibility($visibility, $data, $role, (string) $map['campaign_id']);

        $id = Ids::uuid();
        Db::transaction(static function () use ($id, $map, $user, $fields, $visibility, $viewers): void {
            Db::exec(
                'INSERT INTO map_pins (id, map_id, x, y, title, description, icon, visibility, created_by, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())',
                [$id, $map['id'], $fields['x'], $fields['y'], $fields['title'], $fields['description'], $fields['icon'], $visibility, $user['id']],
            );
            foreach ($viewers as $v) {
                Db::exec('INSERT INTO map_pin_viewers (pin_id, user_id) VALUES (?, ?)', [$id, $v]);
            }
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
            if ($pin['visibility'] === 'owner' && $visibility !== 'owner') {
                throw HttpError::forbidden('Soukromou poznámku nejde zveřejnit.');
            }
            $viewers = self::checkVisibility($visibility, $data + ['viewerIds' => self::viewerIds((string) $pin['id'])], $role, (string) $map['campaign_id']);
            $sets[] = 'visibility = ?';
            $values[] = $visibility;
        }
        Db::transaction(static function () use ($pin, $sets, $values, $viewers): void {
            if ($sets !== []) {
                $sets[] = 'updated_at = UTC_TIMESTAMP()';
                $values[] = $pin['id'];
                Db::exec('UPDATE map_pins SET ' . implode(', ', $sets) . ' WHERE id = ?', $values);
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

    // ------------------------------------------------------------------ pomocné

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
     * Ověří viditelnost pinu pro roli a vrátí seznam vybraných hráčů (jen u 'selected').
     * @param array<string, mixed> $data
     * @return list<string>
     */
    private static function checkVisibility(mixed $visibility, array $data, string $role, string $campaignId): array
    {
        if (!is_string($visibility) || !in_array($visibility, ['all', 'selected', 'dm', 'owner'], true)) {
            throw HttpError::validation('Neplatná viditelnost.', 'visibility');
        }
        if ($role !== 'dm') {
            // Hráč smí zapsat jen svou soukromou poznámku.
            if ($visibility !== 'owner') {
                throw HttpError::forbidden('Hráč může přidat jen soukromou poznámku, kterou uvidí jen on.');
            }
            return [];
        }
        if ($visibility === 'owner') {
            throw HttpError::validation("Soukromé poznámky (owner) jsou jen pro hráče. DM použije 'dm'.", 'visibility');
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
        return array_map(static function (array $r) use ($userId, $role, $viewers): array {
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
