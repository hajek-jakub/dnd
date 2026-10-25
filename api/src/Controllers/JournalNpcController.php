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
 * Přehled NPC v deníku: jméno, rasa a popis, abecedně, propojené se zápisy (příběh NPC).
 *  - přidat NPC smí každý člen kampaně (deník je společný pro celou družinu), upravit a smazat autor a DM,
 *  - DM může NPC držet skryté (`visibility = dm`), dokud ho družina nepotká; hráč o skrytém NPC neví (404),
 *  - do přehledu jde přidat i postavu nebo NPC postavu z kampaně (`characterIds`): jméno, rasu a popis pak určuje postava
 *    (popis = „Vzhled a popis“ z profilu postavy; úprava popisu v deníku ho změní v profilu, smí jen majitel postavy a DM),
 *  - propojení se zápisem (`journal_entry_npcs`) nastavuje autor zápisu nebo DM přes `npcIds` u zápisu,
 *  - propojení s bodem mapy (`map_pin_npcs`, kde se NPC nachází) nastavuje autor bodu nebo DM přes `npcIds` u bodu,
 *    nebo ten, kdo smí upravit NPC, přes `pinIds` u NPC (jen body, které vidí; body, které nevidí, zůstanou);
 *    NPC pak v `places` ukazuje jen body, které uživatel na mapě vidí,
 *  - postavy hráčů a NPC postavy jsou v přehledu vždy (doplní se samy při načtení, autor = hráč, u NPC postavy DM)
 *    a smazat je nejde, dokud postava existuje (DM může NPC postavu v přehledu skrýt).
 *  Popis postavy je jinak soukromé pole sheetu; v přehledu ho záměrně vidí celá družina (vzhled postavy, rozhodnutí skupiny).
 */
final class JournalNpcController
{
    private const MAX_NPCS = 500;
    private const MAX_LINKS = 30;

    /** @param array{id:string} $user */
    public static function index(Request $req, array $params, array $user): array
    {
        $role = Access::requireMember($user, $params['id']);
        self::ensureCharacters($params['id']);
        $rows = Db::all(
            self::select() . ' WHERE n.campaign_id = ? AND ' . self::visibleSql() . ' ORDER BY COALESCE(c.name, n.name), n.created_at',
            [$params['id'], $role],
        );
        return ['npcs' => self::payloads($rows, $user['id'], $role)];
    }

    /** @param array{id:string} $user */
    public static function create(Request $req, array $params, array $user): Response
    {
        $role = Access::requireMember($user, $params['id']);
        $data = $req->json();
        $visibility = self::visibility($data, $role, null);
        $campaignId = $params['id'];

        if (array_key_exists('characterIds', $data)) {
            $ids = self::characterIds($data['characterIds']);
            $created = Db::transaction(function () use ($ids, $campaignId, $user, $data, $visibility): array {
                // Hromadné přidání: popis (nepovinný) dostanou všichni stejný, dá se doplnit později u každého zvlášť.
                $description = Input::optionalString($data, 'description', 5000, 'Popis') ?? '';
                $out = [];
                foreach ($ids as $characterId) {
                    $c = Db::one('SELECT id, name, race FROM characters WHERE id = ? AND campaign_id = ?', [$characterId, $campaignId]);
                    if ($c === null) {
                        throw HttpError::validation('Postava není z téhle kampaně.', 'characterIds');
                    }
                    if (Db::value('SELECT 1 FROM journal_npcs WHERE campaign_id = ? AND character_id = ?', [$campaignId, $characterId]) !== null) {
                        throw HttpError::validation('Postava „' . $c['name'] . '“ už v přehledu je.', 'characterIds');
                    }
                    $out[] = self::insert($campaignId, $user['id'], (string) $c['name'], (string) $c['race'], $description, $visibility, $characterId);
                }
                return $out;
            });
            return Response::json(['npcs' => array_map(static fn (string $id): array => self::one($id, $user['id'], $role), $created)], 201);
        }

        $name = Input::string($data, 'name', 1, 100, 'Jméno');
        $race = Input::optionalString($data, 'race', 100, 'Rasa') ?? '';
        $description = Input::optionalString($data, 'description', 5000, 'Popis') ?? '';
        $pinIds = self::checkPins($data['pinIds'] ?? [], $campaignId, $user['id'], $role);
        $id = Db::transaction(static function () use ($campaignId, $user, $name, $race, $description, $visibility, $pinIds): string {
            $id = self::insert($campaignId, $user['id'], $name, $race, $description, $visibility, null);
            foreach ($pinIds as $pinId) {
                Db::exec('INSERT INTO map_pin_npcs (pin_id, npc_id) VALUES (?, ?)', [$pinId, $id]);
            }
            return $id;
        });
        return Response::json(['npc' => self::one($id, $user['id'], $role)], 201);
    }

