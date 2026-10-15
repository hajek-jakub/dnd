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
 * Deník kampaně: zápisy podle témat.
 *  - DM zakládá zápisy pro všechny (all), vybrané hráče (selected) nebo jen pro sebe (dm) a může je připnout,
 *  - hráč smí psát jen vlastní soukromé zápisy (owner), které nevidí nikdo jiný, ani DM,
 *  - upravit nebo smazat zápis smí autor, DM jen zápisy, které sám vidí (cizí soukromé zápisy mu připadají jako 404).
 * Stejná pravidla viditelnosti jako u bodů na mapě.
 */
final class JournalController
{
    private const MAX_ENTRIES = 500;

    /** @param array{id:string} $user */
    public static function index(Request $req, array $params, array $user): array
    {
        $role = Access::requireMember($user, $params['id']);
        $since = self::lastRead($params['id'], $user['id']);
        $rows = Db::all(
            'SELECT e.*, u.display_name AS author_name FROM journal_entries e JOIN users u ON u.id = e.created_by
             WHERE e.campaign_id = ? AND ' . self::visibleSql() . ' ORDER BY e.pinned DESC, e.updated_at DESC, e.created_at DESC',
            [$params['id'], ...self::visibleArgs($user['id'], $role)],
        );
        $entries = self::payloads($rows, $user['id'], $role, $since);
        return ['entries' => $entries, 'unread' => count(array_filter($entries, static fn (array $e): bool => $e['isNew']))];
    }

    /** @param array{id:string} $user */
    public static function create(Request $req, array $params, array $user): Response
    {
        $role = Access::requireMember($user, $params['id']);
        if ((int) Db::value('SELECT COUNT(*) FROM journal_entries WHERE campaign_id = ?', [$params['id']]) >= self::MAX_ENTRIES) {
            throw HttpError::validation('V deníku může být nejvýš ' . self::MAX_ENTRIES . ' zápisů.', 'title');
        }
        $data = $req->json();
        $fields = self::fields($data, true);
        $visibility = $data['visibility'] ?? ($role === 'dm' ? 'all' : 'owner');
        $viewers = self::checkVisibility($visibility, $data, $role, $params['id']);
        $pinned = self::pinned($data, $role);

        $id = Ids::uuid();
        Db::transaction(static function () use ($id, $params, $user, $fields, $visibility, $viewers, $pinned): void {
            Db::exec(
                'INSERT INTO journal_entries (id, campaign_id, topic, title, body, visibility, pinned, created_by, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())',
                [$id, $params['id'], $fields['topic'], $fields['title'], $fields['body'], $visibility, $pinned ?? 0, $user['id']],
            );
            foreach ($viewers as $v) {
                Db::exec('INSERT INTO journal_viewers (entry_id, user_id) VALUES (?, ?)', [$id, $v]);
            }
        });
        // Autor vlastní zápis nikdy nemá jako nový.
        return Response::json(['entry' => self::one($id, $user['id'], $role, null)], 201);
    }

    /** @param array{id:string} $user */
    public static function update(Request $req, array $params, array $user): array
    {
        [$entry, $role] = self::loadEntry($params['id'], $user);
        $data = $req->json();
        $fields = self::fields($data, false);

        $sets = [];
        $values = [];
        foreach (['topic', 'title', 'body'] as $k) {
            if (array_key_exists($k, $fields)) {
                $sets[] = "$k = ?";
                $values[] = $fields[$k];
            }
        }
        $pinned = self::pinned($data, $role);
        if ($pinned !== null) {
            $sets[] = 'pinned = ?';
            $values[] = $pinned;
        }
        $viewers = null;
        if (array_key_exists('visibility', $data) || array_key_exists('viewerIds', $data)) {
            $visibility = $data['visibility'] ?? $entry['visibility'];
            if ($entry['visibility'] === 'owner' && $visibility !== 'owner') {
                throw HttpError::forbidden('Soukromý zápis nejde zveřejnit.');
            }
            $viewers = self::checkVisibility($visibility, $data + ['viewerIds' => self::viewerIds((string) $entry['id'])], $role, (string) $entry['campaign_id']);
            $sets[] = 'visibility = ?';
            $values[] = $visibility;
        }
        Db::transaction(static function () use ($entry, $sets, $values, $viewers): void {
            if ($sets !== []) {
                $sets[] = 'updated_at = UTC_TIMESTAMP()';
                $values[] = $entry['id'];
                Db::exec('UPDATE journal_entries SET ' . implode(', ', $sets) . ' WHERE id = ?', $values);
            }
            if ($viewers !== null) {
                Db::exec('DELETE FROM journal_viewers WHERE entry_id = ?', [$entry['id']]);
                foreach ($viewers as $v) {
                    Db::exec('INSERT INTO journal_viewers (entry_id, user_id) VALUES (?, ?)', [$entry['id'], $v]);
                }
            }
        });
        return ['entry' => self::one((string) $entry['id'], $user['id'], $role, null)];
    }

