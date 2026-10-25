<?php

declare(strict_types=1);

namespace Dnd\Controllers;

use Dnd\Access;
use Dnd\Db;
use Dnd\Dice;
use Dnd\HttpError;
use Dnd\Ids;
use Dnd\Images;
use Dnd\Input;
use Dnd\Languages;
use Dnd\Request;
use Dnd\Response;
use Dnd\Sheets;

/**
 * Postavy (character sheet) a DM poznámky.
 * Pravidla viditelnosti postavy:
 *  - majitel a DM vidí vše a smí měnit,
 *  - ostatní členové kampaně vidí jen veřejný náhled (jméno, fotka, rasa, třída, level),
 *    pokud DM nenastaví visibility = 'full' (pak vidí celý sheet, ale nic nemění).
 */
final class CharacterController
{
    private const COLUMNS = '*';

    /** @param array{id:string} $user */
    public static function index(Request $req, array $params, array $user): array
    {
        $role = Access::requireMember($user, $params['id']);
        $rows = Db::all('SELECT ' . self::COLUMNS . ' FROM characters WHERE campaign_id = ? ORDER BY created_at', [$params['id']]);
        $full = array_values(array_filter($rows, static fn (array $r): bool => self::hasFullAccess($r, $user['id'], $role)));
        $sheets = Sheets::loadMany($full, $role === 'dm');
        return ['characters' => array_map(
            static fn (array $r): array => self::hideDeathSaves(self::payload($r, $sheets[(string) $r['id']] ?? null), $r, $user['id'], $role),
            $rows,
        )];
    }

    /** @param array{id:string} $user */
    public static function create(Request $req, array $params, array $user): Response
    {
        $role = Access::requireMember($user, $params['id']);
        $data = $req->json();

        $kind = $data['kind'] ?? 'pc';
        if ($kind !== 'pc' && $kind !== 'npc') {
            throw HttpError::validation("Druh postavy musí být 'pc' nebo 'npc'.", 'kind');
        }
        $ownerId = $user['id'];
        if ($kind === 'npc') {
            // NPC: postava, za kterou hraje DM. Nepatří nikomu (ani DM), takže jich může být víc.
            if ($role !== 'dm') {
                throw HttpError::forbidden('NPC může vytvořit jen DM.');
            }
            if (array_key_exists('ownerId', $data) && $data['ownerId'] !== null) {
                throw HttpError::validation('NPC nemá majitele.', 'ownerId');
            }
            $ownerId = null;
        } elseif (array_key_exists('ownerId', $data)) {
            $requested = is_string($data['ownerId']) ? $data['ownerId'] : '';
            if ($requested !== $user['id']) {
                if ($role !== 'dm') {
                    throw HttpError::forbidden('Postavu na cizí jméno může vytvořit jen DM.');
                }
                if (!Ids::isUuid($requested) || !Access::isMember($requested, $params['id'])) {
                    throw HttpError::validation('Majitel musí být členem kampaně.', 'ownerId');
                }
                $ownerId = $requested;
            }
        }

        $visibility = 'public_only';
        if (array_key_exists('visibility', $data)) {
            if ($role !== 'dm') {
                throw HttpError::forbidden('Viditelnost postavy může nastavit jen DM.');
            }
            $visibility = self::visibility($data);
        }

        $scores = Sheets::abilityScores($data);
        $lv = Sheets::levels($data, $params['id']);
        $state = Sheets::state($data['state'] ?? []);
        $name = Input::string($data, 'name', 1, 100, 'Jméno postavy');
        $baseSpeed = Input::optionalInt($data, 'baseSpeed', 0, 200, 'Rychlost') ?? 30;

        $id = Ids::uuid();
        Db::transaction(static function () use ($id, $params, $ownerId, $kind, $name, $data, $scores, $lv, $state, $visibility, $baseSpeed): void {
            Db::exec(
                'INSERT INTO characters (id, campaign_id, owner_id, kind, name, race, subrace, background, alignment, class_summary, level, notes, visibility,
                    abil_str, abil_dex, abil_con, abil_int, abil_wis, abil_cha, base_speed, hp_current, hp_temp, skill_proficiencies,
                    extra_save_proficiencies, extra_proficiencies, subclasses, personality, description, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, \'\', 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())',
                [
                    $id, $params['id'], $ownerId, $kind, $name,
                    Input::optionalString($data, 'race', 100, 'Rasa') ?? '',
                    Input::optionalString($data, 'subrace', 100, 'Subrasa') ?? '',
                    Input::optionalString($data, 'background', 100, 'Background') ?? '',
                    Input::optionalString($data, 'alignment', 40, 'Alignment') ?? '',
                    Input::optionalString($data, 'notes', 20000, 'Poznámky') ?? '',
                    $visibility,
                    $scores['str'], $scores['dex'], $scores['con'], $scores['int'], $scores['wis'], $scores['cha'],
                    $baseSpeed, $state['hpCurrent'],
                    Sheets::enc(Sheets::skills($data)),
                    Sheets::enc(Sheets::saveProficiencies($data)),
                    Sheets::enc(Languages::normalizeProficiencies(Sheets::stringList($data, 'extraProficiencies'))),
                    Sheets::enc($lv['subclasses']),
                    Sheets::enc(Sheets::personality($data)),
                    Input::optionalString($data, 'description', 20000, 'Popis') ?? '',
                ],
            );
            Sheets::saveLevels($id, $lv['levels']);
        });
        return Response::json(['character' => self::loadFull($id, $role === 'dm')], 201);
    }

