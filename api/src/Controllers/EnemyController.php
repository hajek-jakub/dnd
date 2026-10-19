<?php

declare(strict_types=1);

namespace Dnd\Controllers;

use Dnd\Access;
use Dnd\Db;
use Dnd\Dice;
use Dnd\Initiative;
use Dnd\HttpError;
use Dnd\Ids;
use Dnd\Input;
use Dnd\Request;
use Dnd\Response;

/**
 * Nepřátelé v kampani: jednoduché záznamy (jméno, HP, AC, útoky, poznámka) jen pro DM, aby si DM evidoval, kolik mají životů.
 * Hráči o nich nevidí vůbec nic: celé API je jen pro DM (hráč 403, cizinec 404) a nepřátelé nejsou postavy, takže jim hráči nic nepředají.
 */
final class EnemyController
{
    private const MAX_PER_CAMPAIGN = 100;
    private const MAX_ATTACKS = 12;

    /** @param array{id:string} $user */
    public static function index(Request $req, array $params, array $user): array
    {
        Access::requireDm($user, $params['id']);
        $rows = Db::all('SELECT * FROM enemies WHERE campaign_id = ? ORDER BY position, created_at, id', [$params['id']]);
        return ['enemies' => self::payloads($rows)];
    }

    /** @param array{id:string} $user */
    public static function create(Request $req, array $params, array $user): Response
    {
        Access::requireDm($user, $params['id']);
        $in = $req->json();
        $v = self::validate($in, null);
        $id = Ids::uuid();
        Db::transaction(static function () use ($id, $params, $v): void {
            Db::one('SELECT id FROM campaigns WHERE id = ? FOR UPDATE', [$params['id']]);
            if ((int) Db::value('SELECT COUNT(*) FROM enemies WHERE campaign_id = ?', [$params['id']]) >= self::MAX_PER_CAMPAIGN) {
                throw HttpError::validation('V kampani může být nejvýš ' . self::MAX_PER_CAMPAIGN . ' nepřátel.');
            }
            $pos = (int) Db::value('SELECT COALESCE(MAX(position), -1) + 1 FROM enemies WHERE campaign_id = ?', [$params['id']]);
            self::insert($id, $params['id'], $v, $pos);
        });
        return Response::json(['enemy' => self::payloads([self::find($id)])[0]], 201);
    }

    /** @param array{id:string} $user */
    public static function update(Request $req, array $params, array $user): array
    {
        $row = self::find($params['id']);
        Access::requireDm($user, (string) $row['campaign_id']);
        $v = self::validate($req->json(), $row);
        Db::exec(
            'UPDATE enemies SET name = ?, hp_max = ?, hp_current = ?, ac = ?, initiative = ?, attacks = ?, notes = ?, updated_at = UTC_TIMESTAMP() WHERE id = ?',
            [$v['name'], $v['hpMax'], $v['hpCurrent'], $v['ac'], $v['initiative'], json_encode($v['attacks'], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR), $v['notes'], $row['id']],
        );
        return ['enemy' => self::payloads([self::find($params['id'])])[0]];
    }

    /** Zranění (záporné) nebo léčení (kladné); výsledek se ořízne na 0 až maximum. @param array{id:string} $user */
    public static function hp(Request $req, array $params, array $user): array
    {
        $row = self::find($params['id']);
        Access::requireDm($user, (string) $row['campaign_id']);
        $delta = $req->json()['delta'] ?? null;
        if (!is_int($delta) || $delta === 0 || abs($delta) > 100000) {
            throw HttpError::validation('Zadej nenulové zranění nebo léčení.', 'delta');
        }
        Db::transaction(static function () use ($row, $delta): void {
            $cur = Db::one('SELECT hp_current, hp_max FROM enemies WHERE id = ? FOR UPDATE', [$row['id']]) ?? throw HttpError::notFound('Nepřítel nenalezen.');
            $new = max(0, min((int) $cur['hp_max'], (int) $cur['hp_current'] + $delta));
            Db::exec('UPDATE enemies SET hp_current = ?, updated_at = UTC_TIMESTAMP() WHERE id = ?', [$new, $row['id']]);
        });
        return ['enemy' => self::payloads([self::find($params['id'])])[0]];
    }

