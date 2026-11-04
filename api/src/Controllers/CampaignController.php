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
use Dnd\Invites;
use Dnd\RateLimiter;
use Dnd\Request;
use Dnd\Response;
use Dnd\Sessions;

final class CampaignController
{
    /** @param array{id:string} $user */
    public static function index(Request $req, array $params, array $user): array
    {
        $rows = Db::all(
            'SELECT c.id, c.name, c.description, m.role
             FROM campaign_members m JOIN campaigns c ON c.id = m.campaign_id
             WHERE m.user_id = ? ORDER BY c.created_at DESC',
            [$user['id']],
        );
        // Doplňky pro výběr kampaně: jeden dotaz na tabulku pro všechny kampaně uživatele, ne zvlášť pro každou.
        $characters = [];
        foreach (Db::all(
            "SELECT ch.id, ch.campaign_id, ch.name, ch.photo_path FROM characters ch
             JOIN campaign_members m ON m.campaign_id = ch.campaign_id AND m.user_id = ?
             WHERE ch.owner_id = ? AND ch.kind = 'pc' ORDER BY ch.created_at, ch.id",
            [$user['id'], $user['id']],
        ) as $c) {
            $characters[(string) $c['campaign_id']] ??= [
                'id' => $c['id'],
                'name' => $c['name'],
                'photoVersion' => $c['photo_path'] === null ? null : substr(md5((string) $c['photo_path']), 0, 10),
            ];
        }
        $sessions = [];
        foreach (Db::all(
            'SELECT s.campaign_id, s.session_date, s.session_time FROM game_sessions s
             JOIN campaign_members m ON m.campaign_id = s.campaign_id AND m.user_id = ?
             WHERE s.session_date >= ? ORDER BY s.session_date',
            [$user['id'], Sessions::today()],
        ) as $s) {
            $sessions[(string) $s['campaign_id']] ??= ['date' => (string) $s['session_date'], 'time' => $s['session_time']];
        }
        $counts = [];
        foreach (Db::all(
            'SELECT o.campaign_id, COUNT(*) AS n FROM campaign_members o
             JOIN campaign_members m ON m.campaign_id = o.campaign_id AND m.user_id = ?
             GROUP BY o.campaign_id',
            [$user['id']],
        ) as $n) {
            $counts[(string) $n['campaign_id']] = (int) $n['n'];
        }
        return ['campaigns' => array_map(static fn (array $r): array => [
            'id' => $r['id'],
            'name' => $r['name'],
            'description' => $r['description'],
            'role' => $r['role'],
            'myCharacter' => $characters[(string) $r['id']] ?? null,
            'nextSession' => $sessions[(string) $r['id']] ?? null,
            'memberCount' => $counts[(string) $r['id']] ?? 1,
        ], $rows)];
    }

    /** @param array{id:string} $user */
    public static function create(Request $req, array $params, array $user): Response
    {
        $data = $req->json();
        $name = Input::string($data, 'name', 1, 100, 'Název kampaně');
        $description = Input::optionalString($data, 'description', 2000, 'Popis') ?? '';
        $settings = self::settingsJson(array_key_exists('settings', $data) ? self::mergeSettings([], $data['settings']) : []);

        $id = Ids::uuid();
        Db::transaction(static function () use ($id, $name, $description, $settings, $user): void {
            Db::exec(
                'INSERT INTO campaigns (id, name, description, settings, created_by, created_at)
                 VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP())',
                [$id, $name, $description, $settings, $user['id']],
            );
            Db::exec(
                "INSERT INTO campaign_members (campaign_id, user_id, role, joined_at) VALUES (?, ?, 'dm', UTC_TIMESTAMP())",
                [$id, $user['id']],
            );
        });