    /** @param array{id:string} $user */
    public static function show(Request $req, array $params, array $user): array
    {
        [$row, $role] = self::loadForMember($params['id'], $user);
        if (!self::hasFullAccess($row, $user['id'], $role)) {
            throw HttpError::forbidden('Tuto postavu vidíš jen v omezeném náhledu.');
        }
        return ['character' => self::hideDeathSaves(self::loadFull($params['id'], $role === 'dm'), $row, $user['id'], $role)];
    }

    /**
     * Death saves (úspěchy a neúspěchy) vidí jen majitel a DM. Ostatní hráči, kterým DM ukázal celý sheet, je nevidí.
     * @param array<string, mixed> $payload
     * @param array<string, mixed> $row
     * @return array<string, mixed>
     */
    private static function hideDeathSaves(array $payload, array $row, string $userId, string $role): array
    {
        if ($role === 'dm' || $row['owner_id'] === $userId || !isset($payload['state']) || !is_array($payload['state'])) {
            return $payload;
        }
        $payload['state']['deathSuccesses'] = 0;
        $payload['state']['deathFailures'] = 0;
        return $payload;
    }

    /** @param array{id:string} $user */
    public static function update(Request $req, array $params, array $user): Response
    {
        [$row, $role] = self::loadForMember($params['id'], $user);
        if ($row['owner_id'] !== $user['id'] && $role !== 'dm') {
            throw HttpError::forbidden('Cizí postavu nemůžeš upravovat.');
        }
        $data = $req->json();

        if (array_key_exists('rev', $data) && $data['rev'] !== (int) $row['rev']) {
            return Response::json([
                'error' => ['code' => 'conflict', 'message' => 'Postavu mezitím někdo změnil. Načetla se aktuální verze.'],
                'current' => self::loadFull($params['id'], $role === 'dm'),
            ], 409);
        }

        $sets = [];
        $values = [];
        $set = static function (string $column, mixed $value) use (&$sets, &$values): void {
            $sets[] = "$column = ?";
            $values[] = $value;
        };

        foreach (['name' => ['name', 1, 100, 'Jméno postavy'], 'race' => ['race', 0, 100, 'Rasa'], 'subrace' => ['subrace', 0, 100, 'Subrasa'], 'background' => ['background', 0, 100, 'Background'],
                  'alignment' => ['alignment', 0, 40, 'Alignment'], 'notes' => ['notes', 0, 20000, 'Poznámky'], 'description' => ['description', 0, 20000, 'Popis']] as $field => [$column, $min, $max, $label]) {
            if (array_key_exists($field, $data)) {
                $set($column, Input::string($data, $field, $min, $max, $label));
            }
        }
        if (array_key_exists('abilityScores', $data)) {
            foreach (Sheets::abilityScores($data) as $a => $v) {
                $set('abil_' . $a, $v);
            }
        }
        if (array_key_exists('baseSpeed', $data)) {
            $set('base_speed', Input::optionalInt($data, 'baseSpeed', 0, 200, 'Rychlost') ?? 30);
        }
        if (array_key_exists('inspiration', $data)) {
            if (!is_bool($data['inspiration'])) {
                throw HttpError::validation('Inspirace musí být true/false.', 'inspiration');
            }
            $set('inspiration', $data['inspiration'] ? 1 : 0);
        }
        if (array_key_exists('skillProficiencies', $data)) {
            $set('skill_proficiencies', Sheets::enc(Sheets::skills($data)));
        }
        if (array_key_exists('extraSaveProficiencies', $data)) {
            $set('extra_save_proficiencies', Sheets::enc(Sheets::saveProficiencies($data)));
        }
        if (array_key_exists('extraProficiencies', $data)) {
            $set('extra_proficiencies', Sheets::enc(Languages::normalizeProficiencies(Sheets::stringList($data, 'extraProficiencies'))));
        }
        if (array_key_exists('overrides', $data)) {
            $set('overrides', Sheets::enc(Sheets::overrides($data)));
        }
        if (array_key_exists('personality', $data)) {
            $set('personality', Sheets::enc(Sheets::personality($data)));
        }
        if (array_key_exists('currency', $data)) {
            $set('currency', Sheets::enc(Sheets::currency($data)));
        }
        if (array_key_exists('subclasses', $data)) {
            $levels = Db::all('SELECT class_idx, hp_roll FROM character_levels WHERE character_id = ? ORDER BY seq', [$params['id']]);
            $check = Sheets::levels(
                ['levels' => array_map(static fn (array $l): array => ['classIndex' => $l['class_idx'], 'hpRoll' => null], $levels), 'subclasses' => $data['subclasses']],
                (string) $row['campaign_id'],
            );
            $set('subclasses', Sheets::enc($check['subclasses']));
        }
        // Visibility a majitele smí měnit jen DM.
        if (array_key_exists('visibility', $data) && $data['visibility'] !== $row['visibility']) {
            if ($role !== 'dm') {
                throw HttpError::forbidden('Viditelnost postavy může změnit jen DM.');
            }
            $set('visibility', self::visibility($data));
        }
        if (array_key_exists('ownerId', $data) && $data['ownerId'] !== $row['owner_id']) {
            if ($row['kind'] === 'npc') {
                throw HttpError::validation('NPC nemá majitele.', 'ownerId');
            }
            if ($role !== 'dm') {
                throw HttpError::forbidden('Majitele postavy může změnit jen DM.');
            }
            $owner = is_string($data['ownerId']) ? $data['ownerId'] : '';
            if (!Ids::isUuid($owner) || !Access::isMember($owner, (string) $row['campaign_id'])) {
                throw HttpError::validation('Majitel musí být členem kampaně.', 'ownerId');
            }
            $set('owner_id', $owner);
        }
        // Kampaň postavy se nikdy nemění (campaignId v těle se ignoruje).

        $state = array_key_exists('state', $data) ? Sheets::state(is_array($data['state']) ? $data['state'] : []) : null;
        $custom = array_key_exists('customResources', $data) ? Sheets::customResources($data) : null;

        Db::transaction(static function () use ($params, $sets, $values, $state, $custom): void {
            if ($state !== null) {
                $sets = [...$sets, 'hp_current = ?', 'hp_temp = ?', 'death_successes = ?', 'death_failures = ?', 'hit_dice_used = ?', 'slots_used = ?', 'pact_slots_used = ?', 'conditions = ?', 'concentration = ?'];
                $values = [...$values, $state['hpCurrent'], $state['hpTemp'], $state['deathSuccesses'], $state['deathFailures'], Sheets::enc($state['hitDiceUsed']),
                    Sheets::enc($state['slotsUsed']), $state['pactSlotsUsed'], Sheets::enc($state['conditions']), $state['concentration']];
            }
            if ($sets !== []) {
                $sets[] = 'rev = rev + 1';
                $sets[] = 'updated_at = UTC_TIMESTAMP()';
                $values[] = $params['id'];
                Db::exec('UPDATE characters SET ' . implode(', ', $sets) . ' WHERE id = ?', $values);
            }
            if ($state !== null || $custom !== null) {
                $existing = Db::all('SELECT rkey, current_value, is_custom, name, max_value, recharge FROM character_resources WHERE character_id = ?', [$params['id']]);
                $current = $state['resources'] ?? [];
                if ($state === null) {
                    foreach ($existing as $e) {
                        $current[$e['rkey']] = (int) $e['current_value'];
                    }
                }
                $customList = $custom ?? array_values(array_map(
                    static fn (array $e): array => ['key' => $e['rkey'], 'name' => (string) $e['name'], 'max' => (int) $e['max_value'], 'recharge' => (string) $e['recharge']],
                    array_filter($existing, static fn (array $e): bool => (bool) $e['is_custom']),
                ));
                Sheets::saveResources($params['id'], $current, $customList);
            }
        });
        return Response::json(['character' => self::loadFull($params['id'], $role === 'dm')]);
    }

