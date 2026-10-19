<?php

declare(strict_types=1);

namespace Dnd\Controllers;

use Dnd\Access;
use Dnd\Db;
use Dnd\HttpError;
use Dnd\Ids;
use Dnd\Input;
use Dnd\Items;
use Dnd\Money;
use Dnd\Request;
use Dnd\Response;

/**
 * Loot DM: stromová struktura složek (dungeon -> místnosti) s připravenými itemy a zlatem, které DM rozdá podle toho, co družina najde.
 * Všechno je jen pro DM (hráč 403, cizinec 404); hráči se o lootu nedozvědí, dokud jim ho DM nerozdá (pak je to běžný item nebo peníze).
 * Item v lootu je samostatná kopie ve tvaru vstupu vlastního itemu (včetně kletby): i item z pravidel se uloží celý, takže jde upravit
 * a rozdá se stejnou cestou jako vlastní item (nic se znovu nedohledává, smazaný homebrew ho nerozbije). Je to zároveň „dílna“ DM.
 * Item může mít cenu (`price_cp`): pak je na prodej (obchod) a příjemce ji při rozdání zaplatí; bez ceny je to nalezená věc zdarma.
 */
final class LootController
{
    private const MAX_FOLDERS = 300;
    private const MAX_ENTRIES = 1500;
    private const MAX_DEPTH = 6;
    private const COINS = ['cp', 'sp', 'ep', 'gp', 'pp'];

    /** @param array{id:string} $user */
    public static function index(Request $req, array $params, array $user): array
    {
        Access::requireDm($user, $params['id']);
        return self::tree($params['id']);
    }

    // ------------------------------------------------------------------ složky

    /** @param array{id:string} $user */
    public static function createFolder(Request $req, array $params, array $user): Response
    {
        Access::requireDm($user, $params['id']);
        $in = $req->json();
        $name = Input::string($in, 'name', 1, 120, 'Název složky');
        $parent = self::parentId($in, $params['id']);
        $id = Db::transaction(static function () use ($params, $name, $parent): string {
            Db::one('SELECT id FROM campaigns WHERE id = ? FOR UPDATE', [$params['id']]);
            return self::insertFolder($params['id'], $name, $parent);
        });
        return Response::json(['folder' => self::folderPayload(self::folder($id))], 201);
    }

    /** Přejmenování a přesun složky (do jiné složky nebo na nejvyšší úroveň, `parentId: null`). @param array{id:string} $user */
    public static function updateFolder(Request $req, array $params, array $user): array
    {
        $row = self::folder($params['id']);
        Access::requireDm($user, (string) $row['campaign_id']);
        $in = $req->json();
        $name = array_key_exists('name', $in) ? Input::string($in, 'name', 1, 120, 'Název složky') : (string) $row['name'];
        $parent = $row['parent_id'];
        if (array_key_exists('parentId', $in)) {
            $parent = self::parentId($in, (string) $row['campaign_id']);
            if ($parent !== null) {
                // Složka nesmí skončit sama v sobě ani ve své podsložce.
                for ($p = $parent; $p !== null; $p = self::folder($p)['parent_id']) {
                    if ($p === $row['id']) {
                        throw HttpError::validation('Složku nejde přesunout do sebe samé.', 'parentId');
                    }
                }
                if (self::depth($parent) + self::height((string) $row['id']) > self::MAX_DEPTH) {
                    throw HttpError::validation('Složky lze vnořit nejvýš do ' . self::MAX_DEPTH . ' úrovní.', 'parentId');
                }
            }
        }
        Db::exec('UPDATE loot_folders SET name = ?, parent_id = ? WHERE id = ?', [$name, $parent, $row['id']]);
        return ['folder' => self::folderPayload(self::folder($params['id']))];
    }