    /** @param array{id:string} $user */
    public static function update(Request $req, array $params, array $user): array
    {
        [$npc, $role] = self::load($params['id'], $user);
        $data = $req->json();
        $sets = [];
        $values = [];
        if (array_key_exists('name', $data) || array_key_exists('race', $data)) {
            if ($npc['character_id'] !== null && $npc['c_name'] !== null) {
                throw HttpError::validation('Jméno a rasu přebírá postava z kampaně, změň je na její kartě.', 'name');
            }
            if (array_key_exists('name', $data)) {
                $sets[] = 'name = ?';
                $values[] = Input::string($data, 'name', 1, 100, 'Jméno');
            }
            if (array_key_exists('race', $data)) {
                $sets[] = 'race = ?';
                $values[] = Input::string($data, 'race', 0, 100, 'Rasa');
            }
        }
        $characterDescription = null;
        if (array_key_exists('description', $data)) {
            if ($npc['character_id'] !== null && $npc['c_name'] !== null) {
                // popis postavy patří profilu postavy: měnit ho smí jen ten, kdo smí měnit postavu
                if ($role !== 'dm' && $npc['c_owner'] !== $user['id']) {
                    throw HttpError::forbidden('Popis postavy může změnit jen její majitel a DM.');
                }
                $characterDescription = Input::string($data, 'description', 0, 20000, 'Popis');
                $sets[] = "description = ''";
            } else {
                $sets[] = 'description = ?';
                $values[] = Input::string($data, 'description', 0, 5000, 'Popis');
            }
        }
        if (array_key_exists('visibility', $data)) {
            $sets[] = 'visibility = ?';
            $values[] = self::visibility($data, $role, (string) $npc['visibility']);
        }
        $pinIds = array_key_exists('pinIds', $data) ? self::checkPins($data['pinIds'], (string) $npc['campaign_id'], $user['id'], $role) : null;
        Db::transaction(static function () use ($sets, $values, $npc, $pinIds, $user, $role, $characterDescription): void {
            if ($characterDescription !== null) {
                Db::exec('UPDATE characters SET description = ?, rev = rev + 1, updated_at = UTC_TIMESTAMP() WHERE id = ?', [$characterDescription, $npc['character_id']]);
            }
            if ($sets !== []) {
                $sets[] = 'updated_at = UTC_TIMESTAMP()';
                $values[] = $npc['id'];
                Db::exec('UPDATE journal_npcs SET ' . implode(', ', $sets) . ' WHERE id = ?', $values);
            }
            if ($pinIds !== null) {
                // mění se jen body, které uživatel vidí; propojení s ostatními (skrytými) body zůstanou
                $visible = array_map(static fn (array $p): string => (string) $p['pinId'], MapController::placesSql((string) $npc['campaign_id'], $user['id'], $role));
                foreach (array_diff($visible, $pinIds) as $pinId) {
                    Db::exec('DELETE FROM map_pin_npcs WHERE pin_id = ? AND npc_id = ?', [$pinId, $npc['id']]);
                }
                foreach ($pinIds as $pinId) {
                    Db::exec('INSERT IGNORE INTO map_pin_npcs (pin_id, npc_id) VALUES (?, ?)', [$pinId, $npc['id']]);
                }
            }
        });
        return ['npc' => self::one((string) $npc['id'], $user['id'], $role)];
    }

    /** @param array{id:string} $user */
    public static function delete(Request $req, array $params, array $user): ?array
    {
        [$npc] = self::load($params['id'], $user);
        if ($npc['c_kind'] !== null) {
            throw HttpError::validation('Postava z kampaně je v přehledu vždy, smazat ji nejde (DM ji může skrýt).', 'id');
        }
        Db::exec('DELETE FROM journal_npcs WHERE id = ?', [$npc['id']]);
        return null;
    }

    // ------------------------------------------------------------------ propojení se zápisy (volá JournalController)