    /**
     * Rychlé úpravy stavu (HP, sloty, zdroje, ...) jako změny o hodnotu (delta). Díky tomu se souběžné změny hráče a DM
     * nepřepisují: server čte a zapisuje v jedné transakci. Max hodnoty posílá klient (server pravidla nepočítá).
     * @param array{id:string} $user
     */
    public static function adjust(Request $req, array $params, array $user): array
    {
        [$row, $role] = self::loadForMember($params['id'], $user);
        if ($row['owner_id'] !== $user['id'] && $role !== 'dm') {
            throw HttpError::forbidden('Cizí postavu nemůžeš upravovat.');
        }
        $ops = $req->json()['ops'] ?? null;
        if (!is_array($ops) || $ops === [] || count($ops) > 20) {
            throw HttpError::validation('Pošli 1 až 20 operací v poli ops.', 'ops');
        }

        $recharged = [];
        $touched = [];
        Db::transaction(static function () use ($params, $ops, &$recharged, &$touched): void {
            $recharged = [];
            $touched = [];
            $r = Db::one('SELECT * FROM characters WHERE id = ? FOR UPDATE', [$params['id']]) ?? throw HttpError::notFound();
            $hp = $r['hp_current'] === null ? null : (int) $r['hp_current'];
            $temp = (int) $r['hp_temp'];
            $slots = Sheets::json($r['slots_used'], []);
            $slots = is_array($slots) ? $slots : [];
            $dice = Sheets::json($r['hit_dice_used'], []);
            $dice = is_array($dice) ? $dice : [];
            $conditions = Sheets::json($r['conditions'], []);
            $conditions = is_array($conditions) ? $conditions : [];
            $pact = (int) $r['pact_slots_used'];
            $ds = (int) $r['death_successes'];
            $df = (int) $r['death_failures'];
            $insp = (int) $r['inspiration'];
            $concentration = $r['concentration'] ?? null;
            $resources = [];

            $intField = static function (array $op, string $f, int $min, int $max): int {
                $v = $op[$f] ?? null;
                if (!is_int($v) || $v < $min || $v > $max) {
                    throw HttpError::validation("Neplatná hodnota: $f.", 'ops');
                }
                return $v;
            };

            foreach ($ops as $op) {
                if (!is_array($op) || !isset($op['op']) || !is_string($op['op'])) {
                    throw HttpError::validation('Neplatná operace.', 'ops');
                }
                switch ($op['op']) {
                    case 'hp':
                        $delta = $intField($op, 'delta', -100000, 100000);
                        $max = $intField($op, 'max', 1, 100000);
                        ['hp' => $hp, 'temp' => $temp] = Sheets::applyHp($hp, $temp, $delta, $max);
                        break;
                    case 'tempHp':
                        $temp = $intField($op, 'set', 0, 100000);
                        break;
                    case 'slot':
                        $level = (string) $intField($op, 'level', 1, 9);
                        $slots[$level] = max(0, min($intField($op, 'max', 0, 20), (int) ($slots[$level] ?? 0) + $intField($op, 'delta', -20, 20)));
                        break;
                    case 'pact':
                        $pact = max(0, min($intField($op, 'max', 0, 20), $pact + $intField($op, 'delta', -20, 20)));
                        break;
                    case 'hitDie':
                        $die = $op['die'] ?? null;
                        if (!is_string($die) || preg_match('/^d(4|6|8|10|12|20)$/', $die) !== 1) {
                            throw HttpError::validation('Neplatná kostka.', 'ops');
                        }
                        $dice[$die] = max(0, min($intField($op, 'max', 0, 20), (int) ($dice[$die] ?? 0) + $intField($op, 'delta', -20, 20)));
                        break;
                    case 'resource':
                        $key = $op['key'] ?? null;
                        if (!is_string($key) || preg_match('/^[a-zA-Z0-9._-]{1,80}$/', $key) !== 1) {
                            throw HttpError::validation('Neplatný klíč zdroje.', 'ops');
                        }
                        $cur = Db::value('SELECT current_value FROM character_resources WHERE character_id = ? AND rkey = ?', [$params['id'], $key]);
                        $max = $intField($op, 'max', 0, 100000);
                        $resources[$key] = max(0, min($max, ($cur === null ? $max : (int) $cur) + $intField($op, 'delta', -100000, 100000)));
                        Db::exec(
                            'INSERT INTO character_resources (character_id, rkey, current_value, is_custom) VALUES (?, ?, ?, 0)
                             ON DUPLICATE KEY UPDATE current_value = VALUES(current_value)',
                            [$params['id'], $key, $resources[$key]],
                        );
                        break;
                    case 'deathSave':
                        $delta = $intField($op, 'delta', -3, 3);
                        if (($op['kind'] ?? null) === 'success') {
                            $ds = max(0, min(3, $ds + $delta));
                        } elseif (($op['kind'] ?? null) === 'failure') {
                            $df = max(0, min(3, $df + $delta));
                        } else {
                            throw HttpError::validation("Death save musí být 'success' nebo 'failure'.", 'ops');
                        }
                        break;
                    case 'item':
                        // Spotřeba nebo doplnění kusů (šípy, lektvary): množství se drží v mezích 0 až 9999.
                        $itemId = is_string($op['itemId'] ?? null) ? $op['itemId'] : '';
                        $qty = Ids::isUuid($itemId) ? Db::value('SELECT quantity FROM character_items WHERE id = ? AND character_id = ? FOR UPDATE', [$itemId, $params['id']]) : null;
                        if ($qty === null) {
                            throw HttpError::notFound('Item nenalezen.');
                        }
                        Db::exec(
                            'UPDATE character_items SET quantity = ?, updated_at = UTC_TIMESTAMP() WHERE id = ?',
                            [max(0, min(9999, (int) $qty + $intField($op, 'delta', -9999, 9999))), $itemId],
                        );
                        break;
                    case 'charges':
                    case 'recharge':
                        // Náboje itemu (Wand of Wonder): delta záporná = utracené, kladná = vrácené; recharge = obnova podle itemu (kostky nebo všechny).
                        $itemId = is_string($op['itemId'] ?? null) ? $op['itemId'] : '';
                        $it = Ids::isUuid($itemId) ? Db::one('SELECT name, charges_max, charges_used, charges_recharge FROM character_items WHERE id = ? AND character_id = ? FOR UPDATE', [$itemId, $params['id']]) : null;
                        if ($it === null) {
                            throw HttpError::notFound('Item nenalezen.');
                        }
                        if ($it['charges_max'] === null) {
                            throw HttpError::validation('Item nemá náboje.', 'ops');
                        }
                        $max = (int) $it['charges_max'];
                        $used = min($max, (int) $it['charges_used']);
                        if ($op['op'] === 'charges') {
                            $used = max(0, min($max, $used - $intField($op, 'delta', -100, 100)));
                        } else {
                            if ($it['charges_recharge'] === null) {
                                throw HttpError::validation('Item se sám nedobíjí, náboje uprav ručně.', 'ops');
                            }
                            $expr = (string) $it['charges_recharge'];
                            $rolled = $expr === 'all' ? null : (ctype_digit($expr) ? (int) $expr : (int) Dice::roll(Dice::parse($expr))['total']);
                            $gained = $rolled === null ? $used : min($used, max(0, $rolled));
                            $used -= $gained;
                            $recharged[] = ['itemId' => $itemId, 'name' => (string) $it['name'], 'expression' => $expr, 'rolled' => $rolled, 'gained' => $gained];
                        }
                        Db::exec('UPDATE character_items SET charges_used = ?, updated_at = UTC_TIMESTAMP() WHERE id = ?', [$used, $itemId]);
                        $touched[$itemId] = true;
                        break;
                    case 'inspiration':
                        $insp = ($op['set'] ?? null) === true ? 1 : 0;
                        break;
                    case 'concentration':
                        $set = $op['set'] ?? null;
                        if ($set !== null && (!is_string($set) || mb_strlen($set) > 200)) {
                            throw HttpError::validation('Neplatná koncentrace.', 'ops');
                        }
                        $concentration = $set === '' ? null : $set;
                        break;
                    case 'condition':
                        $name = $op['name'] ?? null;
                        if (!is_string($name) || $name === '' || mb_strlen($name) > 40) {
                            throw HttpError::validation('Neplatný stav (condition).', 'ops');
                        }
                        [$conditions] = Sheets::toggleCondition($conditions, $name, ($op['set'] ?? null) === true);
                        break;
                    default:
                        throw HttpError::validation('Neznámá operace: ' . $op['op'], 'ops');
                }
            }

            Db::exec(
                'UPDATE characters SET hp_current = ?, hp_temp = ?, slots_used = ?, hit_dice_used = ?, conditions = ?, pact_slots_used = ?,
                    death_successes = ?, death_failures = ?, inspiration = ?, concentration = ?, updated_at = UTC_TIMESTAMP() WHERE id = ?',
                [$hp, $temp, Sheets::enc($slots), Sheets::enc($dice), Sheets::enc($conditions), $pact, $ds, $df, $insp, $concentration, $params['id']],
            );
        });
        $sheet = self::loadFull($params['id'], false);
        $out = ['state' => $sheet['state'], 'inspiration' => $sheet['inspiration']];
        if ($touched !== []) {
            // náboje změněných itemů (klient je přepíše v cache) a výsledek hodu obnovy
            $out['charges'] = [];
            foreach ($sheet['items'] as $item) {
                if (isset($touched[$item['id']])) {
                    $out['charges'][$item['id']] = $item['charges'];
                }
            }
            $out['recharged'] = $recharged;
        }
        return $out;
    }

