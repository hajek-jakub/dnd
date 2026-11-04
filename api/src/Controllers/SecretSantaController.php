<?php

declare(strict_types=1);

namespace Dnd\Controllers;

use Dnd\Db;
use Dnd\HttpError;
use Dnd\Input;
use Dnd\Request;

/**
 * Secret Santa z pohledu účastníka: vidí jen svou dvojici a jen dokud losování platí (`visible_until`).
 * Komu dává, se dozví až odkrytím (`reveal`), do té doby to server neposílá ani v odpovědi. Kdo komu dává jinak, nevidí nikdo (ani DM).
 * Cizí losování, losování kampaně, ze které účastník odešel, a prošlé losování jsou 404.
 */
final class SecretSantaController
{
    /** @param array{id:string} $user */
    public static function index(Request $req, array $params, array $user): array
    {
        $rows = Db::all(self::SQL . ' ORDER BY d.visible_until', [$user['id']]);
        return ['draws' => array_map(static fn (array $row): array => self::payload($row), $rows)];
    }

    /** Odkryje dárci, komu dává. Opakované odkrytí vrátí totéž. @param array{id:string} $user */
    public static function reveal(Request $req, array $params, array $user): array
    {
        $id = Input::uuid($params['id'], 'Losování');
        $row = Db::one(self::SQL . ' AND d.id = ?', [$user['id'], $id]);
        if ($row === null) {
            throw HttpError::notFound('Losování nenalezeno.');
        }
        Db::exec('UPDATE secret_santa_pairs SET revealed_at = COALESCE(revealed_at, UTC_TIMESTAMP()) WHERE draw_id = ? AND giver_id = ?', [$id, $user['id']]);
        $row['revealed_at'] = $row['revealed_at'] ?? gmdate('Y-m-d H:i:s');
        return ['draw' => self::payload($row)];
    }

    private const SQL = 'SELECT d.id, d.campaign_id, d.title, d.visible_until, c.name AS campaign_name, p.giver_label, p.receiver_label, p.revealed_at
         FROM secret_santa_pairs p
         JOIN secret_santa_draws d ON d.id = p.draw_id
         JOIN campaigns c ON c.id = d.campaign_id
         JOIN campaign_members m ON m.campaign_id = d.campaign_id AND m.user_id = p.giver_id
         WHERE p.giver_id = ? AND d.visible_until > UTC_TIMESTAMP()';

    /** @param array<string, mixed> $row */
    private static function payload(array $row): array
    {
        // Jména ostatních účastníků (pro animaci losování); kdo komu dává, z nich vyčíst nejde.
        $names = array_map(
            static fn (array $r): string => (string) $r['receiver_label'],
            Db::all('SELECT receiver_label FROM secret_santa_pairs WHERE draw_id = ? AND receiver_label <> ? ORDER BY receiver_label', [$row['id'], $row['giver_label']]),
        );
        $revealed = $row['revealed_at'] !== null;
        return [
            'id' => $row['id'],
            'campaignId' => $row['campaign_id'],
            'campaignName' => $row['campaign_name'],
            'title' => $row['title'],
            'visibleUntil' => str_replace(' ', 'T', (string) $row['visible_until']) . 'Z',
            'me' => $row['giver_label'],
            'names' => $names,
            'revealed' => $revealed,
            'receiver' => $revealed ? $row['receiver_label'] : null,
        ];
    }
}