    /** Smaže složku i s podsložkami a položkami v nich. @param array{id:string} $user */
    public static function deleteFolder(Request $req, array $params, array $user): ?array
    {
        $row = self::folder($params['id']);
        Access::requireDm($user, (string) $row['campaign_id']);
        Db::exec('DELETE FROM loot_folders WHERE id = ?', [$row['id']]);
        return null;
    }

    // ------------------------------------------------------------------ položky

    /**
     * Nový item nebo zlato ve složce. Tělo: `{folderId?, kind: 'item', item: {...}, price?: {gp: 50}}` (s cenou na prodej)
     * nebo `{folderId?, kind: 'gold', currency: {...}, name?}`. @param array{id:string} $user
     */
    public static function createEntry(Request $req, array $params, array $user): Response
    {
        Access::requireDm($user, $params['id']);
        $in = $req->json();
        $folder = self::folderId($in, $params['id']);
        $data = self::entryData($in, $params['id'], $user);
        $price = self::price($in, $data['kind']);
        $id = Db::transaction(static function () use ($params, $folder, $data, $price): string {
            Db::one('SELECT id FROM campaigns WHERE id = ? FOR UPDATE', [$params['id']]);
            return self::insertEntry($params['id'], $folder, $data, $price);
        });
        return Response::json(['entry' => self::entryPayload(self::entry($id))], 201);
    }

    /** Úprava položky (obsah, přesun do jiné složky, smazání poznámky „rozdáno“). @param array{id:string} $user */
    public static function updateEntry(Request $req, array $params, array $user): array
    {
        $row = self::entry($params['id']);
        $campaignId = (string) $row['campaign_id'];
        Access::requireDm($user, $campaignId);
        $in = $req->json();
        $folder = $row['folder_id'];
        if (array_key_exists('folderId', $in)) {
            $folder = self::folderId($in, $campaignId);
        }
        $data = json_decode((string) $row['data'], true);
        if (array_key_exists('item', $in) || array_key_exists('currency', $in) || array_key_exists('name', $in)) {
            $merged = $in + ['kind' => $row['kind']];
            if ($merged['kind'] !== $row['kind']) {
                throw HttpError::validation('Druh položky nejde změnit.', 'kind');
            }
            $data = self::entryData($merged, $campaignId, $user)['data'];
        }
        $given = array_key_exists('givenTo', $in) && $in['givenTo'] === '' ? '' : (string) $row['given_to'];
        $price = array_key_exists('price', $in) ? self::price($in, (string) $row['kind']) : ($row['price_cp'] === null ? null : (int) $row['price_cp']);
        Db::exec(
            'UPDATE loot_entries SET folder_id = ?, data = ?, price_cp = ?, given_to = ?, updated_at = UTC_TIMESTAMP() WHERE id = ?',
            [$folder, json_encode($data, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR), $price, $given, $row['id']],
        );
        return ['entry' => self::entryPayload(self::entry($params['id']))];
    }

    /** @param array{id:string} $user */
    public static function deleteEntry(Request $req, array $params, array $user): ?array
    {
        $row = self::entry($params['id']);
        Access::requireDm($user, (string) $row['campaign_id']);
        Db::exec('DELETE FROM loot_entries WHERE id = ?', [$row['id']]);
        return null;
    }

    // ------------------------------------------------------------------ rozdání