    /** @param array{id:string} $user */
    public static function delete(Request $req, array $params, array $user): ?array
    {
        [$row, $role] = self::loadForMember($params['id'], $user);
        if ($row['owner_id'] !== $user['id'] && $role !== 'dm') {
            throw HttpError::forbidden('Cizí postavu nemůžeš smazat.');
        }
        Db::transaction(static function () use ($params): void {
            // Záznam v přehledu NPC deníku postavu přežije s jejím posledním jménem a rasou.
            Db::exec('UPDATE journal_npcs n JOIN characters c ON c.id = n.character_id SET n.name = c.name, n.race = c.race WHERE n.character_id = ?', [$params['id']]);
            Db::exec('DELETE FROM characters WHERE id = ?', [$params['id']]);
        });
        Images::delete($row['photo_path'] === null ? null : (string) $row['photo_path']);
        return null;
    }

    // ------------------------------------------------------------------ fotka

    /** Nahraje fotku postavy: ořízne na čtverec 512 px a uloží jako JPEG. @param array{id:string} $user */
    public static function uploadPhoto(Request $req, array $params, array $user): array
    {
        [$row, $role] = self::loadForMember($params['id'], $user);
        if ($row['owner_id'] !== $user['id'] && $role !== 'dm') {
            throw HttpError::forbidden('Fotku cizí postavy nemůžeš měnit.');
        }
        $bytes = Images::squareJpeg($req->file('photo'));
        $path = Images::store('characters', $params['id'] . '-' . bin2hex(random_bytes(4)) . '.jpg', $bytes);
        Db::exec('UPDATE characters SET photo_path = ?, updated_at = UTC_TIMESTAMP() WHERE id = ?', [$path, $params['id']]);
        Images::delete($row['photo_path'] === null ? null : (string) $row['photo_path']);
        return ['photoVersion' => substr(md5($path), 0, 10)];
    }