    /**
     * Ověří seznam NPC u zápisu: musí patřit do kampaně a autor je musí vidět (skryté NPC DM hráč nezná, takže ho nepřiřadí).
     * @return list<string>
     */
    public static function checkLinks(mixed $ids, string $campaignId, string $role): array
    {
        if (!is_array($ids) || count($ids) > self::MAX_LINKS) {
            throw HttpError::validation('Seznam NPC je neplatný (nejvýš ' . self::MAX_LINKS . ').', 'npcIds');
        }
        $out = [];
        foreach ($ids as $id) {
            if (!is_string($id) || !Ids::isUuid($id)) {
                throw HttpError::validation('Neplatné NPC.', 'npcIds');
            }
            $out[$id] = $id;
        }
        $out = array_values($out);
        if ($out === []) {
            return [];
        }
        $in = implode(',', array_fill(0, count($out), '?'));
        $found = (int) Db::value("SELECT COUNT(*) FROM journal_npcs n WHERE n.campaign_id = ? AND n.id IN ($in) AND " . self::visibleSql(), [$campaignId, ...$out, $role]);
        if ($found !== count($out)) {
            throw HttpError::validation('Některé NPC v téhle kampani neexistuje.', 'npcIds');
        }
        return $out;
    }

    /**
     * Nastaví NPC zápisu na `$requested`. Propojení se skrytými NPC, která autor změny nevidí, zůstanou beze změny
     * (hráč, který upraví zápis, DM nesmaže jeho poznámku o skrytém NPC). Vrací, jestli se sada změnila.
     * @param list<string> $requested
     */
    public static function replaceLinks(string $entryId, array $requested, string $role): bool
    {
        return self::replaceIn('journal_entry_npcs', 'entry_id', $entryId, $requested, $role);
    }

    /**
     * Totéž pro NPC na bodu mapy.
     * @param list<string> $requested
     */
    public static function replacePinLinks(string $pinId, array $requested, string $role): bool
    {
        return self::replaceIn('map_pin_npcs', 'pin_id', $pinId, $requested, $role);
    }

    /**
     * @param 'journal_entry_npcs'|'map_pin_npcs' $table pevné jméno tabulky (nikdy ze vstupu)
     * @param 'entry_id'|'pin_id' $column
     * @param list<string> $requested
     */
    private static function replaceIn(string $table, string $column, string $ownerId, array $requested, string $role): bool
    {
        $rows = Db::all("SELECT l.npc_id, n.visibility FROM $table l JOIN journal_npcs n ON n.id = l.npc_id WHERE l.$column = ?", [$ownerId]);
        $existing = array_map(static fn (array $r): string => (string) $r['npc_id'], $rows);
        $kept = $role === 'dm' ? [] : array_map(static fn (array $r): string => (string) $r['npc_id'], array_filter($rows, static fn (array $r): bool => $r['visibility'] === 'dm'));
        $final = array_values(array_unique(array_merge($requested, $kept)));
        $a = $existing;
        $b = $final;
        sort($a);
        sort($b);
        if ($a === $b) {
            return false;
        }
        Db::exec("DELETE FROM $table WHERE $column = ?", [$ownerId]);
        foreach ($final as $npcId) {
            Db::exec("INSERT INTO $table ($column, npc_id) VALUES (?, ?)", [$ownerId, $npcId]);
        }
        return true;
    }

    /**
     * NPC na bodech mapy, jak je vidí uživatel s rolí `$role` (skrytá NPC DM jen DM).
     * @param list<string> $pinIds
     * @return array<string, list<string>>
     */
    public static function pinLinkMap(array $pinIds, string $role): array
    {
        if ($pinIds === []) {
            return [];
        }
        $in = implode(',', array_fill(0, count($pinIds), '?'));
        $map = [];
        foreach (Db::all(
            "SELECT l.pin_id, l.npc_id FROM map_pin_npcs l JOIN journal_npcs n ON n.id = l.npc_id WHERE l.pin_id IN ($in) AND " . self::visibleSql(),
            [...$pinIds, $role],
        ) as $r) {
            $map[(string) $r['pin_id']][] = (string) $r['npc_id'];
        }
        return $map;
    }

    /**
     * Kde na mapách se NPC nacházejí: jen body, které uživatel vidí (mapa zveřejněná nebo DM, viditelnost bodu jako na mapě).
     * @param list<string> $npcIds
     * @return array<string, list<array<string, mixed>>>
     */
    private static function placesOf(array $npcIds, string $userId, string $role): array
    {
        if ($npcIds === []) {
            return [];
        }
        $in = implode(',', array_fill(0, count($npcIds), '?'));
        $out = [];
        foreach (Db::all(
            "SELECT l.npc_id, p.id, p.map_id, p.title, p.icon, m.name AS map_name
             FROM map_pin_npcs l JOIN map_pins p ON p.id = l.pin_id JOIN maps m ON m.id = p.map_id
             WHERE l.npc_id IN ($in) AND (m.visible = 1 OR ? = 'dm') AND " . MapController::pinVisibleSql() . '
             ORDER BY m.name, p.title',
            [...$npcIds, $role, ...MapController::pinVisibleArgs($userId, $role)],
        ) as $r) {
            $out[(string) $r['npc_id']][] = ['pinId' => $r['id'], 'mapId' => $r['map_id'], 'mapName' => $r['map_name'], 'title' => $r['title'], 'icon' => $r['icon']];
        }
        return $out;
    }