    /** Kopie nepřítele s plným zdravím a očíslovaným jménem ("Goblin" -> "Goblin 2"). @param array{id:string} $user */
    public static function duplicate(Request $req, array $params, array $user): Response
    {
        $row = self::find($params['id']);
        Access::requireDm($user, (string) $row['campaign_id']);
        $newId = Ids::uuid();
        Db::transaction(static function () use ($row, $newId): void {
            Db::one('SELECT id FROM campaigns WHERE id = ? FOR UPDATE', [$row['campaign_id']]);
            if ((int) Db::value('SELECT COUNT(*) FROM enemies WHERE campaign_id = ?', [$row['campaign_id']]) >= self::MAX_PER_CAMPAIGN) {
                throw HttpError::validation('V kampani může být nejvýš ' . self::MAX_PER_CAMPAIGN . ' nepřátel.');
            }
            $base = trim((string) preg_replace('/\s+\d+$/u', '', (string) $row['name']));
            $names = array_column(Db::all('SELECT name FROM enemies WHERE campaign_id = ?', [$row['campaign_id']]), 'name');
            $n = 2;
            while (in_array(mb_substr("$base $n", 0, 100), $names, true)) {
                $n++;
            }
            $attacks = json_decode((string) $row['attacks'], true);
            $pos = (int) Db::value('SELECT COALESCE(MAX(position), -1) + 1 FROM enemies WHERE campaign_id = ?', [$row['campaign_id']]);
            self::insert($newId, (string) $row['campaign_id'], [
                'name' => mb_substr("$base $n", 0, 100), 'hpMax' => (int) $row['hp_max'], 'hpCurrent' => (int) $row['hp_max'],
                'ac' => $row['ac'] === null ? null : (int) $row['ac'], 'initiative' => (int) $row['initiative'], 'attacks' => is_array($attacks) ? $attacks : [], 'notes' => (string) $row['notes'],
            ], $pos, $row['source_entry_id'] === null ? null : (string) $row['source_entry_id']);
        });
        return Response::json(['enemy' => self::payloads([self::find($newId)])[0]], 201);
    }

    /** @param array{id:string} $user */
    public static function delete(Request $req, array $params, array $user): ?array
    {
        $row = self::find($params['id']);
        Access::requireDm($user, (string) $row['campaign_id']);
        Db::transaction(static function () use ($row): void {
            Db::one('SELECT id FROM campaigns WHERE id = ? FOR UPDATE', [$row['campaign_id']]);
            Initiative::remove((string) $row['campaign_id'], 'enemy', (string) $row['id']);
            Db::exec('DELETE FROM enemies WHERE id = ?', [$row['id']]);
        });
        return null;
    }

    /** Hod na iniciativu jednoho nepřítele (k20 + bonus, skrytý, jen DM) a zařazení do pořadí. @param array{id:string} $user */
    public static function rollInitiative(Request $req, array $params, array $user): array
    {
        $row = self::find($params['id']);
        Access::requireDm($user, (string) $row['campaign_id']);
        $result = Db::transaction(static fn (): array => self::rollFor($row, $user['id']));
        return ['result' => $result];
    }

    /** Hod na iniciativu všem nepřátelům, kteří ještě stojí (HP nad 0). @param array{id:string} $user */
    public static function rollAllInitiative(Request $req, array $params, array $user): array
    {
        Access::requireDm($user, $params['id']);
        $results = Db::transaction(static function () use ($params, $user): array {
            $out = [];
            foreach (Db::all('SELECT * FROM enemies WHERE campaign_id = ? AND hp_current > 0 ORDER BY position, created_at, id', [$params['id']]) as $row) {
                $out[] = self::rollFor($row, $user['id']);
            }
            return $out;
        });
        return ['results' => $results];
    }

    /**
     * @param array<string, mixed> $row
     * @return array{id: string, name: string, total: int}
     */
    private static function rollFor(array $row, string $userId): array
    {
        $bonus = (int) $row['initiative'];
        $terms = Dice::parse('1d20' . ($bonus > 0 ? "+$bonus" : ($bonus < 0 ? (string) $bonus : '')));
        $rolled = Dice::rollWithMode($terms, 'normal', false);
        DiceController::insertRoll((string) $row['campaign_id'], $userId, null, $row['name'] . ': iniciativa', $terms, 'normal', false, true, $rolled);
        Initiative::set((string) $row['campaign_id'], 'enemy', (string) $row['id'], max(-20, min(60, $rolled['total'])));
        return ['id' => (string) $row['id'], 'name' => (string) $row['name'], 'total' => (int) $rolled['total']];
    }

    // ------------------------------------------------------------------ pomocné

