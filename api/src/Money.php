<?php

declare(strict_types=1);

namespace Dnd;

/** Mince a placení s vracením drobných (v mědácích: cp 1, sp 10, ep 50, gp 100, pp 1000). */
final class Money
{
    public const COINS = ['cp', 'sp', 'ep', 'gp', 'pp'];
    public const VALUE = ['cp' => 1, 'sp' => 10, 'ep' => 50, 'gp' => 100, 'pp' => 1000];
    /** Drobné se vrací jen v těchto mincích (ep a pp se nevrací), od největší. */
    private const CHANGE = ['gp', 'sp', 'cp'];

    /** @param array<string, int> $wallet */
    public static function totalCp(array $wallet): int
    {
        $total = 0;
        foreach (self::COINS as $c) {
            $total += ($wallet[$c] ?? 0) * self::VALUE[$c];
        }
        return $total;
    }

    /**
     * Zaplatí `$costCp` mědáků z peněženky. Nejdřív se platí přesnými mincemi od nejmenších, a když to nestačí,
     * rozmění se nejmenší mince, která zbytek pokryje, a vrátí se drobné (gp, sp, cp). Nic se nezaplatí napůl:
     * nedostatek peněz vrátí null.
     * @param array<string, int> $wallet
     * @return array<string, int>|null nová peněženka
     */
    public static function pay(array $wallet, int $costCp): ?array
    {
        if ($costCp <= 0 || self::totalCp($wallet) < $costCp) {
            return null;
        }
        $remaining = $costCp;
        foreach (self::COINS as $c) {
            $take = min($wallet[$c], intdiv($remaining, self::VALUE[$c]));
            $wallet[$c] -= $take;
            $remaining -= $take * self::VALUE[$c];
        }
        if ($remaining > 0) {
            foreach (self::COINS as $c) {
                if ($wallet[$c] > 0 && self::VALUE[$c] >= $remaining) {
                    $wallet[$c]--;
                    $change = self::VALUE[$c] - $remaining;
                    $remaining = 0;
                    foreach (self::CHANGE as $cc) {
                        $n = intdiv($change, self::VALUE[$cc]);
                        $wallet[$cc] += $n;
                        $change -= $n * self::VALUE[$cc];
                    }
                    break;
                }
            }
        }
        return $remaining === 0 ? $wallet : null;
    }
}