    /**
     * NPC u zápisů, jak je vidí uživatel s rolí `$role` (skrytá NPC DM jen DM).
     * @param list<string> $entryIds
     * @return array<string, list<string>>
     */
    public static function linkMap(array $entryIds, string $role): array
    {
        if ($entryIds === []) {
            return [];
        }
        $in = implode(',', array_fill(0, count($entryIds), '?'));
        $map = [];
        foreach (Db::all(
            "SELECT l.entry_id, l.npc_id FROM journal_entry_npcs l JOIN journal_npcs n ON n.id = l.npc_id WHERE l.entry_id IN ($in) AND " . self::visibleSql(),
            [...$entryIds, $role],
        ) as $r) {
            $map[(string) $r['entry_id']][] = (string) $r['npc_id'];
        }
        return $map;
    }

    // ------------------------------------------------------------------ pomocné

    /**
     * Doplní do přehledu postavy hráčů a NPC postavy, které v něm ještě nejsou. Autor záznamu je hráč (u NPC postavy, která
     * nikomu nepatří, DM kampaně), viditelnost `all` jako u veřejného náhledu postav na stránce kampaně.
     */
    private static function ensureCharacters(string $campaignId): void
    {
        $dmId = null;
        $missing = Db::all(
            "SELECT c.id, c.name, c.race, c.owner_id FROM characters c
             WHERE c.campaign_id = ? AND ((c.kind = 'pc' AND c.owner_id IS NOT NULL) OR c.kind = 'npc')
               AND NOT EXISTS (SELECT 1 FROM journal_npcs n WHERE n.campaign_id = c.campaign_id AND n.character_id = c.id)",
            [$campaignId],
        );
        foreach ($missing as $c) {
            if ($c['owner_id'] === null) {
                $dmId ??= Db::value("SELECT user_id FROM campaign_members WHERE campaign_id = ? AND role = 'dm' ORDER BY joined_at LIMIT 1", [$campaignId]);
                if ($dmId === null) {
                    continue;
                }
                $c['owner_id'] = $dmId;
            }
            // INSERT IGNORE: souběžné načtení téže stránky narazí na unikátní klíč (kampaň, postava) a nic nezdvojí
            Db::exec(
                "INSERT IGNORE INTO journal_npcs (id, campaign_id, character_id, name, race, description, visibility, created_by, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, '', 'all', ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())",
                [Ids::uuid(), $campaignId, $c['id'], $c['name'], (string) $c['race'], $c['owner_id']],
            );
        }
    }

    /**
     * Ověří body pro „kde se NPC nachází“: každý musí být z kampaně a uživatel ho musí vidět (jinak 422, nic neprozradí).
     * @return list<string>
     */
    private static function checkPins(mixed $ids, string $campaignId, string $userId, string $role): array
    {
        if (!is_array($ids) || count($ids) > self::MAX_LINKS) {
            throw HttpError::validation('Seznam míst je neplatný (nejvýš ' . self::MAX_LINKS . ').', 'pinIds');
        }
        $out = [];
        foreach ($ids as $id) {
            if (!is_string($id) || !Ids::isUuid($id)) {
                throw HttpError::validation('Neplatné místo.', 'pinIds');
            }
            $out[$id] = $id;
        }
        $out = array_values($out);
        if (count(MapController::placesSql($campaignId, $userId, $role, $out)) !== count($out)) {
            throw HttpError::validation('Některé místo na mapě neexistuje.', 'pinIds');
        }
        return $out;
    }

    private static function select(): string
    {
        return 'SELECT n.*, c.name AS c_name, c.race AS c_race, c.kind AS c_kind, c.photo_path AS c_photo, c.owner_id AS c_owner, c.description AS c_description, u.display_name AS author_name
                FROM journal_npcs n
                LEFT JOIN characters c ON c.id = n.character_id
                JOIN users u ON u.id = n.created_by';
    }

    /** Parametr: role uživatele. */
    private static function visibleSql(): string
    {
        return "(n.visibility = 'all' OR ? = 'dm')";
    }

