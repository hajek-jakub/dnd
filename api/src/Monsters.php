<?php

declare(strict_types=1);

namespace Dnd;

use Throwable;

/**
 * Nestvůry ze SRD 5.1 (5e-database): čitelný stat blok pro prohlížeč pravidel a šablona nepřítele do Panelu DM a přípravy
 * (HP, AC, bonus iniciativy z DEX, útoky s bonusem a kostkami zranění). Data se nemění, jen převádějí.
 */
final class Monsters
{
    private const ABILITIES = ['strength' => 'STR', 'dexterity' => 'DEX', 'constitution' => 'CON', 'intelligence' => 'INT', 'wisdom' => 'WIS', 'charisma' => 'CHA'];

    /** Challenge rating jako text: 0.25 → „1/4“. */
    public static function cr(mixed $cr): string
    {
        $value = is_numeric($cr) ? (float) $cr : 0.0;
        foreach (['1/8' => 0.125, '1/4' => 0.25, '1/2' => 0.5] as $text => $v) {
            if (abs($value - $v) < 0.001) {
                return $text;
            }
        }
        return (string) (int) $value;
    }

    /** Krátké shrnutí na začátek popisu (je vidět v seznamu pravidel i ve výsledcích hledání AI). @param array<string, mixed> $m */
    public static function headline(array $m): string
    {
        return sprintf(
            '%s %s%s, %s. CR %s (%s XP), AC %d, HP %d (%s).',
            (string) ($m['size'] ?? ''),
            (string) ($m['type'] ?? ''),
            !empty($m['subtype']) ? ' (' . $m['subtype'] . ')' : '',
            (string) ($m['alignment'] ?? ''),
            self::cr($m['challenge_rating'] ?? 0),
            number_format((int) ($m['xp'] ?? 0), 0, '.', ','),
            self::ac($m),
            (int) ($m['hit_points'] ?? 0),
            (string) ($m['hit_points_roll'] ?? $m['hit_dice'] ?? ''),
        );
    }

    /** Celý stat blok jako text s **tučnými** názvy (zobrazuje ho DescriptionText). @param array<string, mixed> $m */
    public static function statBlock(array $m): string
    {
        $lines = [self::headline($m)];
        $speed = [];
        foreach ((array) ($m['speed'] ?? []) as $mode => $v) {
            if (is_string($v)) {
                $speed[] = $mode === 'walk' ? $v : "$mode $v";
            }
        }
        $lines[] = '**Speed** ' . implode(', ', $speed);
        $abilities = [];
        foreach (self::ABILITIES as $key => $label) {
            $score = (int) ($m[$key] ?? 10);
            $abilities[] = sprintf('%s %d (%+d)', $label, $score, self::mod($score));
        }
        $lines[] = implode(' · ', $abilities);
        $profs = [];
        foreach ((array) ($m['proficiencies'] ?? []) as $p) {
            if (is_array($p) && isset($p['proficiency']['name'], $p['value'])) {
                $profs[] = preg_replace('/^(Skill|Saving Throw): /', '', (string) $p['proficiency']['name']) . sprintf(' %+d', (int) $p['value']);
            }
        }
        if ($profs !== []) {
            $lines[] = '**Saves and skills** ' . implode(', ', $profs);
        }
        foreach (['damage_vulnerabilities' => 'Vulnerabilities', 'damage_resistances' => 'Resistances', 'damage_immunities' => 'Damage immunities'] as $key => $label) {
            if (!empty($m[$key]) && is_array($m[$key])) {
                $lines[] = "**$label** " . implode(', ', array_map('strval', $m[$key]));
            }
        }
        if (!empty($m['condition_immunities']) && is_array($m['condition_immunities'])) {
            $lines[] = '**Condition immunities** ' . implode(', ', array_map(static fn (mixed $c): string => is_array($c) ? (string) ($c['name'] ?? '') : (string) $c, $m['condition_immunities']));
        }
        $senses = [];
        foreach ((array) ($m['senses'] ?? []) as $k => $v) {
            $senses[] = str_replace('_', ' ', (string) $k) . ' ' . (string) $v;
        }
        if ($senses !== []) {
            $lines[] = '**Senses** ' . implode(', ', $senses);
        }
        if (!empty($m['languages'])) {
            $lines[] = '**Languages** ' . (string) $m['languages'];
        }
        $out = implode("\n", $lines);
        foreach (['special_abilities' => null, 'actions' => 'Actions', 'reactions' => 'Reactions', 'legendary_actions' => 'Legendary Actions'] as $key => $title) {
            $list = is_array($m[$key] ?? null) ? $m[$key] : [];
            if ($list === []) {
                continue;
            }
            $out .= "\n\n" . ($title !== null ? "**$title**\n" : '');
            $out .= implode("\n", array_map(static fn (array $a): string => '**' . (string) ($a['name'] ?? '') . '.** ' . (string) ($a['desc'] ?? ''), array_filter($list, 'is_array')));
        }
        return $out;
    }