    /**
     * Rozdá připravený loot. Tělo: `{assignments: [{entryId, characterIds: [...], split?: bool}]}`.
     * Item dostane každá uvedená postava (zpravidla jedna), zlato se podle `split` rozdělí rovným dílem, nebo dostane každý celou částku.
     * Všechno proběhne v jedné transakci a postavy musí patřit do kampaně (jinak 422 a nic se nerozdá).
     * @param array{id:string} $user
     */
    public static function give(Request $req, array $params, array $user): array
    {
        Access::requireDm($user, $params['id']);
        $list = $req->json()['assignments'] ?? null;
        if (!is_array($list) || $list === [] || count($list) > 80) {
            throw HttpError::validation('Pošli 1 až 80 přiřazení v poli assignments.', 'assignments');
        }
        $plan = [];
        foreach (array_values($list) as $a) {
            $entryId = is_array($a) && is_string($a['entryId'] ?? null) ? $a['entryId'] : '';
            $ids = is_array($a) ? ($a['characterIds'] ?? null) : null;
            if (!Ids::isUuid($entryId) || !is_array($ids) || $ids === [] || count($ids) > 30) {
                throw HttpError::validation('Každé přiřazení potřebuje entryId a 1 až 30 postav.', 'assignments');
            }
            $plan[] = ['entryId' => $entryId, 'characterIds' => array_values($ids), 'split' => ($a['split'] ?? false) === true];
        }

        $result = Db::transaction(static function () use ($params, $user, $plan): array {
            $out = [];
            foreach ($plan as $p) {
                $row = Db::one('SELECT * FROM loot_entries WHERE id = ? AND campaign_id = ? FOR UPDATE', [$p['entryId'], $params['id']]) ?? throw HttpError::validation('Položka lootu není z této kampaně.', 'assignments');
                $data = json_decode((string) $row['data'], true);
                $data = is_array($data) ? $data : [];
                $priceCp = $row['kind'] === 'item' && $row['price_cp'] !== null ? (int) $row['price_cp'] : null;
                if ($row['kind'] === 'item') {
                    // Item na prodej: každý příjemce zaplatí cenu (kdo nemá dost, celé rozdání se zruší).
                    $labels = DmController::grantItem($params['id'], $user, $p['characterIds'], $data, $priceCp);
                    $label = (string) (array_values($labels)[0] ?? ($data['name'] ?? 'Item'));
                    $recipients = array_keys($labels);
                } else {
                    $coins = is_array($data['currency'] ?? null) ? $data['currency'] : [];
                    DmController::grantCurrency($params['id'], $user, $p['characterIds'], $coins, 'give', $p['split'], (string) ($data['name'] ?? ''));
                    $label = (string) ($data['name'] ?? '') !== '' ? (string) $data['name'] : 'Zlato';
                    $recipients = array_map('strval', $p['characterIds']);
                }
                $names = array_column(Db::all('SELECT name FROM characters WHERE id IN (' . implode(',', array_fill(0, count($recipients), '?')) . ') ORDER BY name', $recipients), 'name');
                $givenTo = mb_substr(trim(implode(', ', array_unique(array_filter([...explode(', ', (string) $row['given_to']), ...$names]))), ', '), 0, 400);
                Db::exec('UPDATE loot_entries SET given_to = ?, updated_at = UTC_TIMESTAMP() WHERE id = ?', [$givenTo, $row['id']]);
                $out[] = ['entryId' => (string) $row['id'], 'label' => $label, 'to' => array_values($names), 'priceCp' => $priceCp];
            }
            return $out;
        });
        return ['given' => $result] + self::tree($params['id']);
    }

    // ------------------------------------------------------------------ zápis (i pro návrhy AI pomocníka)

    /** Založí složku na konci úrovně. Volat v transakci se zámkem kampaně (limity se nesmí předběhnout). */
    public static function insertFolder(string $campaignId, string $name, ?string $parent): string
    {
        if ((int) Db::value('SELECT COUNT(*) FROM loot_folders WHERE campaign_id = ?', [$campaignId]) >= self::MAX_FOLDERS) {
            throw HttpError::validation('Složek může být nejvýš ' . self::MAX_FOLDERS . '.', 'name');
        }
        if ($parent !== null && self::depth($parent) >= self::MAX_DEPTH) {
            throw HttpError::validation('Složky lze vnořit nejvýš do ' . self::MAX_DEPTH . ' úrovní.', 'parentId');
        }
        $id = Ids::uuid();
        $pos = (int) Db::value('SELECT COALESCE(MAX(position), -1) + 1 FROM loot_folders WHERE campaign_id = ? AND parent_id <=> ?', [$campaignId, $parent]);
        Db::exec('INSERT INTO loot_folders (id, campaign_id, parent_id, name, position, created_at) VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP())', [$id, $campaignId, $parent, $name, $pos]);
        return $id;
    }

