<?php

declare(strict_types=1);

namespace Dnd;

/**
 * Výrazy s kostkami ("2d6+3", "1d20+7-1", "d8+4") a jejich hod na serveru.
 * Povoleno je jen součet a rozdíl členů NdM a celých čísel; počty kostek, strany i délka jsou omezené,
 * takže výraz nejde zneužít k velké zátěži. Losuje se přes random_int (kryptograficky silný zdroj).
 */
final class Dice
{
    public const MAX_LENGTH = 100;
    public const MAX_DICE_PER_TERM = 100;
    public const MAX_DICE_TOTAL = 200;
    public const MAX_SIDES = 1000;
    public const MAX_CONSTANT = 10000;

    /**
     * Rozloží výraz na členy: ['sign' => 1|-1, 'count' => n, 'sides' => m] pro kostky, ['sign', 'constant'] pro čísla.
     * @return list<array{sign:int,count?:int,sides?:int,constant?:int}>
     */
    public static function parse(string $expression): array
    {
        $expr = strtolower((string) preg_replace('/\s+/', '', $expression));
        if ($expr === '' || strlen($expr) > self::MAX_LENGTH) {
            throw HttpError::validation('Výraz je prázdný nebo příliš dlouhý (nejvýš ' . self::MAX_LENGTH . ' znaků).', 'expression');
        }
        $term = '(?:\d{0,3}d\d{1,4}|\d{1,5})';
        if (preg_match("/^[+-]?$term(?:[+-]$term)*$/", $expr) !== 1) {
            throw HttpError::validation('Výraz neumím přečíst. Piš např. 1d20+5, 2d6+3 nebo d8.', 'expression');
        }
        preg_match_all("/([+-]?)($term)/", $expr, $m, PREG_SET_ORDER);
        $terms = [];
        $dice = 0;
        foreach ($m as $part) {
            $sign = $part[1] === '-' ? -1 : 1;
            if (str_contains($part[2], 'd')) {
                [$c, $s] = explode('d', $part[2]);
                $count = $c === '' ? 1 : (int) $c;
                $sides = (int) $s;
                if ($count < 1 || $count > self::MAX_DICE_PER_TERM) {
                    throw HttpError::validation('Jedním členem lze hodit 1 až ' . self::MAX_DICE_PER_TERM . ' kostek.', 'expression');
                }
                if ($sides < 2 || $sides > self::MAX_SIDES) {
                    throw HttpError::validation('Kostka musí mít 2 až ' . self::MAX_SIDES . ' stěn.', 'expression');
                }
                $dice += $count;
                $terms[] = ['sign' => $sign, 'count' => $count, 'sides' => $sides];
            } else {
                $value = (int) $part[2];
                if ($value > self::MAX_CONSTANT) {
                    throw HttpError::validation('Číslo ve výrazu je příliš velké.', 'expression');
                }
                $terms[] = ['sign' => $sign, 'constant' => $value];
            }
        }
        if ($dice < 1) {
            throw HttpError::validation('Výraz musí obsahovat aspoň jednu kostku (např. 1d20).', 'expression');
        }
        if ($dice > self::MAX_DICE_TOTAL) {
            throw HttpError::validation('Najednou lze hodit nejvýš ' . self::MAX_DICE_TOTAL . ' kostek.', 'expression');
        }
        return $terms;
    }

    /** Výraz v ustáleném tvaru ("1d20+7", "2d6-1"). @param list<array{sign:int,count?:int,sides?:int,constant?:int}> $terms */
    public static function canonical(array $terms): string
    {
        $out = '';
        foreach ($terms as $i => $t) {
            $body = isset($t['sides']) ? $t['count'] . 'd' . $t['sides'] : (string) $t['constant'];
            $out .= ($t['sign'] < 0 ? '-' : ($i > 0 ? '+' : '')) . $body;
        }
        return $out;
    }

    /**
     * Jeden hod výrazu. Při `crit` se počty kostek zdvojnásobí (kritický zásah), konstanty ne. `critExtra` jsou kostky navíc, které se
     * při kritu přidají po zdvojení a samy se nezdvojují (Brutal Critical barbara); bez `crit` se ignorují.
     * @param list<array{sign:int,count?:int,sides?:int,constant?:int}> $terms
     * @param list<array{sign:int,count?:int,sides?:int,constant?:int}> $critExtra
     * @return array{terms: list<array<string, mixed>>, total: int}
     */
    public static function roll(array $terms, bool $crit = false, array $critExtra = []): array
    {
        $total = 0;
        $out = [];
        foreach (($crit ? [...$terms, ...$critExtra] : $terms) as $i => $t) {
            if (isset($t['sides'])) {
                // zdvojují se jen členy původního výrazu, ne kostky navíc
                $count = $crit && $i < count($terms) ? $t['count'] * 2 : $t['count'];
                $rolls = [];
                for ($n = 0; $n < $count; $n++) {
                    $rolls[] = random_int(1, $t['sides']);
                }
                $total += $t['sign'] * array_sum($rolls);
                $out[] = ['sign' => $t['sign'], 'count' => $count, 'sides' => $t['sides'], 'rolls' => $rolls];
            } else {
                $total += $t['sign'] * $t['constant'];
                $out[] = ['sign' => $t['sign'], 'constant' => $t['constant']];
            }
        }
        return ['terms' => $out, 'total' => $total];
    }

    /**
     * Hod s výhodou / nevýhodou: celý výraz se hodí dvakrát a vybere se vyšší / nižší součet (při shodě první).
     * @param list<array{sign:int,count?:int,sides?:int,constant?:int}> $terms
     * @param list<array{sign:int,count?:int,sides?:int,constant?:int}> $critExtra kostky navíc jen při kritu (viz `roll`)
     * @return array{attempts: list<array<string, mixed>>, chosen: int, total: int, natural: int|null}
     */
    public static function rollWithMode(array $terms, string $mode, bool $crit, array $critExtra = []): array
    {
        $attempts = [self::roll($terms, $crit, $critExtra)];
        $chosen = 0;
        if ($mode === 'advantage' || $mode === 'disadvantage') {
            $attempts[] = self::roll($terms, $crit, $critExtra);
            $better = $mode === 'advantage' ? $attempts[1]['total'] > $attempts[0]['total'] : $attempts[1]['total'] < $attempts[0]['total'];
            $chosen = $better ? 1 : 0;
        }
        // "Natural" hodnota pro k20: výraz s jedinou kostkou d20 (kvůli zvýraznění 20 a 1).
        $natural = null;
        $d20 = array_values(array_filter($attempts[$chosen]['terms'], static fn (array $t): bool => ($t['sides'] ?? 0) === 20 && $t['sign'] > 0));
        if (count($d20) === 1 && count($d20[0]['rolls']) === 1) {
            $natural = $d20[0]['rolls'][0];
        }
        return ['attempts' => $attempts, 'chosen' => $chosen, 'total' => $attempts[$chosen]['total'], 'natural' => $natural];
    }
}