    /**
     * Šablona nepřítele (stejný tvar jako vstup EnemyController): HP, AC, iniciativa, útoky a poznámka (CR, Multiattack, schopnosti).
     * @param array<string, mixed> $m data nestvůry
     * @return array{name: string, hpMax: int, ac: int, initiative: int, attacks: list<array{name: string, toHit: int, damage: string}>, notes: string, cr: string, xp: int}
     */
    public static function enemy(array $m): array
    {
        $attacks = [];
        $other = [];
        foreach (is_array($m['actions'] ?? null) ? $m['actions'] : [] as $a) {
            if (!is_array($a)) {
                continue;
            }
            if (isset($a['attack_bonus']) && is_numeric($a['attack_bonus']) && count($attacks) < 12) {
                $attacks[] = ['name' => mb_substr((string) $a['name'], 0, 60), 'toHit' => max(-10, min(30, (int) $a['attack_bonus'])), 'damage' => self::damage($a)];
            } else {
                $other[] = $a;
            }
        }
        $notes = ['CR ' . self::cr($m['challenge_rating'] ?? 0) . ' (' . (int) ($m['xp'] ?? 0) . ' XP), ' . trim((string) ($m['size'] ?? '') . ' ' . (string) ($m['type'] ?? '')) . '.'];
        foreach ([...$other, ...(is_array($m['special_abilities'] ?? null) ? $m['special_abilities'] : [])] as $a) {
            if (is_array($a) && isset($a['name'])) {
                $notes[] = '**' . $a['name'] . '.** ' . mb_substr((string) ($a['desc'] ?? ''), 0, 400);
            }
        }
        if (!empty($m['legendary_actions'])) {
            $notes[] = '**Legendary Actions:** ' . implode(', ', array_map(static fn (array $a): string => (string) ($a['name'] ?? ''), array_filter((array) $m['legendary_actions'], 'is_array')));
        }
        return [
            'name' => mb_substr((string) ($m['name'] ?? 'Nestvůra'), 0, 100),
            'hpMax' => max(1, (int) ($m['hit_points'] ?? 1)),
            'ac' => self::ac($m),
            'initiative' => max(-10, min(30, self::mod((int) ($m['dexterity'] ?? 10)))),
            'attacks' => $attacks,
            'notes' => mb_substr(implode("\n", $notes), 0, 4000),
            'cr' => self::cr($m['challenge_rating'] ?? 0),
            'xp' => (int) ($m['xp'] ?? 0),
        ];
    }

    /** @param array<string, mixed> $m */
    private static function ac(array $m): int
    {
        $ac = $m['armor_class'] ?? 10;
        if (is_array($ac)) {
            $first = $ac[0] ?? [];
            return (int) (is_array($first) ? ($first['value'] ?? 10) : $first);
        }
        return (int) $ac;
    }

    private static function mod(int $score): int
    {
        return (int) floor(($score - 10) / 2);
    }

    /**
     * Kostky zranění útoku sečtené do jednoho výrazu („1d8+3+2d6“), jen části, které jdou hodit; varianty na výběr (versatile) se přeskočí.
     * @param array<string, mixed> $action
     */
    private static function damage(array $action): string
    {
        $parts = [];
        foreach (is_array($action['damage'] ?? null) ? $action['damage'] : [] as $d) {
            $dice = is_array($d) ? str_replace(' ', '', (string) ($d['damage_dice'] ?? '')) : '';
            if ($dice === '') {
                continue;
            }
            try {
                Dice::parse($dice);
            } catch (Throwable) {
                continue;
            }
            if (mb_strlen(implode('+', [...$parts, $dice])) > 40) {
                break;
            }
            $parts[] = $dice;
        }
        return implode('+', $parts);
    }
}