        return Response::json(['campaign' => self::load($id, 'dm')], 201);
    }

    /** @param array{id:string} $user */
    public static function show(Request $req, array $params, array $user): array
    {
        $role = Access::requireMember($user, $params['id']);
        return ['campaign' => self::load($params['id'], $role)];
    }

    /** @param array{id:string} $user */
    public static function update(Request $req, array $params, array $user): array
    {
        Access::requireDm($user, $params['id']);
        $data = $req->json();
        $sets = [];
        $values = [];
        if (array_key_exists('name', $data)) {
            $sets[] = 'name = ?';
            $values[] = Input::string($data, 'name', 1, 100, 'Název kampaně');
        }
        if (array_key_exists('description', $data)) {
            $sets[] = 'description = ?';
            $values[] = Input::string($data, 'description', 0, 2000, 'Popis');
        }
        if (array_key_exists('settings', $data)) {
            $current = json_decode((string) Db::value('SELECT settings FROM campaigns WHERE id = ?', [$params['id']]), true);
            $sets[] = 'settings = ?';
            $values[] = self::settingsJson(self::mergeSettings(is_array($current) ? $current : [], $data['settings']));
        }
        if ($sets !== []) {
            $values[] = $params['id'];
            Db::exec('UPDATE campaigns SET ' . implode(', ', $sets) . ' WHERE id = ?', $values);
        }
        return ['campaign' => self::load($params['id'], 'dm')];
    }

    /** @param array{id:string} $user */
    public static function delete(Request $req, array $params, array $user): ?array
    {
        Access::requireDm($user, $params['id']);
        // Soubory (mapy, fotky postav) leží mimo databázi, tak je smažeme se vším ostatním.
        $files = array_merge(
            array_column(Db::all('SELECT image_path FROM maps WHERE campaign_id = ?', [$params['id']]), 'image_path'),
            array_column(Db::all('SELECT photo_path FROM characters WHERE campaign_id = ? AND photo_path IS NOT NULL', [$params['id']]), 'photo_path'),
        );
        Db::exec('DELETE FROM campaigns WHERE id = ?', [$params['id']]);
        foreach ($files as $file) {
            Images::delete((string) $file);
        }
        return null;
    }

    /** @param array{id:string} $user */
    public static function members(Request $req, array $params, array $user): array
    {
        Access::requireMember($user, $params['id']);
        $rows = Db::all(
            'SELECT u.id, u.display_name, u.accent, m.role, m.joined_at
             FROM campaign_members m JOIN users u ON u.id = m.user_id
             WHERE m.campaign_id = ? ORDER BY m.joined_at, u.display_name',
            [$params['id']],
        );
        return ['members' => array_map(static fn (array $r): array => [
            'userId' => $r['id'],
            'displayName' => $r['display_name'],
            'accent' => $r['accent'],
            'role' => $r['role'],
            'joinedAt' => Ids::iso((string) $r['joined_at']),
        ], $rows)];
    }

    /**
     * Hráč smí odejít sám, DM smí odebrat hráče. DM nejde odebrat (kampaň by osiřela).
     * @param array{id:string} $user
     */
    public static function removeMember(Request $req, array $params, array $user): ?array
    {
        $role = Access::requireMember($user, $params['id']);
        $targetId = Input::uuid($params['userId'], 'Člen');
        $targetRole = Access::role($targetId, $params['id']);
        if ($targetRole === null) {
            throw HttpError::notFound('Člen nenalezen.');
        }
        if ($targetRole === 'dm') {
            throw HttpError::forbidden('DM nejde z kampaně odebrat.');
        }
        if ($targetId !== $user['id'] && $role !== 'dm') {
            throw HttpError::forbidden('Cizího hráče může odebrat jen DM.');
        }
        Db::exec('DELETE FROM campaign_members WHERE campaign_id = ? AND user_id = ?', [$params['id'], $targetId]);
        return null;
    }

    // ------------------------------------------------------------------ pozvánky

    /** @param array{id:string} $user */
    public static function invites(Request $req, array $params, array $user): array
    {
        Access::requireDm($user, $params['id']);
        $rows = Db::all(
            'SELECT id, code, created_at, expires_at, max_uses, uses, revoked
             FROM invites WHERE campaign_id = ? ORDER BY created_at DESC',
            [$params['id']],
        );
        return ['invites' => array_map(static fn (array $r): array => self::invitePayload($r), $rows)];
    }

    /** @param array{id:string} $user */
    public static function createInvite(Request $req, array $params, array $user): Response
    {
        Access::requireDm($user, $params['id']);
        $data = $req->json();
        $days = array_key_exists('expiresInDays', $data)
            ? Input::optionalInt($data, 'expiresInDays', 1, 365, 'Platnost')
            : 7;
        $maxUses = Input::optionalInt($data, 'maxUses', 1, 1000, 'Počet použití');

        $id = Ids::uuid();
        $code = Ids::inviteCode();
        Db::exec(
            'INSERT INTO invites (id, campaign_id, code, created_by, created_at, expires_at, max_uses, uses, revoked)
             VALUES (?, ?, ?, ?, UTC_TIMESTAMP(), ' . ($days === null ? 'NULL' : 'DATE_ADD(UTC_TIMESTAMP(), INTERVAL ' . (int) $days . ' DAY)') . ', ?, 0, 0)',
            [$id, $params['id'], $code, $user['id'], $maxUses],
        );
        $row = Db::one('SELECT id, code, created_at, expires_at, max_uses, uses, revoked FROM invites WHERE id = ?', [$id]);
        return Response::json(['invite' => self::invitePayload($row ?? [])], 201);
    }

    /** @param array{id:string} $user */
    public static function updateInvite(Request $req, array $params, array $user): array
    {
        Access::requireDm($user, $params['id']);
        $inviteId = Input::uuid($params['inviteId'], 'Pozvánka');
        $data = $req->json();
        if (($data['revoked'] ?? null) !== true) {
            throw HttpError::validation('Pozvánku lze jen zrušit (revoked: true).', 'revoked');
        }
        // Podmínka na campaign_id brání zrušení pozvánky z jiné kampaně.
        $changed = Db::exec('UPDATE invites SET revoked = 1 WHERE id = ? AND campaign_id = ?', [$inviteId, $params['id']]);
        $row = Db::one(
            'SELECT id, code, created_at, expires_at, max_uses, uses, revoked FROM invites WHERE id = ? AND campaign_id = ?',
            [$inviteId, $params['id']],
        );
        if ($row === null && $changed === 0) {
            throw HttpError::notFound('Pozvánka nenalezena.');
        }
        return ['invite' => self::invitePayload($row ?? [])];
    }

    /** Náhled pozvánky před přijetím (jen pro přihlášené). @param array{id:string} $user */
    public static function previewInvite(Request $req, array $params, array $user): array
    {
        RateLimiter::hit('invite-guess:' . $user['id'], 30, 600);
        $invite = Invites::findValid($params['code']);
        if ($invite === null) {
            throw HttpError::notFound('Pozvánka je neplatná, vypršela nebo byla zrušena.');
        }
        $campaignId = (string) $invite['campaign_id'];
        $campaign = Db::one('SELECT id, name FROM campaigns WHERE id = ?', [$campaignId]);
        $dm = Db::value(
            "SELECT u.display_name FROM campaign_members m JOIN users u ON u.id = m.user_id
             WHERE m.campaign_id = ? AND m.role = 'dm' ORDER BY m.joined_at LIMIT 1",
            [$campaignId],
        );
        return ['invite' => [
            'campaignId' => $campaignId,
            'campaignName' => $campaign['name'] ?? '',
            'dmName' => (string) ($dm ?? ''),
            'alreadyMember' => Access::isMember($user['id'], $campaignId),
        ]];
    }

    /** @param array{id:string} $user */
    public static function acceptInvite(Request $req, array $params, array $user): array
    {
        RateLimiter::hit('invite-guess:' . $user['id'], 30, 600);
        $campaignId = Db::transaction(static function () use ($params, $user): string {
            $invite = Invites::findValid($params['code'], forUpdate: true);
            if ($invite === null) {
                throw HttpError::notFound('Pozvánka je neplatná, vypršela nebo byla zrušena.');
            }
            return Invites::join($invite, $user['id']);
        });
        return ['campaignId' => $campaignId];
    }

    // ------------------------------------------------------------------ pomocné

    /**
     * Ověří nastavení kampaně ze vstupu a přidá ho k současnému (ostatní klíče zůstanou).
     * @param array<string, mixed> $current
     * @return array<string, mixed>
     */
    private static function mergeSettings(array $current, mixed $in): array
    {
        if (!is_array($in) || array_diff(array_keys($in), ['ruleset', 'critRule']) !== []) {
            throw HttpError::validation('Neznámé nastavení kampaně.', 'settings');
        }
        if (array_key_exists('ruleset', $in)) {
            if (!in_array($in['ruleset'], ['2014', '2024'], true)) {
                throw HttpError::validation("Pravidla musí být '2014' nebo '2024'.", 'settings');
            }
            $current['ruleset'] = $in['ruleset'];
        }
        if (array_key_exists('critRule', $in)) {
            if (!in_array($in['critRule'], Dice::CRIT_RULES, true)) {
                throw HttpError::validation("Kritický zásah musí být 'max' nebo 'double'.", 'settings');
            }
            $current['critRule'] = $in['critRule'];
        }
        return $current;
    }

    /** @param array<string, mixed> $settings */
    private static function settingsJson(array $settings): string
    {
        return (string) json_encode($settings === [] ? new \stdClass() : $settings, JSON_UNESCAPED_UNICODE);
    }

    /** @return array<string, mixed> */
    private static function load(string $id, string $role): array
    {
        $row = Db::one('SELECT id, name, description, settings, created_at FROM campaigns WHERE id = ?', [$id]);
        if ($row === null) {
            throw HttpError::notFound('Kampaň nenalezena.');
        }
        $settings = json_decode((string) $row['settings'], true);
        return [
            'id' => $row['id'],
            'name' => $row['name'],
            'description' => $row['description'],
            'settings' => is_array($settings) && $settings !== [] ? $settings : new \stdClass(),
            'role' => $role,
            'createdAt' => Ids::iso((string) $row['created_at']),
        ];
    }

    /**
     * @param array<string, mixed> $r
     * @return array<string, mixed>
     */
    private static function invitePayload(array $r): array
    {
        return [
            'id' => $r['id'],
            'code' => $r['code'],
            'createdAt' => Ids::iso((string) $r['created_at']),
            'expiresAt' => Ids::iso($r['expires_at'] === null ? null : (string) $r['expires_at']),
            'maxUses' => $r['max_uses'] === null ? null : (int) $r['max_uses'],
            'uses' => (int) $r['uses'],
            'revoked' => (bool) $r['revoked'],
        ];
    }
}