    /** Fotku vidí každý člen kampaně (patří do veřejného náhledu). @param array{id:string} $user */
    public static function photo(Request $req, array $params, array $user): Response
    {
        [$row] = self::loadForMember($params['id'], $user);
        $path = $row['photo_path'] === null ? null : (string) $row['photo_path'];
        $bytes = $path === null ? null : Images::read($path);
        if ($bytes === null) {
            throw HttpError::notFound('Postava nemá fotku.');
        }
        $etag = '"' . md5($path) . '"';
        $headers = ['ETag' => $etag, 'Cache-Control' => 'private, max-age=604800'];
        if ($req->header('if-none-match') === $etag) {
            return new Response(304, null, null, null, $headers);
        }
        return Response::binary($bytes, 'image/jpeg', $headers);
    }

    /** @param array{id:string} $user */
    public static function deletePhoto(Request $req, array $params, array $user): ?array
    {
        [$row, $role] = self::loadForMember($params['id'], $user);
        if ($row['owner_id'] !== $user['id'] && $role !== 'dm') {
            throw HttpError::forbidden('Fotku cizí postavy nemůžeš měnit.');
        }
        Images::delete($row['photo_path'] === null ? null : (string) $row['photo_path']);
        Db::exec('UPDATE characters SET photo_path = NULL, updated_at = UTC_TIMESTAMP() WHERE id = ?', [$params['id']]);
        return null;
    }