    /**
     * Zvaliduje vstup; u úpravy chybějící pole zůstanou, jak byla.
     * @param array<string, mixed> $in
     * @param array<string, mixed>|null $existing
     * @return array{name: string, hpMax: int, hpCurrent: int, ac: int|null, attacks: list<array{name: string, toHit: int, damage: string}>, notes: string}
     */
    private static function validate(array $in, ?array $existing): array
    {
        $has = static fn (string $k): bool => array_key_exists($k, $in);
        $name = $has('name') || $existing === null ? Input::string($in, 'name', 1, 100, 'Jméno') : (string) $existing['name'];
        $hpMax = $has('hpMax') || $existing === null ? (Input::optionalInt($in, 'hpMax', 1, 100000, 'Maximum HP') ?? throw HttpError::validation('Zadej maximum HP.', 'hpMax')) : (int) $existing['hp_max'];
        if ($has('hpCurrent')) {
            $hpCurrent = Input::optionalInt($in, 'hpCurrent', 0, 100000, 'Aktuální HP') ?? $hpMax;
        } elseif ($existing === null) {
            $hpCurrent = $hpMax;
        } else {
            $hpCurrent = (int) $existing['hp_current'];
        }
        $hpCurrent = min($hpCurrent, $hpMax);
        if ($has('ac')) {
            $ac = $in['ac'] === null ? null : Input::optionalInt($in, 'ac', 0, 50, 'AC');
        } else {
            $ac = $existing === null || $existing['ac'] === null ? null : (int) $existing['ac'];
        }
        if ($has('initiative')) {
            $initiative = Input::optionalInt($in, 'initiative', -10, 30, 'Iniciativa') ?? 0;
        } else {
            $initiative = $existing === null ? 0 : (int) $existing['initiative'];
        }
        $notes = $has('notes') ? (Input::optionalString($in, 'notes', 4000, 'Poznámka') ?? '') : (string) ($existing['notes'] ?? '');

        if ($has('attacks')) {
            $list = $in['attacks'];
            if (!is_array($list) || count($list) > self::MAX_ATTACKS) {
                throw HttpError::validation('Útoky: nejvýš ' . self::MAX_ATTACKS . ' položek.', 'attacks');
            }
            $attacks = [];
            foreach (array_values($list) as $a) {
                if (!is_array($a)) {
                    throw HttpError::validation('Neplatný útok.', 'attacks');
                }
                $aName = Input::string($a, 'name', 1, 60, 'Název útoku');
                $toHit = $a['toHit'] ?? 0;
                if (!is_int($toHit) || $toHit < -10 || $toHit > 30) {
                    throw HttpError::validation('Bonus k útoku musí být celé číslo od -10 do 30.', 'attacks');
                }
                $damage = trim(is_string($a['damage'] ?? null) ? $a['damage'] : '');
                if ($damage !== '') {
                    if (mb_strlen($damage) > 40) {
                        throw HttpError::validation('Zranění je příliš dlouhé.', 'attacks');
                    }
                    Dice::parse($damage); // výraz musí jít hodit (např. 1d6+2), jinak 422
                }
                $attacks[] = ['name' => $aName, 'toHit' => $toHit, 'damage' => $damage];
            }
        } else {
            $decoded = $existing === null ? [] : json_decode((string) $existing['attacks'], true);
            $attacks = is_array($decoded) ? $decoded : [];
        }
        return ['name' => $name, 'hpMax' => $hpMax, 'hpCurrent' => $hpCurrent, 'ac' => $ac, 'initiative' => $initiative, 'attacks' => $attacks, 'notes' => $notes];
    }

    /** @param array<string, mixed> $v */
    private static function insert(string $id, string $campaignId, array $v, int $position, ?string $sourceEntryId = null): void
    {
        Db::exec(
            'INSERT INTO enemies (id, campaign_id, source_entry_id, name, hp_max, hp_current, ac, initiative, attacks, notes, position, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())',
            [$id, $campaignId, $sourceEntryId, $v['name'], $v['hpMax'], $v['hpCurrent'], $v['ac'], $v['initiative'], json_encode($v['attacks'], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR), $v['notes'], $position],
        );
    }

    // ------------------------------------------------------------------ šablony z přípravy (loot) a nasazení do boje

    /**
     * Ověří šablonu nepřítele pro přípravu: stejné hodnoty jako nový nepřítel (jméno, HP, AC, iniciativa, útoky, poznámka) a navíc
     * počet kusů, CR a XP (jen pro přehled DM a AI).
     * @param array<string, mixed> $in
     * @return array<string, mixed>
     */
    public static function template(array $in): array
    {
        $v = self::validate($in, null);
        unset($v['hpCurrent']);
        $count = Input::optionalInt($in, 'count', 1, 20, 'Počet kusů') ?? 1;
        $cr = $in['cr'] ?? null;
        if ($cr !== null && (!is_string($cr) || preg_match('#^(0|1/8|1/4|1/2|[1-9]\d?)$#', $cr) !== 1)) {
            throw HttpError::validation('CR musí být 0, 1/8, 1/4, 1/2 nebo celé číslo do 99.', 'cr');
        }
        $xp = Input::optionalInt($in, 'xp', 0, 1_000_000, 'XP');
        return $v + ['count' => $count, 'cr' => $cr, 'xp' => $xp];
    }

