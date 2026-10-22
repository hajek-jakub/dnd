<?php

declare(strict_types=1);

namespace Dnd;

/**
 * Taktiky postavy: validace a normalizace dat podle typu a hromadná výměna (seed).
 * Tvar `data` podle typu (neznámá pole se zahodí, chybějící dostanou výchozí hodnotu):
 *  - attack:  rage (při Rage se přičte bonus barbara), sneak (při zapnutém Sneak Attack se přidají jeho kostky), actionType, toHit ("d20+8"), damage ("1d8+5 + 1d4 fire"), roll (výraz pro hod zranění, jinak se odvodí z damage), range, usage, note, cost, hex (platí Hex),
 *             count (kolik útoků jedno použití provede, 1 až 10), ammo (id itemu postavy, kterým se střílí: každý útok ubere 1 kus)
 *  - spell:   level (0 až 9), actionType, range, duration, concentration, save ("WIS DC 14"), effect, roll, toHit (kouzelný útok), count, cost
 *  - ki:      actionType, cost, description, toHit, damage, roll, count, hex (jako u útoku; Flurry of Blows má 2 údery)
 *  - passive: type (passive | reaction), description, cost
 *  - combo:   steps (pořadí kroků), expectedDamage, cost, highlight, description,
 *             uses (útoky, kouzla a ki schopnosti, které kombo provede: [{id, count}], id je taktika téže postavy)
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
                'count' => self::count($in), 'ammo' => self::ammo($in), 'rage' => $bool('rage', false), 'sneak' => $bool('sneak', false),
            ],
            'spell' => [
                'level' => self::level($in), 'actionType' => $action, 'range' => $d('range', 80, 'Dosah'), 'duration' => $d('duration', 120, 'Trvání'),
                'concentration' => $bool('concentration', false), 'save' => $d('save', 60, 'Záchranný hod'), 'effect' => $d('effect', 2000, 'Efekt'), 'roll' => $d('roll', 80, 'Hod zranění'), 'cost' => $cost,
                'toHit' => $d('toHit', 40, 'Útok'), 'count' => self::count($in),
            ],
            'ki' => [
                'actionType' => $action, 'cost' => $cost, 'description' => $d('description', 2000, 'Popis'),
                'toHit' => $d('toHit', 40, 'Útok'), 'damage' => $d('damage', 160, 'Zranění'), 'roll' => $d('roll', 80, 'Hod zranění'), 'count' => self::count($in), 'hex' => $bool('hex', false),
                'rage' => $bool('rage', false), 'sneak' => $bool('sneak', false),
            ],
            'passive' => ['type' => self::passiveType($in), 'description' => $d('description', 2000, 'Popis'), 'cost' => $cost],
            'combo' => [
                'steps' => self::steps($in), 'expectedDamage' => $d('expectedDamage', 80, 'Očekávané zranění'), 'cost' => $cost,
                'highlight' => $bool('highlight', false), 'description' => $d('description', 1000, 'Popis'), 'uses' => self::uses($in),
            ],
            'rule' => ['text' => Input::string($in, 'text', 1, 2000, 'Text')],
        };
        return ['title' => $title, 'data' => $data];
    }

    /** @param array<string, mixed> $in */
    private static function count(array $in): int
    {
        $c = $in['count'] ?? 1;
        if (!is_int($c) || $c < 1 || $c > 10) {
            throw HttpError::validation('Počet útoků musí být 1 až 10.', 'count');
        }
        return $c;
    }

    /** @param array<string, mixed> $in */
    private static function ammo(array $in): string
    {
        $a = $in['ammo'] ?? '';
        if ($a === null || $a === '') {
            return '';
        }
        if (!is_string($a) || !Ids::isUuid($a)) {
            throw HttpError::validation('Munice musí být item postavy.', 'ammo');
        }
        return $a;
    }

    /**
     * @param array<string, mixed> $in
     * @return list<array{id: string, count: int}>
     */
    private static function uses(array $in): array
    {
        $list = $in['uses'] ?? [];
        if (!is_array($list) || count($list) > 12) {
            throw HttpError::validation('Kombo může použít nejvýš 12 položek.', 'uses');
        }
        $out = [];
        foreach ($list as $u) {
            $id = is_array($u) && is_string($u['id'] ?? null) ? $u['id'] : '';
            $count = is_array($u) ? ($u['count'] ?? 1) : 1;
            if (!Ids::isUuid($id) || !is_int($count) || $count < 1 || $count > 10) {
                throw HttpError::validation('Položka komba musí mít id taktiky a počet 1 až 10.', 'uses');
            }
            $out[] = ['id' => $id, 'count' => $count];
        }
        return $out;
    }

    /**
     * Ověří odkazy na jiné věci postavy: munice musí být její item, kombo smí používat jen její útoky, kouzla a ki schopnosti.
     * @param array<string, mixed> $data zvalidovaná data (výstup normalize)
     */
    public static function checkRefs(string $characterId, array $data): void
    {
        if (is_string($data['ammo'] ?? null) && $data['ammo'] !== '' && Db::one('SELECT id FROM character_items WHERE id = ? AND character_id = ?', [$data['ammo'], $characterId]) === null) {
            throw HttpError::validation('Munice musí být item této postavy.', 'ammo');
        }
        foreach (is_array($data['uses'] ?? null) ? $data['uses'] : [] as $u) {
            if (Db::one("SELECT id FROM character_tactics WHERE id = ? AND character_id = ? AND kind IN ('attack', 'spell', 'ki')", [$u['id'], $characterId]) === null) {
                throw HttpError::validation('Kombo smí používat jen útoky, kouzla a ki schopnosti téže postavy.', 'uses');
            }
        }
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
     * Smaže všechny taktiky postavy a vloží nové (seed, idempotentní). Položky jsou zvalidované z `plan()`: {kind, title, data, refs?}.
     * `refs` jsou odkazy ze seedu podle názvu: `ammoItem` (název itemu postavy, kterým se střílí) a `uses` ([{title, count}] u komb).
     * Nejdřív se vloží všechno kromě komb, aby kombo mohlo odkazovat na id útoků, kouzel a ki schopností.
     * @param list<array<string, mixed>> $tactics
     */
    public static function replaceAll(string $characterId, array $tactics): void
    {
        Db::exec('DELETE FROM character_tactics WHERE character_id = ?', [$characterId]);
        $positions = [];
        $byTitle = [];
        $ordered = [...array_filter($tactics, static fn (array $t): bool => $t['kind'] !== 'combo'), ...array_filter($tactics, static fn (array $t): bool => $t['kind'] === 'combo')];
        foreach ($ordered as $t) {
            $data = $t['data'];
            $refs = is_array($t['refs'] ?? null) ? $t['refs'] : [];
            if (is_string($refs['ammoItem'] ?? null) && $refs['ammoItem'] !== '') {
                $item = Db::one('SELECT id FROM character_items WHERE character_id = ? AND LOWER(name) = LOWER(?) ORDER BY created_at LIMIT 1', [$characterId, $refs['ammoItem']]);
                if ($item === null) {
                    throw HttpError::validation("Munice \"{$refs['ammoItem']}\" (taktika \"{$t['title']}\") není v inventáři postavy.", 'ammo');
                }
                $data['ammo'] = (string) $item['id'];
            }
            foreach (is_array($refs['uses'] ?? null) ? $refs['uses'] : [] as $u) {
                $target = $byTitle[mb_strtolower((string) ($u['title'] ?? ''))] ?? null;
                if ($target === null) {
                    throw HttpError::validation("Kombo \"{$t['title']}\" odkazuje na neexistující taktiku \"" . ($u['title'] ?? '') . '".', 'uses');
                }
                $data['uses'][] = ['id' => $target, 'count' => (int) ($u['count'] ?? 1)];
            }
            $id = Ids::uuid();
            $pos = $positions[$t['kind']] = ($positions[$t['kind']] ?? -1) + 1;
            Db::exec(
                'INSERT INTO character_tactics (id, character_id, kind, position, title, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())',
                [$id, $characterId, $t['kind'], $pos, $t['title'], json_encode($data, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR)],
            );
            $byTitle[mb_strtolower((string) $t['title'])] ??= $id;
        }
    }

    /** Klíče v seedu ("attacks", ...) na druhy. */
    public const SEED_KEYS = ['attacks' => 'attack', 'spells' => 'spell', 'ki' => 'ki', 'passives' => 'passive', 'combos' => 'combo', 'rules' => 'rule'];
}