    // ------------------------------------------------------------------ DM poznámky (jen DM)

    /** @param array{id:string} $user */
    public static function notes(Request $req, array $params, array $user): array
    {
        Access::requireDm($user, $params['id']);
        $rows = Db::all(
            'SELECT id, character_id, body, created_at, updated_at FROM dm_notes WHERE campaign_id = ? ORDER BY created_at DESC',
            [$params['id']],
        );
        return ['notes' => array_map([self::class, 'notePayload'], $rows)];
    }

    /** @param array{id:string} $user */
    public static function createNote(Request $req, array $params, array $user): Response
    {
        Access::requireDm($user, $params['id']);
        $data = $req->json();
        $characterId = null;
        if (isset($data['characterId'])) {
            $characterId = is_string($data['characterId']) ? $data['characterId'] : '';
            $exists = Ids::isUuid($characterId)
                && Db::value('SELECT 1 FROM characters WHERE id = ? AND campaign_id = ?', [$characterId, $params['id']]) !== null;
            if (!$exists) {
                throw HttpError::validation('Postava není z této kampaně.', 'characterId');
            }
        }
        $id = Ids::uuid();
        Db::exec(
            'INSERT INTO dm_notes (id, campaign_id, character_id, author_id, body, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())',
            [$id, $params['id'], $characterId, $user['id'], Input::string($data, 'body', 0, 20000, 'Poznámka')],
        );
        $row = Db::one('SELECT id, character_id, body, created_at, updated_at FROM dm_notes WHERE id = ?', [$id]) ?? [];
        return Response::json(['note' => self::notePayload($row)], 201);
    }

