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
 * Postavy a DM poznámky.
 * Pravidla viditelnosti postavy:
 *  - majitel a DM vidí vše,
 *  - ostatní členové kampaně vidí jen veřejný náhled (jméno, fotka, rasa, třída, level),
 *    pokud DM nenastaví visibility = 'full'.
 */
final class CharacterController
{
    private const FULL_COLUMNS = 'id, campaign_id, owner_id, name, race, class_summary, level, photo_path, notes, visibility, created_at, updated_at';

    /** @param array{id:string} $user */
    public static function index(Request $req, array $params, array $user): array
    {
        $role = Access::requireMember($user, $params['id']);
        $rows = Db::all('SELECT ' . self::FULL_COLUMNS . ' FROM characters WHERE campaign_id = ? ORDER BY created_at', [$params['id']]);
        return ['characters' => array_map(
            static fn (array $r): array => self::payload($r, self::hasFullAccess($r, $user['id'], $role)),
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

        $id = Ids::uuid();
        Db::exec(
            'INSERT INTO characters (id, campaign_id, owner_id, name, race, class_summary, level, photo_path, notes, visibility, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())',
            [
                $id,
                $params['id'],
                $ownerId,
                Input::string($data, 'name', 1, 100, 'Jméno postavy'),
                Input::optionalString($data, 'race', 100, 'Rasa') ?? '',
                Input::optionalString($data, 'classSummary', 200, 'Třída') ?? '',
                Input::optionalInt($data, 'level', 1, 20, 'Level') ?? 1,
                Input::optionalString($data, 'notes', 20000, 'Poznámky') ?? '',
                $visibility,
            ],
        );
        $row = self::find($id) ?? throw HttpError::notFound();
        return Response::json(['character' => self::payload($row, true)], 201);
    }

    /** @param array{id:string} $user */
    public static function show(Request $req, array $params, array $user): array
    {
        [$row, $role] = self::loadForMember($params['id'], $user);
        if (!self::hasFullAccess($row, $user['id'], $role)) {
            throw HttpError::forbidden('Tuto postavu vidíš jen v omezeném náhledu.');
        }
        return ['character' => self::payload($row, true)];
    }

    /** @param array{id:string} $user */
    public static function update(Request $req, array $params, array $user): array
    {
        [$row, $role] = self::loadForMember($params['id'], $user);
        if ($row['owner_id'] !== $user['id'] && $role !== 'dm') {
            throw HttpError::forbidden('Cizí postavu nemůžeš upravovat.');
        }
        $data = $req->json();

        $sets = [];
        $values = [];
        if (array_key_exists('name', $data)) {
            $sets[] = 'name = ?';
            $values[] = Input::string($data, 'name', 1, 100, 'Jméno postavy');
        }
        if (array_key_exists('race', $data)) {
            $sets[] = 'race = ?';
            $values[] = Input::string($data, 'race', 0, 100, 'Rasa');
        }
        if (array_key_exists('classSummary', $data)) {
            $sets[] = 'class_summary = ?';
            $values[] = Input::string($data, 'classSummary', 0, 200, 'Třída');
        }
        if (array_key_exists('level', $data)) {
            $sets[] = 'level = ?';
            $values[] = Input::optionalInt($data, 'level', 1, 20, 'Level') ?? throw HttpError::validation('Level je povinný.', 'level');
        }
        if (array_key_exists('notes', $data)) {
            $sets[] = 'notes = ?';
            $values[] = Input::string($data, 'notes', 0, 20000, 'Poznámky');
        }
        // Majitele a viditelnost smí měnit jen DM (hráč nesmí ani sám sobě povolit víc).
        if (array_key_exists('visibility', $data)) {
            if ($role !== 'dm') {
                throw HttpError::forbidden('Viditelnost postavy může změnit jen DM.');
            }
            $sets[] = 'visibility = ?';
            $values[] = self::visibility($data);
        }
        if (array_key_exists('ownerId', $data) && $data['ownerId'] !== $row['owner_id']) {
            if ($role !== 'dm') {
                throw HttpError::forbidden('Majitele postavy může změnit jen DM.');
            }
            $owner = is_string($data['ownerId']) ? $data['ownerId'] : '';
            if (!Ids::isUuid($owner) || !Access::isMember($owner, (string) $row['campaign_id'])) {
                throw HttpError::validation('Majitel musí být členem kampaně.', 'ownerId');
            }
            $sets[] = 'owner_id = ?';
            $values[] = $owner;
        }
        // Kampaň postavy se nikdy nemění (campaignId v těle se ignoruje).

        if ($sets !== []) {
            $sets[] = 'updated_at = UTC_TIMESTAMP()';
            $values[] = $params['id'];
            Db::exec('UPDATE characters SET ' . implode(', ', $sets) . ' WHERE id = ?', $values);
        }
        $fresh = self::find($params['id']) ?? throw HttpError::notFound();
        return ['character' => self::payload($fresh, true)];
    }

    /** @param array{id:string} $user */
    public static function delete(Request $req, array $params, array $user): ?array
    {
        [$row, $role] = self::loadForMember($params['id'], $user);
        if ($row['owner_id'] !== $user['id'] && $role !== 'dm') {
            throw HttpError::forbidden('Cizí postavu nemůžeš smazat.');
        }
        Db::exec('DELETE FROM characters WHERE id = ?', [$params['id']]);
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
        return Db::one('SELECT ' . self::FULL_COLUMNS . ' FROM characters WHERE id = ?', [$id]);
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
     * Veřejný náhled obsahuje jen jméno, fotku, rasu, třídu a level. Soukromá pole se do
     * odpovědi vůbec nedostanou (ne že by je jen skrylo UI).
     * @param array<string, mixed> $r
     * @return array<string, mixed>
     */
    private static function payload(array $r, bool $full): array
    {
        $public = [
            'id' => $r['id'],
            'campaignId' => $r['campaign_id'],
            'ownerId' => $r['owner_id'],
            'name' => $r['name'],
            'race' => $r['race'],
            'classSummary' => $r['class_summary'],
            'level' => (int) $r['level'],
            'photoPath' => $r['photo_path'],
            'access' => $full ? 'full' : 'public',
        ];
        if (!$full) {
            return $public;
        }
        return $public + [
            'notes' => $r['notes'],
            'visibility' => $r['visibility'],
            'createdAt' => Ids::iso((string) $r['created_at']),
            'updatedAt' => Ids::iso((string) $r['updated_at']),
        ];
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