    /** @param array{id:string} $user */
    public static function delete(Request $req, array $params, array $user): ?array
    {
        [$entry] = self::loadEntry($params['id'], $user);
        Db::exec('DELETE FROM journal_entries WHERE id = ?', [$entry['id']]);
        return null;
    }

    /** Uživatel deník otevřel: všechno, co v něm je, už viděl. @param array{id:string} $user */
    public static function markRead(Request $req, array $params, array $user): array
    {
        Access::requireMember($user, $params['id']);
        Db::exec(
            'INSERT INTO journal_reads (campaign_id, user_id, last_read_at) VALUES (?, ?, UTC_TIMESTAMP())
             ON DUPLICATE KEY UPDATE last_read_at = UTC_TIMESTAMP()',
            [$params['id'], $user['id']],
        );
        return ['unread' => 0];
    }

    /** Počet nových zápisů ve všech kampaních uživatele (odznak v dolní liště). @param array{id:string} $user */
    public static function unreadOverview(Request $req, array $params, array $user): array
    {
        $rows = Db::all(
            "SELECT e.campaign_id, c.name, COUNT(*) AS n, cm.role
             FROM journal_entries e
             JOIN campaign_members cm ON cm.campaign_id = e.campaign_id AND cm.user_id = ?
             JOIN campaigns c ON c.id = e.campaign_id
             LEFT JOIN journal_reads r ON r.campaign_id = e.campaign_id AND r.user_id = ?
             WHERE e.created_by <> ? AND GREATEST(e.created_at, e.updated_at) > COALESCE(r.last_read_at, cm.joined_at)
               AND (e.visibility = 'all' OR (cm.role = 'dm' AND e.visibility IN ('dm', 'selected'))
                    OR (e.visibility = 'selected' AND EXISTS (SELECT 1 FROM journal_viewers v WHERE v.entry_id = e.id AND v.user_id = ?)))
             GROUP BY e.campaign_id, c.name, cm.role ORDER BY c.name",
            [$user['id'], $user['id'], $user['id'], $user['id']],
        );
        $campaigns = array_map(static fn (array $r): array => ['campaignId' => $r['campaign_id'], 'name' => $r['name'], 'unread' => (int) $r['n']], $rows);
        return ['total' => array_sum(array_column($campaigns, 'unread')), 'campaigns' => $campaigns];
    }

    // ------------------------------------------------------------------ pomocné