    /** @param array{id:string} $user */
    public static function updateNote(Request $req, array $params, array $user): array
    {
        $note = self::loadNote($params['id'], $user);
        $body = Input::string($req->json(), 'body', 0, 20000, 'Poznámka');
        Db::exec('UPDATE dm_notes SET body = ?, updated_at = UTC_TIMESTAMP() WHERE id = ?', [$body, $note['id']]);
        $row = Db::one('SELECT id, character_id, body, created_at, updated_at FROM dm_notes WHERE id = ?', [$note['id']]) ?? [];
        return ['note' => self::notePayload($row)];
    }

    /** @param array{id:string} $user */
    public static function deleteNote(Request $req, array $params, array $user): ?array
    {
        $note = self::loadNote($params['id'], $user);
        Db::exec('DELETE FROM dm_notes WHERE id = ?', [$note['id']]);
        return null;
    }

    // ------------------------------------------------------------------ pomocné

    /**
     * Načte postavu a ověří, že je volající členem její kampaně (jinak 404).
     * @param array{id:string} $user
     * @return array{0: array<string, mixed>, 1: string}
     */
    private static function loadForMember(string $id, array $user): array
    {
        $row = Ids::isUuid($id) ? self::find($id) : null;
        if ($row === null) {
            throw HttpError::notFound('Postava nenalezena.');
        }
        $role = Access::role($user['id'], (string) $row['campaign_id']);
        if ($role === null) {
            // Cizinec nesmí ani poznat, že postava existuje.
            throw HttpError::notFound('Postava nenalezena.');
        }
        return [$row, $role];
    }

