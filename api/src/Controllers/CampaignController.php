<?php

declare(strict_types=1);

namespace Dnd\Controllers;

use Dnd\Access;
use Dnd\Db;
use Dnd\HttpError;
use Dnd\Ids;
use Dnd\Input;
use Dnd\Invites;
use Dnd\RateLimiter;
use Dnd\Request;
use Dnd\Response;

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
        return ['campaigns' => array_map(static fn (array $r): array => [
            'id' => $r['id'],
            'name' => $r['name'],
            'description' => $r['description'],
            'role' => $r['role'],
        ], $rows)];
    }

    /** @param array{id:string} $user */
    public static function create(Request $req, array $params, array $user): Response
    {
        $data = $req->json();
        $name = Input::string($data, 'name', 1, 100, 'Název kampaně');
        $description = Input::optionalString($data, 'description', 2000, 'Popis') ?? '';

        $id = Ids::uuid();
        Db::transaction(static function () use ($id, $name, $description, $user): void {
            Db::exec(
                'INSERT INTO campaigns (id, name, description, settings, created_by, created_at)
                 VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP())',
                [$id, $name, $description, '{}', $user['id']],
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
            $in = $data['settings'];
            if (!is_array($in) || array_diff(array_keys($in), ['encumbrance']) !== []) {
                throw HttpError::validation('Neznámé nastavení kampaně.', 'settings');
            }
            $current = json_decode((string) Db::value('SELECT settings FROM campaigns WHERE id = ?', [$params['id']]), true);
            $current = is_array($current) ? $current : [];
            if (array_key_exists('encumbrance', $in)) {
                if (!is_bool($in['encumbrance'])) {
                    throw HttpError::validation('encumbrance musí být true/false.', 'settings');
                }
                $current['encumbrance'] = $in['encumbrance'];
            }
            $sets[] = 'settings = ?';
            $values[] = json_encode($current === [] ? new \stdClass() : $current, JSON_UNESCAPED_UNICODE);
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
        Db::exec('DELETE FROM campaigns WHERE id = ?', [$params['id']]);
        return null;
    }

    /** @param array{id:string} $user */
    public static function members(Request $req, array $params, array $user): array
    {
        Access::requireMember($user, $params['id']);
        $rows = Db::all(
            'SELECT u.id, u.display_name, m.role, m.joined_at
             FROM campaign_members m JOIN users u ON u.id = m.user_id
             WHERE m.campaign_id = ? ORDER BY m.joined_at, u.display_name',
            [$params['id']],
        );
        return ['members' => array_map(static fn (array $r): array => [
            'userId' => $r['id'],
            'displayName' => $r['display_name'],
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