    /**
     * Najde složku podle cesty názvů od kořene (`['Hrobka', 'Místnost 1']`) a chybějící úrovně založí; prázdná cesta = Nezařazené (null).
     * Volat v transakci se zámkem kampaně.
     * @param list<string> $path
     */
    public static function ensurePath(string $campaignId, array $path): ?string
    {
        $parent = null;
        foreach ($path as $name) {
            $found = Db::value('SELECT id FROM loot_folders WHERE campaign_id = ? AND parent_id <=> ? AND name = ? ORDER BY position, created_at LIMIT 1', [$campaignId, $parent, $name]);
            $parent = $found !== null ? (string) $found : self::insertFolder($campaignId, $name, $parent);
        }
        return $parent;
    }

    /**
     * Uloží ověřenou položku (`entryData`) na konec složky. Volat v transakci se zámkem kampaně.
     * @param array{kind: string, data: array<string, mixed>} $data
     */
    public static function insertEntry(string $campaignId, ?string $folder, array $data, ?int $price): string
    {
        if ((int) Db::value('SELECT COUNT(*) FROM loot_entries WHERE campaign_id = ?', [$campaignId]) >= self::MAX_ENTRIES) {
            throw HttpError::validation('Položek lootu může být nejvýš ' . self::MAX_ENTRIES . '.', 'kind');
        }
        $id = Ids::uuid();
        $pos = (int) Db::value('SELECT COALESCE(MAX(position), -1) + 1 FROM loot_entries WHERE campaign_id = ? AND folder_id <=> ?', [$campaignId, $folder]);
        Db::exec(
            'INSERT INTO loot_entries (id, campaign_id, folder_id, kind, data, price_cp, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())',
            [$id, $campaignId, $folder, $data['kind'], json_encode($data['data'], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR), $price, $pos],
        );
        return $id;
    }

    // ------------------------------------------------------------------ pomocné

    /** @return array{folders: list<array<string, mixed>>, entries: list<array<string, mixed>>} */
    public static function tree(string $campaignId): array
    {
        return [
            'folders' => array_map([self::class, 'folderPayload'], Db::all('SELECT * FROM loot_folders WHERE campaign_id = ? ORDER BY position, created_at, id', [$campaignId])),
            'entries' => array_map([self::class, 'entryPayload'], Db::all('SELECT * FROM loot_entries WHERE campaign_id = ? ORDER BY position, created_at, id', [$campaignId])),
        ];
    }

    /**
     * Zvaliduje obsah položky a vrátí `{kind, data}` k uložení.
     * @param array<string, mixed> $in
     * @param array{id:string} $user
     * @return array{kind: string, data: array<string, mixed>}
     */
    public static function entryData(array $in, string $campaignId, array $user): array
    {
        $kind = $in['kind'] ?? null;
        if ($kind === 'gold') {
            $coins = [];
            $c = $in['currency'] ?? null;
            if (!is_array($c)) {
                throw HttpError::validation('Zadej peníze.', 'currency');
            }
            foreach (self::COINS as $coin) {
                $v = $c[$coin] ?? 0;
                if (!is_int($v) || $v < 0 || $v > 1_000_000_000) {
                    throw HttpError::validation("Mince $coin musí být celé číslo od 0.", 'currency');
                }
                if ($v > 0) {
                    $coins[$coin] = $v;
                }
            }
            if ($coins === []) {
                throw HttpError::validation('Zadej aspoň jednu minci.', 'currency');
            }
            return ['kind' => 'gold', 'data' => ['name' => Input::optionalString($in, 'name', 120, 'Název') ?? '', 'currency' => $coins]];
        }
        if ($kind !== 'item') {
            throw HttpError::validation("Druh položky musí být 'item' nebo 'gold'.", 'kind');
        }
        $item = $in['item'] ?? null;
        if (!is_array($item)) {
            throw HttpError::validation('Zadej item (ruleId nebo vlastní údaje).', 'item');
        }
        // Stejné sestavení jako při přidání do inventáře (pravidla, základ magické zbroje, validace, kletba), uloží se jako samostatná kopie.
        return ['kind' => 'item', 'data' => Items::toInput(InventoryController::buildItem($campaignId, $user, $item))];
    }