    /**
     * Pošle šablonu z přípravy do boje: vytvoří `count` nepřátel s plným zdravím („Goblin 1“, „Goblin 2“…), kteří si pamatují šablonu
     * (a tím i loot, který z nich padá). Volat v transakci se zámkem kampaně. Vrací jména nových nepřátel.
     * @param array<string, mixed> $template
     * @return list<string>
     */
    public static function spawn(string $campaignId, array $template, string $sourceEntryId): array
    {
        $count = max(1, min(20, (int) ($template['count'] ?? 1)));
        if ((int) Db::value('SELECT COUNT(*) FROM enemies WHERE campaign_id = ?', [$campaignId]) + $count > self::MAX_PER_CAMPAIGN) {
            throw HttpError::validation('V kampani může být nejvýš ' . self::MAX_PER_CAMPAIGN . ' nepřátel. Smaž v Panelu DM ty, kteří už padli.');
        }
        $v = self::validate($template, null);
        $base = mb_substr($v['name'], 0, 96);
        $names = array_column(Db::all('SELECT name FROM enemies WHERE campaign_id = ?', [$campaignId]), 'name');
        $created = [];
        $n = 1;
        for ($i = 0; $i < $count; $i++) {
            if ($count === 1 && !in_array($base, $names, true)) {
                $name = $base;
            } else {
                while (in_array("$base $n", $names, true)) {
                    $n++;
                }
                $name = "$base $n";
            }
            $names[] = $name;
            $pos = (int) Db::value('SELECT COALESCE(MAX(position), -1) + 1 FROM enemies WHERE campaign_id = ?', [$campaignId]);
            self::insert(Ids::uuid(), $campaignId, ['name' => $name, 'hpCurrent' => $v['hpMax']] + $v, $pos, $sourceEntryId);
            $created[] = $name;
        }
        return $created;
    }

    /** @return array<string, mixed> */
    private static function find(string $id): array
    {
        return (Ids::isUuid($id) ? Db::one('SELECT * FROM enemies WHERE id = ?', [$id]) : null) ?? throw HttpError::notFound('Nepřítel nenalezen.');
    }

    /**
     * Nepřátelé pro odpověď, u nepřítele z přípravy i s lootem, který z něj padá (položky přípravy s `drop_from` na jeho šablonu).
     * @param list<array<string, mixed>> $rows
     * @return list<array<string, mixed>>
     */
    private static function payloads(array $rows): array
    {
        $sources = array_values(array_unique(array_filter(array_column($rows, 'source_entry_id'), static fn (mixed $v): bool => $v !== null)));
        $folders = [];
        $drops = [];
        if ($sources !== []) {
            $in = implode(',', array_fill(0, count($sources), '?'));
            foreach (Db::all("SELECT id, folder_id FROM loot_entries WHERE id IN ($in)", $sources) as $e) {
                $folders[$e['id']] = $e['folder_id'];
            }
            foreach (Db::all("SELECT * FROM loot_entries WHERE drop_from IN ($in) ORDER BY position, created_at, id", $sources) as $e) {
                $drops[$e['drop_from']][] = ['id' => $e['id'], 'label' => LootController::label($e), 'givenTo' => (string) $e['given_to']];
            }
        }
        return array_map(static fn (array $r): array => self::payload($r) + [
            'sourceEntryId' => $r['source_entry_id'],
            'sourceFolderId' => $r['source_entry_id'] !== null ? ($folders[$r['source_entry_id']] ?? null) : null,
            'drops' => $r['source_entry_id'] !== null ? ($drops[$r['source_entry_id']] ?? []) : [],
        ], $rows);
    }

    /** @param array<string, mixed> $r @return array<string, mixed> */
    private static function payload(array $r): array
    {
        $attacks = json_decode((string) $r['attacks'], true);
        return [
            'id' => $r['id'],
            'campaignId' => $r['campaign_id'],
            'name' => $r['name'],
            'hpMax' => (int) $r['hp_max'],
            'hpCurrent' => (int) $r['hp_current'],
            'ac' => $r['ac'] === null ? null : (int) $r['ac'],
            'initiative' => (int) $r['initiative'],
            'attacks' => is_array($attacks) ? $attacks : [],
            'notes' => $r['notes'],
            'position' => (int) $r['position'],
        ];
    }
}
