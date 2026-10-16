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

    /**
     * Rozdělí mince rovným dílem mezi $n postav. Nejdřív se dělí každý druh mince zvlášť (10 gp mezi 3 = 3 gp každému),
     * zbylé mince se přepočtou na mědáky a rozdělí se znovu (1 gp = 100 cp = 33 cp každému). Co se nedělí beze zbytku, zůstane DM.
     * @param array<string, int> $coins
     * @return array{0: array<string, int>, 1: int} díl jedné postavy (mince) a zbytek v mědácích
     */
    public static function splitCoins(array $coins, int $n): array
    {
        $share = array_fill_keys(self::COINS, 0);
        $restCp = 0;
        foreach (self::COINS as $c) {
            $have = $coins[$c] ?? 0;
            $share[$c] = intdiv($have, $n);
            $restCp += ($have % $n) * self::VALUE[$c];
        }
        $eachCp = intdiv($restCp, $n);
        foreach (self::fromCp($eachCp) as $c => $count) {
            $share[$c] += $count;
        }
        return [$share, $restCp - $eachCp * $n];
    }

    /**
     * Cena zadaná v mincích (`{gp: 50, sp: 5}`) jako částka v mědácích; null nebo nulová částka = bez ceny (zdarma).
     * Neplatný vstup je 422 s polem `$field`.
     */
    public static function priceCp(mixed $coins, string $field = 'price'): ?int
    {
        if ($coins === null) {
            return null;
        }
        if (!is_array($coins)) {
            throw HttpError::validation('Cena má neplatný tvar.', $field);
        }
        $total = 0;
        foreach (self::COINS as $c) {
            $v = $coins[$c] ?? 0;
            if (!is_int($v) || $v < 0 || $v > 1_000_000_000) {
                throw HttpError::validation("Mince $c v ceně musí být celé číslo od 0.", $field);
            }
            $total += $v * self::VALUE[$c];
        }
        if ($total > 1_000_000_000) {
            throw HttpError::validation('Cena je příliš vysoká.', $field);
        }
        return $total > 0 ? $total : null;
    }

    /** Částka v mědácích jako text („50 gp, 5 sp“). */
    public static function text(int $cp): string
    {
        $parts = [];
        foreach (self::fromCp($cp) as $coin => $n) {
            if ($n > 0) {
                $parts[] = "$n $coin";
            }
        }
        return $parts === [] ? '0 cp' : implode(', ', array_reverse($parts));
    }

    /**
     * Částka v mědácích jako mince (gp, sp, cp), ať je čitelná.
     * @return array<string, int>
     */
    public static function fromCp(int $cp): array
    {
        $out = array_fill_keys(self::COINS, 0);
        foreach (self::CHANGE as $c) {
            $out[$c] = intdiv($cp, self::VALUE[$c]);
            $cp -= $out[$c] * self::VALUE[$c];
        }
        return $out;
    }
}