    /**
     * Cena itemu na prodej v mědácích (null = nalezená věc zdarma). Zlato cenu mít nemůže.
     * @param array<string, mixed> $in
     */
    public static function price(array $in, string $kind): ?int
    {
        $price = Money::priceCp($in['price'] ?? null);
        if ($price !== null && $kind !== 'item') {
            throw HttpError::validation('Cenu může mít jen item, zlato ne.', 'price');
        }
        return $price;
    }

    /** @param array<string, mixed> $in */
    private static function parentId(array $in, string $campaignId): ?string
    {
        return self::folderId(['folderId' => $in['parentId'] ?? null], $campaignId);
    }

    /** @param array<string, mixed> $in */
    private static function folderId(array $in, string $campaignId): ?string
    {
        $id = $in['folderId'] ?? null;
        if ($id === null || $id === '') {
            return null;
        }
        if (!is_string($id) || !Ids::isUuid($id) || Db::one('SELECT id FROM loot_folders WHERE id = ? AND campaign_id = ?', [$id, $campaignId]) === null) {
            throw HttpError::validation('Složka není z této kampaně.', 'folderId');
        }
        return $id;
    }

    /** Kolik úrovní má složka nad sebou včetně sebe (kořenová = 1). */
    private static function depth(string $folderId): int
    {
        $d = 0;
        for ($p = $folderId; $p !== null && $d < 50; $p = self::folder($p)['parent_id']) {
            $d++;
        }
        return $d;
    }

    /** Kolik úrovní je pod složkou včetně ní (bez podsložek = 1). */
    private static function height(string $folderId): int
    {
        $max = 0;
        foreach (Db::all('SELECT id FROM loot_folders WHERE parent_id = ?', [$folderId]) as $child) {
            $max = max($max, self::height((string) $child['id']));
        }
        return $max + 1;
    }

    /** @return array<string, mixed> */
    private static function folder(string $id): array
    {
        return (Ids::isUuid($id) ? Db::one('SELECT * FROM loot_folders WHERE id = ?', [$id]) : null) ?? throw HttpError::notFound('Složka nenalezena.');
    }

    /** @return array<string, mixed> */
    private static function entry(string $id): array
    {
        return (Ids::isUuid($id) ? Db::one('SELECT * FROM loot_entries WHERE id = ?', [$id]) : null) ?? throw HttpError::notFound('Položka nenalezena.');
    }

    /** @param array<string, mixed> $r @return array<string, mixed> */
    private static function folderPayload(array $r): array
    {
        return ['id' => $r['id'], 'parentId' => $r['parent_id'], 'name' => $r['name'], 'position' => (int) $r['position']];
    }

    /** @param array<string, mixed> $r @return array<string, mixed> */
    private static function entryPayload(array $r): array
    {
        $data = json_decode((string) $r['data'], true);
        return [
            'id' => $r['id'],
            'folderId' => $r['folder_id'],
            'kind' => $r['kind'],
            'data' => is_array($data) ? $data : new \stdClass(),
            'priceCp' => $r['price_cp'] === null ? null : (int) $r['price_cp'],
            'position' => (int) $r['position'],
            'givenTo' => (string) $r['given_to'],
        ];
    }
}