    /**
     * @param array{id:string} $user
     * @return array<string, mixed>
     */
    private static function loadNote(string $id, array $user): array
    {
        $note = Ids::isUuid($id) ? Db::one('SELECT id, campaign_id FROM dm_notes WHERE id = ?', [$id]) : null;
        if ($note === null) {
            throw HttpError::notFound('Poznámka nenalezena.');
        }
        Access::requireDm($user, (string) $note['campaign_id']);
        return $note;
    }

    /** @return array<string, mixed>|null */
    private static function find(string $id): ?array
    {
        return Db::one('SELECT ' . self::COLUMNS . ' FROM characters WHERE id = ?', [$id]);
    }

    /**
     * @param bool $revealCurses jen pro DM: neodhalené kletby na itemech nedostane nikdo jiný (ani majitel itemu)
     * @return array<string, mixed>
     */
    private static function loadFull(string $id, bool $revealCurses): array
    {
        $row = self::find($id) ?? throw HttpError::notFound();
        $sheet = Sheets::loadMany([$row], $revealCurses)[$id] ?? throw HttpError::notFound();
        return self::payload($row, $sheet);
    }

    /** @param array<string, mixed> $row */
    private static function hasFullAccess(array $row, string $userId, string $role): bool
    {
        return $role === 'dm' || $row['owner_id'] === $userId || $row['visibility'] === 'full';
    }

    /** @param array<string, mixed> $data */
    private static function visibility(array $data): string
    {
        $value = $data['visibility'] ?? null;
        if ($value !== 'public_only' && $value !== 'full') {
            throw HttpError::validation("Viditelnost musí být 'public_only' nebo 'full'.", 'visibility');
        }
        return $value;
    }

    /**
     * Veřejný náhled obsahuje jen jméno, fotku, rasu, třídu a level. Soukromá pole se do odpovědi vůbec nedostanou
     * (ne že by je jen skrylo UI).
     * @param array<string, mixed> $r
     * @param array<string, mixed>|null $sheet  kompletní sheet, pokud má volající plný přístup
     * @return array<string, mixed>
     */
    private static function payload(array $r, ?array $sheet): array
    {
        $public = [
            'id' => $r['id'],
            'campaignId' => $r['campaign_id'],
            'ownerId' => $r['owner_id'],
            'kind' => $r['kind'],
            'name' => $r['name'],
            'race' => $r['race'],
            'classSummary' => $r['class_summary'],
            'level' => (int) $r['level'],
            'photoVersion' => $r['photo_path'] === null ? null : substr(md5((string) $r['photo_path']), 0, 10),
            'access' => $sheet === null ? 'public' : 'full',
        ];
        if ($sheet === null) {
            return $public;
        }
        return $public + $sheet;
    }

    /**
     * @param array<string, mixed> $r
     * @return array<string, mixed>
     */
    private static function notePayload(array $r): array
    {
        return [
            'id' => $r['id'],
            'characterId' => $r['character_id'],
            'body' => $r['body'],
            'createdAt' => Ids::iso((string) $r['created_at']),
            'updatedAt' => Ids::iso((string) $r['updated_at']),
        ];
    }
}
