<?php

declare(strict_types=1);

namespace Dnd\Controllers;

use Dnd\Access;
use Dnd\Db;
use Dnd\HttpError;
use Dnd\Ids;
use Dnd\Input;
use Dnd\Items;
use Dnd\Money;
use Dnd\Notifications;
use Dnd\Request;
use Dnd\Response;
use Dnd\Sheets;

/** Inventář, peníze, předávání mezi postavami a kouzla postavy. */
final class InventoryController
{
    private const COINS = ['cp', 'sp', 'ep', 'gp', 'pp'];

    // ------------------------------------------------------------------ položky

    /** Přidá item: buď z pravidel (ruleId), nebo vlastní. @param array{id:string} $user */
    public static function addItem(Request $req, array $params, array $user): Response
    {
        $char = Sheets::loadMutable($params['id'], $user);
        $id = self::createItem($char, $user, $req->json());
        return Response::json(['item' => self::find($id)], 201);
    }

    /**
     * Vytvoří item postavě z pravidel (ruleId) nebo vlastní a vrátí jeho id. Sdílí ho hráč i DM (rozdávání).
     * @param array<string, mixed> $char řádek postavy
     * @param array{id:string} $user
     * @param array<string, mixed> $in
     */
    public static function createItem(array $char, array $user, array $in): string
    {
        $base = [];
        if (isset($in['ruleId'])) {
            $rule = RulesController::visibleEntry(is_string($in['ruleId']) ? $in['ruleId'] : '', $user);
            if ($rule['campaign_id'] !== null && $rule['campaign_id'] !== $char['campaign_id']) {
                throw HttpError::validation('Tento záznam patří do jiné kampaně.', 'ruleId');
            }
            if (!in_array($rule['kind'], ['weapon', 'armor', 'equipment', 'magic_item'], true)) {
                throw HttpError::validation('Z tohoto druhu záznamu nejde vytvořit item.', 'ruleId');
            }
            $base = Items::fromRule($rule);
        }

        $given = Items::validate($in, create: $base === []);
        $item = self::merge($base, $given);
        $id = Ids::uuid();
        Db::exec(
            'INSERT INTO character_items (id, character_id, rule_id, name, description, kind, quantity, equipped, attuned, requires_attunement, consumable,
                rarity, stats, effects, notes, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())',
            [
                $id, $char['id'], $item['ruleId'] ?? null, $item['name'], $item['description'], $item['kind'], $item['quantity'],
                $item['requires_attunement'], $item['consumable'], $item['rarity'], Sheets::enc($item['stats']), Sheets::enc($item['effects']), $item['notes'],
            ],
        );
        return $id;
    }

    /** @param array{id:string} $user */
    public static function updateItem(Request $req, array $params, array $user): array
    {
        Sheets::loadMutable($params['id'], $user);
        $item = self::row($params['id'], $params['itemId']);
        $in = Items::validate($req->json(), create: false);

        Db::transaction(static function () use ($params, $item, $in): void {
            // Zámek postavy: souběžné attunementy se nesmí předběhnout a přesáhnout limit.
            Db::one('SELECT id FROM characters WHERE id = ? FOR UPDATE', [$params['id']]);
            $kind = $in['kind'] ?? $item['kind'];
            $requires = (int) ($in['requires_attunement'] ?? $item['requires_attunement']);

            if (($in['attuned'] ?? null) === 1) {
                if ($requires !== 1) {
                    throw HttpError::validation('Tento item nevyžaduje attunement.', 'attuned');
                }
                $others = (int) Db::value('SELECT COUNT(*) FROM character_items WHERE character_id = ? AND attuned = 1 AND id <> ?', [$params['id'], $item['id']]);
                if ($others >= Items::MAX_ATTUNED) {
                    throw HttpError::validation('Postava může být attunovaná k nejvýš ' . Items::MAX_ATTUNED . ' itemům.', 'attuned');
                }
            }
            // Zbroj a štít: nosí se jen jedna zbroj a jeden štít, nový kus nahradí předchozí.
            if (($in['equipped'] ?? null) === 1 && in_array($kind, ['armor', 'shield'], true)) {
                Db::exec('UPDATE character_items SET equipped = 0 WHERE character_id = ? AND kind = ? AND id <> ?', [$params['id'], $kind, $item['id']]);
            }

            $sets = [];
            $values = [];
            foreach (['name', 'description', 'kind', 'quantity', 'equipped', 'attuned', 'requires_attunement', 'consumable', 'rarity', 'notes'] as $column) {
                if (array_key_exists($column, $in)) {
                    $sets[] = "$column = ?";
                    $values[] = $in[$column];
                }
            }
            if (array_key_exists('effects', $in)) {
                $sets[] = 'effects = ?';
                $values[] = Sheets::enc($in['effects']);
            }
            if (array_key_exists('stats', $in)) {
                $sets[] = 'stats = ?';
                $values[] = Sheets::enc($in['stats']);
            }
            // Item, který už attunement nevyžaduje, o něj přijde.
            if ($requires === 0) {
                $sets[] = 'attuned = 0';
            }
            if ($sets !== []) {
                $sets[] = 'updated_at = UTC_TIMESTAMP()';
                $values[] = $item['id'];
                Db::exec('UPDATE character_items SET ' . implode(', ', $sets) . ' WHERE id = ?', $values);
            }
        });
        return ['item' => self::find($item['id'])];
    }

    /** @param array{id:string} $user */
    public static function deleteItem(Request $req, array $params, array $user): ?array
    {
        Sheets::loadMutable($params['id'], $user);
        $item = self::row($params['id'], $params['itemId']);
        Db::exec('DELETE FROM character_items WHERE id = ?', [$item['id']]);
        return null;
    }

    // ------------------------------------------------------------------ předání

    /**
     * Předá item (nebo jeho část) a/nebo peníze jiné postavě ve stejné kampani. Obě postavy se zamknou, takže se
     * souběžné převody nemohou předběhnout ani zdvojit.
     * @param array{id:string} $user
     */
    public static function transfer(Request $req, array $params, array $user): array
    {
        $from = Sheets::loadMutable($params['id'], $user);
        $in = $req->json();
        $toId = is_string($in['toCharacterId'] ?? null) ? $in['toCharacterId'] : '';
        $to = Ids::isUuid($toId) ? Db::one('SELECT id, campaign_id FROM characters WHERE id = ?', [$toId]) : null;
        if ($to === null || $to['campaign_id'] !== $from['campaign_id']) {
            throw HttpError::validation('Příjemce musí být postava ve stejné kampani.', 'toCharacterId');
        }
        if ($toId === $params['id']) {
            throw HttpError::validation('Nemůžeš předat sám sobě.', 'toCharacterId');
        }

        $itemId = $in['itemId'] ?? null;
        $coins = [];
        if (isset($in['currency'])) {
            if (!is_array($in['currency'])) {
                throw HttpError::validation('Peníze mají neplatný tvar.', 'currency');
            }
            foreach (self::COINS as $c) {
                $v = $in['currency'][$c] ?? 0;
                if (!is_int($v) || $v < 0 || $v > 1_000_000_000) {
                    throw HttpError::validation("Mince $c musí být celé číslo od 0.", 'currency');
                }
                $coins[$c] = $v;
            }
            if (array_sum($coins) === 0) {
                $coins = [];
            }
        }
        if ($itemId === null && $coins === []) {
            throw HttpError::validation('Vyber item nebo zadej peníze k předání.', 'itemId');
        }
        $quantity = Input::optionalInt($in, 'quantity', 1, 9999, 'Množství');

        $given = [];
        Db::transaction(static function () use ($params, $toId, $itemId, $coins, $quantity, &$given): void {
            $ids = [$params['id'], $toId];
            sort($ids);
            foreach ($ids as $id) {
                Db::one('SELECT id FROM characters WHERE id = ? FOR UPDATE', [$id]);
            }

            if ($itemId !== null) {
                $item = is_string($itemId) && Ids::isUuid($itemId)
                    ? Db::one('SELECT * FROM character_items WHERE id = ? AND character_id = ?', [$itemId, $params['id']])
                    : null;
                if ($item === null) {
                    throw HttpError::notFound('Item nenalezen.');
                }
                $qty = $quantity ?? (int) $item['quantity'];
                $given[] = $item['name'] . ($qty > 1 ? " ×$qty" : '');
                if ($qty > (int) $item['quantity']) {
                    throw HttpError::validation('Nemáš tolik kusů.', 'quantity');
                }
                if ($qty === (int) $item['quantity']) {
                    Db::exec('UPDATE character_items SET character_id = ?, equipped = 0, attuned = 0, updated_at = UTC_TIMESTAMP() WHERE id = ?', [$toId, $item['id']]);
                } else {
                    Db::exec('UPDATE character_items SET quantity = quantity - ?, updated_at = UTC_TIMESTAMP() WHERE id = ?', [$qty, $item['id']]);
                    Db::exec(
                        'INSERT INTO character_items (id, character_id, rule_id, name, description, kind, quantity, equipped, attuned, requires_attunement, consumable,
                            rarity, stats, effects, notes, created_at, updated_at)
                         VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())',
                        [Ids::uuid(), $toId, $item['rule_id'], $item['name'], $item['description'], $item['kind'], $qty, $item['requires_attunement'], $item['consumable'],
                            $item['rarity'], $item['stats'], $item['effects'], $item['notes']],
                    );
                }
            }

            if ($coins !== []) {
                $fromWallet = self::wallet((string) Db::value('SELECT currency FROM characters WHERE id = ?', [$params['id']]));
                $toWallet = self::wallet((string) Db::value('SELECT currency FROM characters WHERE id = ?', [$toId]));
                foreach ($coins as $c => $v) {
                    if ($fromWallet[$c] < $v) {
                        throw HttpError::validation("Nemáš dost mincí ($c).", 'currency');
                    }
                    $fromWallet[$c] -= $v;
                    $toWallet[$c] += $v;
                }
                $ordered = array_filter(array_reverse($coins, true), static fn (int $v): bool => $v > 0);
                $given[] = implode(', ', array_map(static fn (string $c, int $v): string => "$v $c", array_keys($ordered), $ordered));
                Db::exec('UPDATE characters SET currency = ?, updated_at = UTC_TIMESTAMP() WHERE id = ?', [Sheets::enc($fromWallet), $params['id']]);
                Db::exec('UPDATE characters SET currency = ?, updated_at = UTC_TIMESTAMP() WHERE id = ?', [Sheets::enc($toWallet), $toId]);
            }
        });

        $recipient = Db::one('SELECT owner_id, name FROM characters WHERE id = ?', [$toId]);
        if ($recipient !== null && $given !== []) {
            Notifications::push((string) $recipient['owner_id'], $user['id'], (string) $from['campaign_id'], $toId, 'transfer', $from['name'] . ' ti předal(a): ' . implode(' a ', $given));
        }

        $rows = Db::all('SELECT * FROM character_items WHERE character_id = ? ORDER BY created_at, id', [$params['id']]);
        $items = Items::loadMany($rows)[$params['id']] ?? [];
        return [
            'items' => $items,
            'currency' => self::wallet((string) Db::value('SELECT currency FROM characters WHERE id = ?', [$params['id']])),
        ];
    }

    /**
     * Utratí peníze (např. pivo u barmana, úplatek pro NPC): částka v mincích, zaplatí se s rozměněním a vrácením drobných.
     * Celé v transakci se zámkem postavy, takže se souběžná změna peněz (třeba od DM) neztratí.
     * @param array{id:string} $user
     */
    public static function spend(Request $req, array $params, array $user): array
    {
        Sheets::loadMutable($params['id'], $user);
        $in = $req->json();
        $cost = is_array($in['currency'] ?? null) ? $in['currency'] : null;
        if ($cost === null) {
            throw HttpError::validation('Zadej částku.', 'currency');
        }
        $costCp = 0;
        foreach (self::COINS as $c) {
            $v = $cost[$c] ?? 0;
            if (!is_int($v) || $v < 0 || $v > 1_000_000_000) {
                throw HttpError::validation("Mince $c musí být celé číslo od 0.", 'currency');
            }
            $costCp += $v * Money::VALUE[$c];
        }
        if ($costCp <= 0) {
            throw HttpError::validation('Zadej, kolik chceš utratit.', 'currency');
        }
        $note = Input::optionalString($in, 'note', 100, 'Poznámka') ?? '';

        $result = Db::transaction(static function () use ($params, $costCp): array {
            $row = Db::one('SELECT currency FROM characters WHERE id = ? FOR UPDATE', [$params['id']]) ?? throw HttpError::notFound();
            $before = self::wallet((string) $row['currency']);
            $after = Money::pay($before, $costCp);
            if ($after === null) {
                $have = Money::totalCp($before);
                throw HttpError::validation('Nemáš dost peněz: potřebuješ ' . self::formatCp($costCp) . ', máš ' . self::formatCp($have) . '.', 'currency');
            }
            Db::exec('UPDATE characters SET currency = ?, rev = rev + 1, updated_at = UTC_TIMESTAMP() WHERE id = ?', [Sheets::enc($after), $params['id']]);
            return ['currency' => $after, 'spentCp' => $costCp, 'note' => ''];
        });
        $result['note'] = $note;
        return $result;
    }

    /** "5 gp 3 sp" z mědáků (jen pro hlášky). */
    private static function formatCp(int $cp): string
    {
        $parts = [];
        foreach (['gp' => 100, 'sp' => 10, 'cp' => 1] as $c => $v) {
            if (intdiv($cp, $v) > 0) {
                $parts[] = intdiv($cp, $v) . " $c";
                $cp %= $v;
            }
        }
        return $parts === [] ? '0 cp' : implode(' ', $parts);
    }

    // ------------------------------------------------------------------ kouzla

    /** @param array{id:string} $user */
    public static function addSpell(Request $req, array $params, array $user): Response
    {
        $char = Sheets::loadMutable($params['id'], $user);
        $in = $req->json();
        $rule = RulesController::visibleEntry(is_string($in['ruleId'] ?? null) ? $in['ruleId'] : '', $user);
        if ($rule['kind'] !== 'spell') {
            throw HttpError::validation('Vyber kouzlo.', 'ruleId');
        }
        if ($rule['campaign_id'] !== null && $rule['campaign_id'] !== $char['campaign_id']) {
            throw HttpError::validation('Toto kouzlo patří do jiné kampaně.', 'ruleId');
        }
        $classIdx = $in['classIdx'] ?? '';
        if (!is_string($classIdx) || ($classIdx !== '' && Db::value('SELECT 1 FROM character_levels WHERE character_id = ? AND class_idx = ? LIMIT 1', [$params['id'], $classIdx]) === null)) {
            throw HttpError::validation('Postava nemá tuto třídu.', 'classIdx');
        }
        $prepared = array_key_exists('prepared', $in) ? ($in['prepared'] === true) : ((int) $rule['level'] === 0);

        $id = Ids::uuid();
        try {
            Db::exec(
                "INSERT INTO character_spells (id, character_id, rule_id, class_idx, prepared, always_prepared, source, created_at)
                 VALUES (?, ?, ?, ?, ?, 0, ?, UTC_TIMESTAMP())",
                [$id, $params['id'], $rule['id'], $classIdx, $prepared ? 1 : 0, $classIdx === '' ? 'other' : 'class'],
            );
        } catch (\PDOException $e) {
            if ((int) ($e->errorInfo[1] ?? 0) === 1062) {
                throw new HttpError(409, 'already_known', 'Tohle kouzlo už postava má.');
            }
            throw $e;
        }
        return Response::json(['spells' => self::spellsOf($params['id'])], 201);
    }

    /** @param array{id:string} $user */
    public static function updateSpell(Request $req, array $params, array $user): array
    {
        Sheets::loadMutable($params['id'], $user);
        $spell = Ids::isUuid($params['spellId']) ? Db::one('SELECT id FROM character_spells WHERE id = ? AND character_id = ?', [$params['spellId'], $params['id']]) : null;
        if ($spell === null) {
            throw HttpError::notFound('Kouzlo nenalezeno.');
        }
        $in = $req->json();
        $sets = [];
        $values = [];
        foreach (['prepared' => 'prepared', 'alwaysPrepared' => 'always_prepared'] as $key => $column) {
            if (array_key_exists($key, $in)) {
                if (!is_bool($in[$key])) {
                    throw HttpError::validation("$key musí být true/false.", $key);
                }
                $sets[] = "$column = ?";
                $values[] = $in[$key] ? 1 : 0;
            }
        }
        if ($sets !== []) {
            $values[] = $spell['id'];
            Db::exec('UPDATE character_spells SET ' . implode(', ', $sets) . ' WHERE id = ?', $values);
        }
        return ['spells' => self::spellsOf($params['id'])];
    }

    /** @param array{id:string} $user */
    public static function deleteSpell(Request $req, array $params, array $user): ?array
    {
        Sheets::loadMutable($params['id'], $user);
        $deleted = Ids::isUuid($params['spellId']) ? Db::exec('DELETE FROM character_spells WHERE id = ? AND character_id = ?', [$params['spellId'], $params['id']]) : 0;
        if ($deleted === 0) {
            throw HttpError::notFound('Kouzlo nenalezeno.');
        }
        return null;
    }

    // ------------------------------------------------------------------ pomocné

    /** @return list<array<string, mixed>> */
    private static function spellsOf(string $characterId): array
    {
        $row = Db::one('SELECT * FROM characters WHERE id = ?', [$characterId]) ?? throw HttpError::notFound();
        return Sheets::loadMany([$row])[$characterId]['spells'] ?? [];
    }

    /** @return array<string, int> */
    private static function wallet(string $json): array
    {
        $c = Sheets::json($json, []);
        $c = is_array($c) ? $c : [];
        $out = [];
        foreach (self::COINS as $coin) {
            $out[$coin] = (int) ($c[$coin] ?? 0);
        }
        return $out;
    }

    /** @return array<string, mixed> */
    private static function row(string $characterId, string $itemId): array
    {
        $row = Ids::isUuid($itemId) ? Db::one('SELECT * FROM character_items WHERE id = ? AND character_id = ?', [$itemId, $characterId]) : null;
        return $row ?? throw HttpError::notFound('Item nenalezen.');
    }

    /** @return array<string, mixed> */
    private static function find(string $itemId): array
    {
        $row = Db::one('SELECT * FROM character_items WHERE id = ?', [$itemId]) ?? throw HttpError::notFound();
        return Items::loadMany([$row])[$row['character_id']][0];
    }

    /**
     * Slije výchozí hodnoty z pravidel s tím, co poslal klient (klient má přednost).
     * @param array<string, mixed> $base  tvar z Items::fromRule (camelCase)
     * @param array<string, mixed> $given tvar z Items::validate (sloupce)
     * @return array<string, mixed>
     */
    private static function merge(array $base, array $given): array
    {
        return [
            'ruleId' => $base['ruleId'] ?? null,
            'name' => $given['name'] ?? $base['name'],
            'description' => $given['description'] ?? ($base['description'] ?? ''),
            'kind' => $given['kind'] ?? ($base['kind'] ?? 'item'),
            'quantity' => $given['quantity'] ?? 1,
            'requires_attunement' => $given['requires_attunement'] ?? (int) ($base['requiresAttunement'] ?? false),
            'consumable' => $given['consumable'] ?? (int) ($base['consumable'] ?? false),
            'rarity' => array_key_exists('rarity', $given) ? $given['rarity'] : ($base['rarity'] ?? null),
            'stats' => $given['stats'] ?? ($base['stats'] ?? []),
            'effects' => $given['effects'] ?? ($base['effects'] ?? []),
            'notes' => $given['notes'] ?? '',
        ];
    }
}
