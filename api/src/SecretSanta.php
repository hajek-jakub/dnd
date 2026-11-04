<?php

declare(strict_types=1);

namespace Dnd;

/**
 * Secret Santa: losování dárců a obdarovaných v kampani.
 *
 * Losuje se jeden náhodný kruh (A → B → C → … → A): nikdo nemá sám sebe, každý dává i dostává právě jednou
 * a nevzniknou dvojice, které by si dávaly navzájem. Kdo komu dává, ví jen dárce (`SecretSantaController`), losující skript to nevypisuje.
 */
final class SecretSanta
{
    public const MIN_PARTICIPANTS = 3;
    public const MAX_PARTICIPANTS = 50;

    /**
     * @param list<string> $ids
     * @return array<string, string> dárce => obdarovaný
     */
    public static function cycle(array $ids): array
    {
        if (count($ids) !== count(array_unique($ids)) || count($ids) < 2) {
            throw new \InvalidArgumentException('Losování potřebuje aspoň dva různé účastníky.');
        }
        // Fisher–Yates s random_int (kryptograficky náhodné, výsledek nejde předpovědět).
        for ($i = count($ids) - 1; $i > 0; $i--) {
            $j = random_int(0, $i);
            [$ids[$i], $ids[$j]] = [$ids[$j], $ids[$i]];
        }
        $pairs = [];
        foreach ($ids as $i => $id) {
            $pairs[$id] = $ids[($i + 1) % count($ids)];
        }
        return $pairs;
    }

    /**
     * Založí losování (předchozí losování kampaně smaže, takže opakování = nové losování a nové odkrytí).
     *
     * @param list<array{userId:string, label:string}> $participants
     */
    public static function draw(string $campaignId, string $title, string $visibleUntilUtc, array $participants): string
    {
        if (count($participants) < self::MIN_PARTICIPANTS || count($participants) > self::MAX_PARTICIPANTS) {
            throw new \InvalidArgumentException('Účastníků musí být ' . self::MIN_PARTICIPANTS . ' až ' . self::MAX_PARTICIPANTS . '.');
        }
        $labels = [];
        foreach ($participants as $p) {
            $labels[$p['userId']] = $p['label'];
        }
        $pairs = self::cycle(array_keys($labels));
        $id = Ids::uuid();
        Db::transaction(static function () use ($id, $campaignId, $title, $visibleUntilUtc, $pairs, $labels): void {
            Db::exec('DELETE FROM secret_santa_draws WHERE campaign_id = ?', [$campaignId]);
            Db::exec(
                'INSERT INTO secret_santa_draws (id, campaign_id, title, visible_until, created_at) VALUES (?, ?, ?, ?, UTC_TIMESTAMP())',
                [$id, $campaignId, $title, $visibleUntilUtc],
            );
            foreach ($pairs as $giver => $receiver) {
                Db::exec(
                    'INSERT INTO secret_santa_pairs (draw_id, giver_id, giver_label, receiver_id, receiver_label) VALUES (?, ?, ?, ?, ?)',
                    [$id, $giver, $labels[$giver], $receiver, $labels[$receiver]],
                );
            }
        });
        return $id;
    }
}
