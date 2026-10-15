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
        $sheets = Sheets::loadMany($full);
        return ['characters' => array_map(
            static fn (array $r): array => self::payload($r, $sheets[(string) $r['id']] ?? null),
            $rows,
        )];
    }

    /** @param array{id:string} $user */
    public static function create(Request $req, array $params, array $user): Response
    {
        $role = Access::requireMember($user, $params['id']);
        $data = $req->json();

        $ownerId = $user['id'];
        if (array_key_exists('ownerId', $data)) {
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
        // XP: chybí = 0, výslovné null = "nedoplněno" (NULL v DB)
        $xp = array_key_exists('xp', $data) ? Input::optionalInt($data, 'xp', 0, 10000000, 'XP') : 0;

        $id = Ids::uuid();
        Db::transaction(static function () use ($id, $params, $ownerId, $name, $data, $scores, $lv, $state, $visibility, $baseSpeed, $xp): void {
            Db::exec(
                'INSERT INTO characters (id, campaign_id, owner_id, name, race, subrace, background, alignment, class_summary, level, notes, visibility,
                    abil_str, abil_dex, abil_con, abil_int, abil_wis, abil_cha, base_speed, hp_current, hp_temp, skill_proficiencies,
                    extra_save_proficiencies, extra_proficiencies, subclasses, personality, description, xp, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, \'\', 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())',
                [
                    $id, $params['id'], $ownerId, $name,
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
                    Sheets::enc(Sheets::stringList($data, 'extraProficiencies')),
                    Sheets::enc($lv['subclasses']),
                    Sheets::enc(Sheets::personality($data)),
                    Input::optionalString($data, 'description', 20000, 'Popis') ?? '',
                    $xp,
                ],
            );
            Sheets::saveLevels($id, $lv['levels']);
        });
        return Response::json(['character' => self::loadFull($id)], 201);
    }

    /** @param array{id:string} $user */
    public static function show(Request $req, array $params, array $user): array
    {
        [$row, $role] = self::loadForMember($params['id'], $user);
        if (!self::hasFullAccess($row, $user['id'], $role)) {
            throw HttpError::forbidden('Tuto postavu vidíš jen v omezeném náhledu.');
        }
        return ['character' => self::loadFull($params['id'])];
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
                'current' => self::loadFull($params['id']),
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
        if (array_key_exists('xp', $data)) {
            $set('xp', Input::optionalInt($data, 'xp', 0, 10000000, 'XP')); // null = nedoplněno
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
            $set('extra_proficiencies', Sheets::enc(Sheets::stringList($data, 'extraProficiencies')));
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
        return Response::json(['character' => self::loadFull($params['id'])]);
    }

    /**
     * Rychlé úpravy stavu (HP, sloty, zdroje, XP, ...) jako změny o hodnotu (delta). Díky tomu se souběžné změny hráče a DM
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

        Db::transaction(static function () use ($params, $ops): void {
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
            $xp = $r['xp'] === null ? null : (int) $r['xp']; // NULL = nedoplněno; zůstane, dokud se XP výslovně nezmění
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
                    case 'xp':
                        $xp = max(0, min(10000000, ($xp ?? 0) + $intField($op, 'delta', -10000000, 10000000)));
                        break;
                    case 'condition':
                        $name = $op['name'] ?? null;
                        if (!is_string($name) || $name === '' || mb_strlen($name) > 40) {
                            throw HttpError::validation('Neplatný stav (condition).', 'ops');
                        }
                        $conditions = array_values(array_diff($conditions, [$name]));
                        if (($op['set'] ?? null) === true) {
                            $conditions[] = $name;
                        }
                        break;
                    default:
                        throw HttpError::validation('Neznámá operace: ' . $op['op'], 'ops');
                }
            }

            Db::exec(
                'UPDATE characters SET hp_current = ?, hp_temp = ?, slots_used = ?, hit_dice_used = ?, conditions = ?, pact_slots_used = ?,
                    death_successes = ?, death_failures = ?, xp = ?, inspiration = ?, concentration = ?, updated_at = UTC_TIMESTAMP() WHERE id = ?',
                [$hp, $temp, Sheets::enc($slots), Sheets::enc($dice), Sheets::enc($conditions), $pact, $ds, $df, $xp, $insp, $concentration, $params['id']],
            );
        });
        $sheet = self::loadFull($params['id']);
        return ['state' => $sheet['state'], 'xp' => $sheet['xp'], 'inspiration' => $sheet['inspiration']];
    }

    /** @param array{id:string} $user */
    public static function delete(Request $req, array $params, array $user): ?array
    {
        [$row, $role] = self::loadForMember($params['id'], $user);
        if ($row['owner_id'] !== $user['id'] && $role !== 'dm') {
            throw HttpError::forbidden('Cizí postavu nemůžeš smazat.');
        }
        Db::exec('DELETE FROM characters WHERE id = ?', [$params['id']]);
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

    /** @return array<string, mixed> */
    private static function loadFull(string $id): array
    {
        $row = self::find($id) ?? throw HttpError::notFound();
        $sheet = Sheets::loadMany([$row])[$id] ?? throw HttpError::notFound();
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
