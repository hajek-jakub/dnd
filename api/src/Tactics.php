<?php

declare(strict_types=1);

namespace Dnd;

/**
 * Taktiky postavy: validace a normalizace dat podle typu a hromadná výměna (seed).
 * Tvar `data` podle typu (neznámá pole se zahodí, chybějící dostanou výchozí hodnotu):
 *  - attack:  actionType, toHit ("d20+8"), damage ("1d8+5 + 1d4 fire"), roll (výraz pro hod zranění, jinak se odvodí z damage), range, usage, note, cost, hex (platí Hex)
 *  - spell:   level (0 až 9), actionType, range, duration, concentration, save ("WIS DC 14"), effect, roll, cost
 *  - ki:      actionType, cost, description
 *  - passive: type (passive | reaction), description, cost
 *  - combo:   steps (pořadí kroků), expectedDamage, cost, highlight, description
 *  - rule:    text
 * cost: "free", "ki:N" nebo "slot:N".
 */
final class Tactics
{
    public const KINDS = ['attack', 'spell', 'ki', 'passive', 'combo', 'rule'];
    public const ACTION_TYPES = ['action', 'bonus', 'reaction', 'free', 'none'];
    public const MAX_PER_CHARACTER = 200;

    /**
     * @param array<string, mixed> $in
     * @return array{title: string, data: array<string, mixed>}
     */
    public static function normalize(string $kind, array $in): array
    {
        if (!in_array($kind, self::KINDS, true)) {
            throw HttpError::validation('Neznámý druh taktiky.', 'kind');
        }
        $title = Input::string($in, 'title', 1, 120, 'Název');
        $d = static fn (string $key, int $max, string $label): string => Input::optionalString($in, $key, $max, $label) ?? '';
        $bool = static function (string $key, bool $default) use ($in): bool {
            if (!array_key_exists($key, $in)) {
                return $default;
            }
            if (!is_bool($in[$key])) {
                throw HttpError::validation("$key musí být true/false.", $key);
            }
            return $in[$key];
        };
        $cost = self::cost($in);
        $action = self::actionType($in);

        $data = match ($kind) {
            'attack' => [
                'actionType' => $action, 'toHit' => $d('toHit', 40, 'Útok'), 'damage' => $d('damage', 160, 'Zranění'), 'roll' => $d('roll', 80, 'Hod zranění'), 'range' => $d('range', 160, 'Dostřel'),
                'usage' => $d('usage', 400, 'Kdy použít'), 'note' => $d('note', 600, 'Poznámka'), 'cost' => $cost, 'hex' => $bool('hex', true),
            ],
            'spell' => [
                'level' => self::level($in), 'actionType' => $action, 'range' => $d('range', 80, 'Dosah'), 'duration' => $d('duration', 120, 'Trvání'),
                'concentration' => $bool('concentration', false), 'save' => $d('save', 60, 'Záchranný hod'), 'effect' => $d('effect', 2000, 'Efekt'), 'roll' => $d('roll', 80, 'Hod zranění'), 'cost' => $cost,
            ],
            'ki' => ['actionType' => $action, 'cost' => $cost, 'description' => $d('description', 2000, 'Popis')],
            'passive' => ['type' => self::passiveType($in), 'description' => $d('description', 2000, 'Popis'), 'cost' => $cost],
            'combo' => [
                'steps' => self::steps($in), 'expectedDamage' => $d('expectedDamage', 80, 'Očekávané zranění'), 'cost' => $cost,
                'highlight' => $bool('highlight', false), 'description' => $d('description', 1000, 'Popis'),
            ],
            'rule' => ['text' => Input::string($in, 'text', 1, 2000, 'Text')],
        };
        return ['title' => $title, 'data' => $data];
    }

    /** @param array<string, mixed> $in */
    private static function cost(array $in): string
    {
        $c = $in['cost'] ?? 'free';
        if (!is_string($c) || preg_match('/^(free|ki:[1-9][0-9]?|slot:[1-9])$/', $c) !== 1) {
            throw HttpError::validation('Cena musí být "free", "ki:N" nebo "slot:N".', 'cost');
        }
        return $c;
    }

    /** @param array<string, mixed> $in */
    private static function actionType(array $in): string
    {
        $a = $in['actionType'] ?? 'action';
        if (!is_string($a) || !in_array($a, self::ACTION_TYPES, true)) {
            throw HttpError::validation('Typ akce musí být action, bonus, reaction, free nebo none.', 'actionType');
        }
        return $a;
    }

    /** @param array<string, mixed> $in */
    private static function level(array $in): int
    {
        $l = $in['level'] ?? 0;
        if (!is_int($l) || $l < 0 || $l > 9) {
            throw HttpError::validation('Úroveň kouzla musí být 0 až 9.', 'level');
        }
        return $l;
    }

    /** @param array<string, mixed> $in */
    private static function passiveType(array $in): string
    {
        $t = $in['type'] ?? 'passive';
        if ($t !== 'passive' && $t !== 'reaction') {
            throw HttpError::validation("Typ musí být 'passive' nebo 'reaction'.", 'type');
        }
        return $t;
    }

    /**
     * @param array<string, mixed> $in
     * @return list<string>
     */
    private static function steps(array $in): array
    {
        $steps = $in['steps'] ?? [];
        if (!is_array($steps) || count($steps) > 12) {
            throw HttpError::validation('Komba má nejvýš 12 kroků.', 'steps');
        }
        $out = [];
        foreach ($steps as $step) {
            if (!is_string($step) || trim($step) === '' || mb_strlen($step) > 400) {
                throw HttpError::validation('Každý krok musí být neprázdný text do 400 znaků.', 'steps');
            }
            $out[] = trim($step);
        }
        return $out;
    }

    /**
     * Smaže všechny taktiky postavy a vloží nové (seed, idempotentní). Vstup je { attacks: [...], spells: [...], ki, passives, combos, rules }.
     * @param array<string, mixed> $tactics už zvalidované položky z `plan()`: list of {kind, title, data}
     */
    public static function replaceAll(string $characterId, array $tactics): void
    {
        Db::exec('DELETE FROM character_tactics WHERE character_id = ?', [$characterId]);
        $positions = [];
        foreach ($tactics as $t) {
            $pos = $positions[$t['kind']] = ($positions[$t['kind']] ?? -1) + 1;
            Db::exec(
                'INSERT INTO character_tactics (id, character_id, kind, position, title, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())',
                [Ids::uuid(), $characterId, $t['kind'], $pos, $t['title'], json_encode($t['data'], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR)],
            );
        }
    }

    /** Klíče v seedu ("attacks", ...) na druhy. */
    public const SEED_KEYS = ['attacks' => 'attack', 'spells' => 'spell', 'ki' => 'ki', 'passives' => 'passive', 'combos' => 'combo', 'rules' => 'rule'];
}
