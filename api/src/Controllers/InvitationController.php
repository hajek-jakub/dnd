<?php

declare(strict_types=1);

namespace Dnd\Controllers;

use Dnd\Access;
use Dnd\Db;
use Dnd\HttpError;
use Dnd\Ids;
use Dnd\Input;
use Dnd\Notifications;
use Dnd\RateLimiter;
use Dnd\Request;
use Dnd\Response;

/**
 * Pozvánky existujících uživatelů do kampaně (vedle kódů pro nové hráče v CampaignController).
 * Zve jen DM, a to přesným přihlašovacím jménem nebo z lidí, se kterými sdílí jinou kampaň (seznam účtů aplikace se nedá vypsat).
 * Pozvaný vidí jen název kampaně a jméno DM; přijetí z něj udělá hráče, nikdy DM. Cizí pozvánka se tváří, že neexistuje (404).
 */
final class InvitationController
{
    private const MAX_PENDING = 50;

    /** Čekající pozvánky kampaně (jen DM). @param array{id:string} $user */
    public static function index(Request $req, array $params, array $user): array
    {
        Access::requireDm($user, $params['id']);
        return ['invitations' => self::campaignInvitations($params['id'])];
    }

    /** @param array{id:string,display_name:string} $user */
    public static function create(Request $req, array $params, array $user): Response
    {
        Access::requireDm($user, $params['id']);
        RateLimiter::hit('invite-user:' . $user['id'], 20, 600);
        $data = $req->json();
        if (array_key_exists('userId', $data)) {
            $target = Db::one('SELECT id, display_name FROM users WHERE id = ?', [Input::uuid((string) $data['userId'], 'Uživatel')]);
            // Podle id smí DM pozvat jen někoho ze svých ostatních kampaní (návrhy), jinak by šlo zkoušet id cizích účtů.
            if ($target !== null && !self::sharesCampaign($user['id'], (string) $target['id'])) {
                $target = null;
            }
        } else {
            $username = Input::string($data, 'username', 1, 30, 'Přihlašovací jméno');
            $target = Db::one('SELECT id, display_name FROM users WHERE username = ?', [$username]);
        }
        if ($target === null) {
            throw HttpError::notFound('Uživatel s tímto přihlašovacím jménem neexistuje.');
        }
        $targetId = (string) $target['id'];
        if ($targetId === $user['id']) {
            throw HttpError::validation('Sám sebe pozvat nemůžeš.', 'username');
        }
        if (Access::isMember($targetId, $params['id'])) {
            throw HttpError::validation((string) $target['display_name'] . ' už v kampani je.', 'username');
        }

        $created = Db::transaction(static function () use ($params, $user, $targetId): bool {
            if (Db::value('SELECT 1 FROM campaign_invitations WHERE campaign_id = ? AND user_id = ?', [$params['id'], $targetId]) !== null) {
                return false;
            }
            if ((int) Db::value('SELECT COUNT(*) FROM campaign_invitations WHERE campaign_id = ?', [$params['id']]) >= self::MAX_PENDING) {
                throw HttpError::validation('Kampaň má moc čekajících pozvánek, nejdřív některé zruš.', 'username');
            }
            Db::exec(
                'INSERT INTO campaign_invitations (id, campaign_id, user_id, invited_by, created_at) VALUES (?, ?, ?, ?, UTC_TIMESTAMP())',
                [Ids::uuid(), $params['id'], $targetId, $user['id']],
            );
            $name = (string) Db::value('SELECT name FROM campaigns WHERE id = ?', [$params['id']]);
            Notifications::push($targetId, $user['id'], $params['id'], null, 'invite', $user['display_name'] . ' tě zve do kampaně ' . $name, 'invites', 'campaigns');
            return true;
        });

        return Response::json(['invitations' => self::campaignInvitations($params['id'])], $created ? 201 : 200);
    }

    /** Zrušení čekající pozvánky (jen DM). @param array{id:string} $user */
    public static function remove(Request $req, array $params, array $user): ?array
    {
        Access::requireDm($user, $params['id']);
        $id = Input::uuid($params['invitationId'], 'Pozvánka');
        if (Db::exec('DELETE FROM campaign_invitations WHERE id = ? AND campaign_id = ?', [$id, $params['id']]) === 0) {
            throw HttpError::notFound('Pozvánka nenalezena.');
        }
        return null;
    }