    private static function visibleSql(): string
    {
        return "(e.visibility = 'all' OR e.created_by = ? OR (? = 'dm' AND e.visibility IN ('dm', 'selected'))
                 OR (e.visibility = 'selected' AND EXISTS (SELECT 1 FROM journal_viewers v WHERE v.entry_id = e.id AND v.user_id = ?)))";
    }

    /** @return list<string> */
    private static function visibleArgs(string $userId, string $role): array
    {
        return [$userId, $role, $userId];
    }

    /** Kdy uživatel deník naposledy otevřel (jinak od vstupu do kampaně). */
    private static function lastRead(string $campaignId, string $userId): string
    {
        return (string) (Db::value('SELECT last_read_at FROM journal_reads WHERE campaign_id = ? AND user_id = ?', [$campaignId, $userId])
            ?? Db::value('SELECT joined_at FROM campaign_members WHERE campaign_id = ? AND user_id = ?', [$campaignId, $userId])
            ?? '1970-01-01 00:00:00');
    }

    /**
     * Načte zápis, který uživatel smí vidět (jinak 404), a ověří, že ho smí měnit (jinak 403).
     * @param array{id:string} $user
     * @return array{0: array<string, mixed>, 1: string}
     */
    private static function loadEntry(string $id, array $user): array
    {
        $entry = Ids::isUuid($id) ? Db::one('SELECT * FROM journal_entries WHERE id = ?', [$id]) : null;
        $role = $entry === null ? null : Access::role($user['id'], (string) $entry['campaign_id']);
        if ($entry === null || $role === null) {
            throw HttpError::notFound('Zápis nenalezen.');
        }
        $visible = Db::value('SELECT 1 FROM journal_entries e WHERE e.id = ? AND ' . self::visibleSql(), [$id, ...self::visibleArgs($user['id'], $role)]);
        if ($visible === null) {
            throw HttpError::notFound('Zápis nenalezen.');
        }
        if ($entry['created_by'] !== $user['id'] && $role !== 'dm') {
            throw HttpError::forbidden('Cizí zápis nemůžeš měnit.');
        }
        return [$entry, $role];
    }

    /**
     * @param array<string, mixed> $in
     * @return array<string, string>
     */
    private static function fields(array $in, bool $create): array
    {
        $out = [];
        if ($create || array_key_exists('topic', $in)) {
            $out['topic'] = array_key_exists('topic', $in) ? Input::string($in, 'topic', 1, 60, 'Téma') : 'Obecné';
        }
        if ($create || array_key_exists('title', $in)) {
            $out['title'] = Input::string($in, 'title', 1, 120, 'Nadpis');
        }
        if ($create || array_key_exists('body', $in)) {
            $out['body'] = array_key_exists('body', $in) ? Input::string($in, 'body', 0, 20000, 'Text') : '';
        }
        return $out;
    }

    /** @param array<string, mixed> $data */
    private static function pinned(array $data, string $role): ?int
    {
        if (!array_key_exists('pinned', $data)) {
            return null;
        }
        if (!is_bool($data['pinned'])) {
            throw HttpError::validation('pinned musí být true/false.', 'pinned');
        }
        if ($role !== 'dm') {
            throw HttpError::forbidden('Zápisy připíná jen DM.');
        }
        return $data['pinned'] ? 1 : 0;
    }

    /**
     * @param array<string, mixed> $data
     * @return list<string>
     */
    private static function checkVisibility(mixed $visibility, array $data, string $role, string $campaignId): array
    {
        if (!is_string($visibility) || !in_array($visibility, ['all', 'selected', 'dm', 'owner'], true)) {
            throw HttpError::validation('Neplatná viditelnost.', 'visibility');
        }
        if ($role !== 'dm') {
            if ($visibility !== 'owner') {
                throw HttpError::forbidden('Hráč může psát jen soukromé zápisy, které uvidí jen on.');
            }
            return [];
        }
        if ($visibility === 'owner') {
            throw HttpError::validation("Soukromé zápisy (owner) jsou jen pro hráče. DM použije 'dm'.", 'visibility');
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
    private static function viewerIds(string $entryId): array
    {
        return array_map('strval', array_column(Db::all('SELECT user_id FROM journal_viewers WHERE entry_id = ?', [$entryId]), 'user_id'));
    }

    /** @return array<string, mixed> */
    private static function one(string $id, string $userId, string $role, ?string $since): array
    {
        $row = Db::one('SELECT e.*, u.display_name AS author_name FROM journal_entries e JOIN users u ON u.id = e.created_by WHERE e.id = ?', [$id]) ?? [];
        return self::payloads([$row], $userId, $role, $since)[0];
    }

    /**
     * @param list<array<string, mixed>> $rows
     * @return list<array<string, mixed>>
     */
    private static function payloads(array $rows, string $userId, string $role, ?string $since): array
    {
        $viewers = [];
        $ids = array_values(array_map(static fn (array $r): string => (string) $r['id'], array_filter($rows, static fn (array $r): bool => $r['visibility'] === 'selected')));
        if ($ids !== []) {
            $in = implode(',', array_fill(0, count($ids), '?'));
            foreach (Db::all("SELECT entry_id, user_id FROM journal_viewers WHERE entry_id IN ($in)", $ids) as $v) {
                $viewers[$v['entry_id']][] = $v['user_id'];
            }
        }
        return array_map(static function (array $r) use ($userId, $role, $since, $viewers): array {
            $mine = $r['created_by'] === $userId;
            $changed = max((string) $r['created_at'], (string) $r['updated_at']);
            $out = [
                'id' => $r['id'],
                'topic' => $r['topic'],
                'title' => $r['title'],
                'body' => $r['body'],
                'visibility' => $r['visibility'],
                'pinned' => (bool) $r['pinned'],
                'createdBy' => $r['created_by'],
                'createdByName' => $r['author_name'],
                'mine' => $mine,
                'canEdit' => $mine || $role === 'dm',
                'isNew' => !$mine && $since !== null && $changed > $since,
                'createdAt' => Ids::iso((string) $r['created_at']),
                'updatedAt' => Ids::iso((string) $r['updated_at']),
            ];
            if ($r['visibility'] === 'selected' && ($mine || $role === 'dm')) {
                $out['viewerIds'] = $viewers[$r['id']] ?? [];
            }
            return $out;
        }, $rows);
    }
}