    /** @return array{0: array<string, mixed>, 1: string} */
    private static function load(string $id, array $user): array
    {
        $npc = Ids::isUuid($id) ? Db::one(self::select() . ' WHERE n.id = ?', [$id]) : null;
        $role = $npc === null ? null : Access::role($user['id'], (string) $npc['campaign_id']);
        if ($npc === null || $role === null || ($npc['visibility'] === 'dm' && $role !== 'dm')) {
            throw HttpError::notFound('NPC nenalezeno.');
        }
        if ($npc['created_by'] !== $user['id'] && $role !== 'dm') {
            throw HttpError::forbidden('Cizí NPC může upravit nebo smazat jen jeho autor a DM.');
        }
        return [$npc, $role];
    }

    /** @param array<string, mixed> $data */
    private static function visibility(array $data, string $role, ?string $current): string
    {
        $v = $data['visibility'] ?? ($current ?? 'all');
        if (!is_string($v) || !in_array($v, ['all', 'dm'], true)) {
            throw HttpError::validation('Neplatná viditelnost.', 'visibility');
        }
        if ($role !== 'dm' && $v !== ($current ?? 'all')) {
            throw HttpError::forbidden('Viditelnost NPC nastavuje jen DM.');
        }
        return $v;
    }

    /** @return list<string> */
    private static function characterIds(mixed $ids): array
    {
        if (!is_array($ids) || $ids === [] || count($ids) > self::MAX_LINKS) {
            throw HttpError::validation('Vyber postavy (nejvýš ' . self::MAX_LINKS . ').', 'characterIds');
        }
        $out = [];
        foreach ($ids as $id) {
            if (!is_string($id) || !Ids::isUuid($id)) {
                throw HttpError::validation('Neplatná postava.', 'characterIds');
            }
            $out[$id] = $id;
        }
        return array_values($out);
    }

    private static function insert(string $campaignId, string $userId, string $name, string $race, string $description, string $visibility, ?string $characterId): string
    {
        if ((int) Db::value('SELECT COUNT(*) FROM journal_npcs WHERE campaign_id = ?', [$campaignId]) >= self::MAX_NPCS) {
            throw HttpError::validation('V přehledu může být nejvýš ' . self::MAX_NPCS . ' NPC.', 'name');
        }
        $id = Ids::uuid();
        Db::exec(
            'INSERT INTO journal_npcs (id, campaign_id, character_id, name, race, description, visibility, created_by, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())',
            [$id, $campaignId, $characterId, $name, $race, $description, $visibility, $userId],
        );
        return $id;
    }

    /** @return array<string, mixed> */
    private static function one(string $id, string $userId, string $role): array
    {
        $row = Db::one(self::select() . ' WHERE n.id = ?', [$id]) ?? [];
        return self::payloads([$row], $userId, $role)[0];
    }

    /**
     * @param list<array<string, mixed>> $rows
     * @return list<array<string, mixed>>
     */
    private static function payloads(array $rows, string $userId, string $role): array
    {
        $places = self::placesOf(array_values(array_map(static fn (array $r): string => (string) $r['id'], $rows)), $userId, $role);
        return array_map(static function (array $r) use ($userId, $role, $places): array {
            $linked = $r['c_name'] !== null;
            $mine = $r['created_by'] === $userId;
            return [
                'id' => $r['id'],
                'name' => $linked ? $r['c_name'] : $r['name'],
                'race' => $linked ? $r['c_race'] : $r['race'],
                // postava z kampaně: popis z profilu (starý vlastní popis z deníku jen, když profil žádný nemá)
                'description' => $linked && (string) $r['c_description'] !== '' ? $r['c_description'] : $r['description'],
                'visibility' => $r['visibility'],
                // Postava nebo NPC postava z kampaně (null = NPC jen z deníku)
                'characterId' => $linked ? $r['character_id'] : null,
                'characterKind' => $linked ? $r['c_kind'] : null,
                'photoVersion' => $linked && $r['c_photo'] !== null ? substr(md5((string) $r['c_photo']), 0, 10) : null,
                'createdBy' => $r['created_by'],
                'createdByName' => $r['author_name'],
                'mine' => $mine,
                'canEdit' => $mine || $role === 'dm',
                // popis postavy z kampaně mění majitel postavy a DM (zapisuje se do profilu)
                'canEditDescription' => $linked ? ($role === 'dm' || $r['c_owner'] === $userId) : ($mine || $role === 'dm'),
                'places' => $places[(string) $r['id']] ?? [],
                'createdAt' => Ids::iso((string) $r['created_at']),
                'updatedAt' => Ids::iso((string) $r['updated_at']),
            ];
        }, $rows);
    }
}