    /**
     * Návrhy pro DM: lidé z jeho ostatních kampaní, kteří v této ještě nejsou a nemají čekající pozvánku.
     * @param array{id:string} $user
     */
    public static function suggestions(Request $req, array $params, array $user): array
    {
        Access::requireDm($user, $params['id']);
        $rows = Db::all(
            'SELECT DISTINCT u.id, u.username, u.display_name
             FROM campaign_members mine
             JOIN campaign_members other ON other.campaign_id = mine.campaign_id AND other.user_id <> mine.user_id
             JOIN users u ON u.id = other.user_id
             WHERE mine.user_id = ? AND mine.campaign_id <> ?
               AND NOT EXISTS (SELECT 1 FROM campaign_members x WHERE x.campaign_id = ? AND x.user_id = u.id)
               AND NOT EXISTS (SELECT 1 FROM campaign_invitations i WHERE i.campaign_id = ? AND i.user_id = u.id)
             ORDER BY u.display_name LIMIT 50',
            [$user['id'], $params['id'], $params['id'], $params['id']],
        );
        return ['suggestions' => array_map(static fn (array $r): array => [
            'userId' => $r['id'],
            'username' => $r['username'],
            'displayName' => $r['display_name'],
        ], $rows)];
    }

    /** Moje čekající pozvánky (i v /summary). @return list<array<string, mixed>> */
    public static function mine(string $userId): array
    {
        $rows = Db::all(
            "SELECT i.id, i.campaign_id, i.created_at, c.name AS campaign_name, inviter.display_name AS inviter_name,
                    (SELECT u.display_name FROM campaign_members m JOIN users u ON u.id = m.user_id
                     WHERE m.campaign_id = i.campaign_id AND m.role = 'dm' ORDER BY m.joined_at LIMIT 1) AS dm_name
             FROM campaign_invitations i
             JOIN campaigns c ON c.id = i.campaign_id
             JOIN users inviter ON inviter.id = i.invited_by
             WHERE i.user_id = ? ORDER BY i.created_at DESC",
            [$userId],
        );
        return array_map(static fn (array $r): array => [
            'id' => $r['id'],
            'campaignId' => $r['campaign_id'],
            'campaignName' => $r['campaign_name'],
            'dmName' => (string) ($r['dm_name'] ?? ''),
            'invitedBy' => $r['inviter_name'],
            'createdAt' => Ids::iso((string) $r['created_at']),
        ], $rows);
    }

    /** @param array{id:string} $user */
    public static function listMine(Request $req, array $params, array $user): array
    {
        return ['invitations' => self::mine($user['id'])];
    }

    /** Přijetí: pozvaný se stane hráčem kampaně. @param array{id:string,display_name:string} $user */
    public static function accept(Request $req, array $params, array $user): array
    {
        $id = Input::uuid($params['invitationId'], 'Pozvánka');
        $campaignId = Db::transaction(static function () use ($id, $user): string {
            $inv = self::ownInvitation($id, $user['id']);
            $campaignId = (string) $inv['campaign_id'];
            if (!Access::isMember($user['id'], $campaignId)) {
                Db::exec(
                    "INSERT INTO campaign_members (campaign_id, user_id, role, joined_at) VALUES (?, ?, 'player', UTC_TIMESTAMP())",
                    [$campaignId, $user['id']],
                );
            }
            Db::exec('DELETE FROM campaign_invitations WHERE id = ?', [$id]);
            Notifications::push((string) $inv['invited_by'], $user['id'], $campaignId, null, 'invite', $user['display_name'] . ' přijal(a) pozvánku do kampaně', 'invites');
            return $campaignId;
        });
        return ['campaignId' => $campaignId];
    }

    /** @param array{id:string} $user */
    public static function decline(Request $req, array $params, array $user): ?array
    {
        $id = Input::uuid($params['invitationId'], 'Pozvánka');
        Db::transaction(static function () use ($id, $user): void {
            self::ownInvitation($id, $user['id']);
            Db::exec('DELETE FROM campaign_invitations WHERE id = ?', [$id]);
        });
        return null;
    }

    // ------------------------------------------------------------------ pomocné

    /** @return array<string, mixed> */
    private static function ownInvitation(string $id, string $userId): array
    {
        $inv = Db::one('SELECT id, campaign_id, invited_by FROM campaign_invitations WHERE id = ? AND user_id = ? FOR UPDATE', [$id, $userId]);
        if ($inv === null) {
            throw HttpError::notFound('Pozvánka neexistuje nebo už byla vyřízená.');
        }
        return $inv;
    }

    private static function sharesCampaign(string $a, string $b): bool
    {
        return Db::value(
            'SELECT 1 FROM campaign_members x JOIN campaign_members y ON y.campaign_id = x.campaign_id WHERE x.user_id = ? AND y.user_id = ? LIMIT 1',
            [$a, $b],
        ) !== null;
    }

    /** @return list<array<string, mixed>> */
    private static function campaignInvitations(string $campaignId): array
    {
        $rows = Db::all(
            'SELECT i.id, i.created_at, u.id AS user_id, u.username, u.display_name
             FROM campaign_invitations i JOIN users u ON u.id = i.user_id
             WHERE i.campaign_id = ? ORDER BY i.created_at DESC',
            [$campaignId],
        );
        return array_map(static fn (array $r): array => [
            'id' => $r['id'],
            'userId' => $r['user_id'],
            'username' => $r['username'],
            'displayName' => $r['display_name'],
            'createdAt' => Ids::iso((string) $r['created_at']),
        ], $rows);
    }
}
