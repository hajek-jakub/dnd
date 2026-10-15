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

/**
 * Akce DM nad postavami v kampani: rozdávání itemů, peněz, XP a inspirace, zranění a léčení (i skupinově),
 * stavy (conditions) a bonusy/efekty. Všechno je jen pro DM a každá změna pošle hráči oznámení.
 */
final class DmController
{
    private const COINS = ['cp', 'sp', 'ep', 'gp', 'pp'];
    private const DURATIONS = ['permanent', 'long_rest', 'manual'];
    private const EFFECT_LABELS = [
        'ac' => 'AC', 'speed' => 'rychlost', 'initiative' => 'iniciativa', 'hp.max' => 'max HP', 'hp.perLevel' => 'HP za level', 'proficiency' => 'proficiency',
        'passive.perception' => 'pasivní vnímání', 'attack.all' => 'útok', 'attack.melee' => 'útok na blízko', 'attack.ranged' => 'útok na dálku', 'damage.all' => 'zranění',
        'spell.dc' => 'spell DC', 'spell.attack' => 'útok kouzlem', 'save.all' => 'záchranné hody', 'skill.all' => 'dovednosti',
    ];

    // ------------------------------------------------------------------ rozdávání

    /** Přidá item (z pravidel nebo jednorázově vytvořený) jedné nebo více postavám. @param array{id:string} $user */
    public static function giveItem(Request $req, array $params, array $user): array
    {
        Access::requireDm($user, $params['id']);
        $in = $req->json();
        $itemInput = $in['item'] ?? null;
        if (!is_array($itemInput)) {
            throw HttpError::validation('Zadej item (ruleId nebo vlastní údaje).', 'item');
        }

        $names = Db::transaction(static function () use ($params, $user, $in, $itemInput): array {
            $chars = self::targets($params['id'], $in);
            $names = [];
            foreach ($chars as $char) {
                $itemId = InventoryController::createItem($char, $user, $itemInput);
                $item = Db::one('SELECT name, quantity FROM character_items WHERE id = ?', [$itemId]) ?? [];
                $label = $item['name'] . ((int) $item['quantity'] > 1 ? ' ×' . $item['quantity'] : '');
                $names[$char['id']] = $label;
                Notifications::push((string) $char['owner_id'], $user['id'], $params['id'], (string) $char['id'], 'item', 'DM ti dal: ' . $label);
            }
            return $names;
        });
        return ['given' => count($names)];
    }

    /**
     * Peníze družiny. `mode`: `give` (výchozí) přidá, `take` odebere (pokuta, nákup za družinu). Bez `split` dostane nebo zaplatí
     * každý celou částku, se `split: true` se částka rozdělí rovným dílem mezi vybrané. Volitelné `reason` jde do oznámení hráči.
     * Odebírání je „vše, nebo nic“: když některá postava nemá na svůj díl, nezmění se nikomu nic.
     * @param array{id:string} $user
     */
    public static function giveCurrency(Request $req, array $params, array $user): array
    {
        Access::requireDm($user, $params['id']);
        $in = $req->json();
        $mode = $in['mode'] ?? 'give';
        if ($mode !== 'give' && $mode !== 'take') {
            throw HttpError::validation('Režim musí být give nebo take.', 'mode');
        }
        $split = ($in['split'] ?? false) === true;
        $reason = Input::optionalString($in, 'reason', 120, 'Důvod') ?? '';
        $coins = [];
        $c = $in['currency'] ?? null;
        if (!is_array($c)) {
            throw HttpError::validation('Zadej peníze.', 'currency');
        }
        foreach (self::COINS as $coin) {
            $v = $c[$coin] ?? 0;
            if (!is_int($v) || $v < 0 || $v > 1_000_000_000) {
                throw HttpError::validation("Mince $coin musí být celé číslo od 0.", 'currency');
            }
            if ($v > 0) {
                $coins[$coin] = $v;
            }
        }
        if ($coins === []) {
            throw HttpError::validation('Zadej aspoň jednu minci.', 'currency');
        }

        $result = Db::transaction(static function () use ($params, $user, $in, $coins, $mode, $split, $reason): array {
            $chars = self::targets($params['id'], $in);
            $n = count($chars);
            $suffix = $reason !== '' ? " ($reason)" : '';
            $leftoverCp = 0;
            $share = $coins; // díl jedné postavy: mince (give) nebo částka v mědácích (take)
            $eachCp = Money::totalCp($coins);
            if ($split && $n > 1) {
                if ($mode === 'give') {
                    [$share, $leftoverCp] = Money::splitCoins($coins, $n);
                    $eachCp = Money::totalCp($share);
                } else {
                    $eachCp = intdiv($eachCp, $n);
                    $leftoverCp = Money::totalCp($coins) - $eachCp * $n;
                }
                if ($eachCp < 1) {
                    throw HttpError::validation('Částka je na tolik postav příliš malá, na každého by nezbyl ani měďák.', 'currency');
                }
            }
            $text = self::coinText($mode === 'give' ? $share : Money::fromCp($eachCp));

            $broke = [];
            $wallets = [];
            foreach ($chars as $char) {
                $wallet = Sheets::json($char['currency'], []);
                $wallet = is_array($wallet) ? $wallet : [];
                foreach (self::COINS as $coin) {
                    $wallet[$coin] = (int) ($wallet[$coin] ?? 0);
                }
                if ($mode === 'give') {
                    foreach (self::COINS as $coin) {
                        $wallet[$coin] += $share[$coin] ?? 0;
                    }
                } else {
                    $paid = Money::pay($wallet, $eachCp);
                    if ($paid === null) {
                        $broke[] = (string) $char['name'];
                        continue;
                    }
                    $wallet = $paid;
                }
                $wallets[$char['id']] = $wallet;
            }
            if ($broke !== []) {
                throw HttpError::validation('Nemá dost peněz: ' . implode(', ', $broke) . '. Nikomu se nic neodebralo.', 'currency');
            }
            foreach ($chars as $char) {
                Db::exec('UPDATE characters SET currency = ?, updated_at = UTC_TIMESTAMP() WHERE id = ?', [Sheets::enc($wallets[$char['id']]), $char['id']]);
                $msg = $mode === 'give'
                    ? ($split && $n > 1 ? "DM ti dal tvůj díl peněz: $text$suffix" : "DM ti dal peníze: $text$suffix")
                    : "DM ti vzal peníze: $text$suffix";
                Notifications::push((string) $char['owner_id'], $user['id'], $params['id'], (string) $char['id'], 'currency', $msg);
            }
            return ['given' => $n, 'mode' => $mode, 'each' => $mode === 'give' ? $share : Money::fromCp($eachCp), 'eachCp' => $eachCp, 'leftoverCp' => $leftoverCp];
        });
        return $result;
    }

    /** @param array<string, int> $coins */
    private static function coinText(array $coins): string
    {
        $parts = [];
        foreach (array_reverse(self::COINS) as $coin) {
            if (($coins[$coin] ?? 0) > 0) {
                $parts[] = $coins[$coin] . " $coin";
            }
        }
        return implode(', ', $parts);
    }

    /** XP: každému celou částku, nebo rozdělit rovným dílem mezi vybrané. @param array{id:string} $user */
    public static function giveXp(Request $req, array $params, array $user): array
    {
        Access::requireDm($user, $params['id']);
        $in = $req->json();
        $amount = Input::optionalInt($in, 'amount', 1, 10_000_000, 'XP') ?? throw HttpError::validation('Zadej počet XP.', 'amount');
        $split = ($in['split'] ?? false) === true;

        $each = Db::transaction(static function () use ($params, $user, $in, $amount, $split): int {
            $chars = self::targets($params['id'], $in);
            $each = $split ? intdiv($amount, max(1, count($chars))) : $amount;
            foreach ($chars as $char) {
                Db::exec('UPDATE characters SET xp = LEAST(10000000, COALESCE(xp, 0) + ?), updated_at = UTC_TIMESTAMP() WHERE id = ?', [$each, $char['id']]);
                Notifications::push((string) $char['owner_id'], $user['id'], $params['id'], (string) $char['id'], 'xp', "DM ti dal $each XP");
            }
            return $each;
        });
        return ['eachGets' => $each];
    }

    /** Inspirace. @param array{id:string} $user */
    public static function setInspiration(Request $req, array $params, array $user): array
    {
        Access::requireDm($user, $params['id']);
        $in = $req->json();
        if (!is_bool($in['set'] ?? null)) {
            throw HttpError::validation('Zadej set: true/false.', 'set');
        }
        $set = $in['set'];
        $count = Db::transaction(static function () use ($params, $user, $in, $set): int {
            $chars = self::targets($params['id'], $in);
            foreach ($chars as $char) {
                Db::exec('UPDATE characters SET inspiration = ?, updated_at = UTC_TIMESTAMP() WHERE id = ?', [$set ? 1 : 0, $char['id']]);
                Notifications::push((string) $char['owner_id'], $user['id'], $params['id'], (string) $char['id'], 'inspiration', $set ? 'DM ti dal inspiraci' : 'DM ti vzal inspiraci');
            }
            return count($chars);
        });
        return ['changed' => $count];
    }

    // ------------------------------------------------------------------ zranění, léčení, stavy

    /**
     * Zranění (záporná hodnota) nebo léčení (kladná) vybraným postavám. Maximum HP posílá klient po postavě, protože
     * server pravidla nepočítá: targets = [{characterId, max}].
     * @param array{id:string} $user
     */
    public static function hp(Request $req, array $params, array $user): array
    {
        Access::requireDm($user, $params['id']);
        $in = $req->json();
        $delta = $in['delta'] ?? null;
        if (!is_int($delta) || $delta === 0 || abs($delta) > 100000) {
            throw HttpError::validation('Zadej nenulové zranění nebo léčení.', 'delta');
        }
        $targets = $in['targets'] ?? null;
        if (!is_array($targets) || $targets === [] || count($targets) > 30) {
            throw HttpError::validation('Vyber 1 až 30 postav.', 'targets');
        }
        $maxById = [];
        foreach ($targets as $t) {
            $id = is_array($t) && is_string($t['characterId'] ?? null) ? $t['characterId'] : '';
            $max = is_array($t) ? ($t['max'] ?? null) : null;
            if (!Ids::isUuid($id) || !is_int($max) || $max < 1 || $max > 100000) {
                throw HttpError::validation('Neplatná postava nebo maximum HP.', 'targets');
            }
            $maxById[$id] = $max;
        }

        $result = Db::transaction(static function () use ($params, $user, $delta, $maxById): array {
            $chars = self::targets($params['id'], ['characterIds' => array_keys($maxById)]);
            $out = [];
            foreach ($chars as $char) {
                $new = Sheets::applyHp($char['hp_current'] === null ? null : (int) $char['hp_current'], (int) $char['hp_temp'], $delta, $maxById[$char['id']]);
                Db::exec('UPDATE characters SET hp_current = ?, hp_temp = ?, updated_at = UTC_TIMESTAMP() WHERE id = ?', [$new['hp'], $new['temp'], $char['id']]);
                $out[$char['id']] = $new['hp'];
                $text = $delta < 0 ? 'DM ti způsobil ' . (-$delta) . ' zranění' : 'DM tě vyléčil o ' . $delta . ' HP';
                Notifications::push((string) $char['owner_id'], $user['id'], $params['id'], (string) $char['id'], 'hp', $text);
            }
            return $out;
        });
        return ['hp' => $result];
    }

    /** Nastaví dočasná HP (0 je zruší); dočasná HP se nesčítají, platí nová hodnota. @param array{id:string} $user */
    public static function tempHp(Request $req, array $params, array $user): array
    {
        Access::requireDm($user, $params['id']);
        $in = $req->json();
        $amount = $in['amount'] ?? null;
        if (!is_int($amount) || $amount < 0 || $amount > 100000) {
            throw HttpError::validation('Dočasná HP musí být celé číslo od 0.', 'amount');
        }
        $count = Db::transaction(static function () use ($params, $user, $in, $amount): int {
            $chars = self::targets($params['id'], $in);
            foreach ($chars as $char) {
                Db::exec('UPDATE characters SET hp_temp = ?, updated_at = UTC_TIMESTAMP() WHERE id = ?', [$amount, $char['id']]);
                Notifications::push(
                    (string) $char['owner_id'],
                    $user['id'],
                    $params['id'],
                    (string) $char['id'],
                    'hp',
                    $amount > 0 ? "DM ti nastavil dočasná HP: $amount" : 'DM ti zrušil dočasná HP',
                );
            }
            return count($chars);
        });
        return ['changed' => $count];
    }

    /** Nastaví nebo zruší stav (condition). @param array{id:string} $user */
    public static function condition(Request $req, array $params, array $user): array
    {
        Access::requireDm($user, $params['id']);
        $in = $req->json();
        $name = Input::string($in, 'name', 1, 40, 'Stav');
        if (!is_bool($in['set'] ?? null)) {
            throw HttpError::validation('Zadej set: true/false.', 'set');
        }
        $set = $in['set'];
        $count = Db::transaction(static function () use ($params, $user, $in, $name, $set): int {
            $chars = self::targets($params['id'], $in);
            foreach ($chars as $char) {
                $list = Sheets::json($char['conditions'], []);
                $list = array_values(array_diff(is_array($list) ? $list : [], [$name]));
                if ($set) {
                    $list[] = $name;
                }
                Db::exec('UPDATE characters SET conditions = ?, updated_at = UTC_TIMESTAMP() WHERE id = ?', [Sheets::enc($list), $char['id']]);
                Notifications::push((string) $char['owner_id'], $user['id'], $params['id'], (string) $char['id'], 'condition', ($set ? 'DM ti nastavil stav: ' : 'DM ti zrušil stav: ') . $name);
            }
            return count($chars);
        });
        return ['changed' => $count];
    }

    // ------------------------------------------------------------------ efekty

    /** Přidá bonus nebo efekt postavám (cíl, hodnota, popis, trvání). @param array{id:string} $user */
    public static function addEffect(Request $req, array $params, array $user): Response
    {
        Access::requireDm($user, $params['id']);
        $in = $req->json();
        $effect = Items::effects([['target' => $in['target'] ?? null, 'value' => $in['value'] ?? null]])[0];
        $source = Input::string($in, 'source', 1, 100, 'Popis nebo zdroj');
        $duration = $in['duration'] ?? 'manual';
        if (!is_string($duration) || !in_array($duration, self::DURATIONS, true)) {
            throw HttpError::validation('Trvání musí být permanent, long_rest nebo manual.', 'duration');
        }
        if ($effect['value'] === 0) {
            throw HttpError::validation('Hodnota efektu nesmí být 0.', 'value');
        }

        $count = Db::transaction(static function () use ($params, $user, $in, $effect, $source, $duration): int {
            $chars = self::targets($params['id'], $in);
            foreach ($chars as $char) {
                Db::exec(
                    'INSERT INTO character_effects (id, character_id, target, value, source, duration, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP())',
                    [Ids::uuid(), $char['id'], $effect['target'], $effect['value'], $source, $duration, $user['id']],
                );
                Db::exec('UPDATE characters SET rev = rev + 1 WHERE id = ?', [$char['id']]);
                Notifications::push((string) $char['owner_id'], $user['id'], $params['id'], (string) $char['id'], 'effect', 'DM ti přidal bonus: ' . self::describe($effect['target'], $effect['value']) . " ($source)");
            }
            return count($chars);
        });
        return Response::json(['added' => $count], 201);
    }

    /** Zruší efekt (jen DM). @param array{id:string} $user */
    public static function removeEffect(Request $req, array $params, array $user): ?array
    {
        $effect = Ids::isUuid($params['effectId']) ? Db::one(
            'SELECT e.id, e.target, e.value, e.source, c.id AS character_id, c.campaign_id, c.owner_id FROM character_effects e JOIN characters c ON c.id = e.character_id WHERE e.id = ?',
            [$params['effectId']],
        ) : null;
        if ($effect === null) {
            throw HttpError::notFound('Efekt nenalezen.');
        }
        Access::requireDm($user, (string) $effect['campaign_id']);
        Db::exec('DELETE FROM character_effects WHERE id = ?', [$effect['id']]);
        Notifications::push((string) $effect['owner_id'], $user['id'], (string) $effect['campaign_id'], (string) $effect['character_id'], 'effect', 'DM zrušil bonus: ' . self::describe((string) $effect['target'], (int) $effect['value']) . ' (' . $effect['source'] . ')');
        return null;
    }

    /** Po long restu zmizí efekty s trváním "do long restu". Smí majitel i DM. @param array{id:string} $user */
    public static function expireLongRestEffects(Request $req, array $params, array $user): array
    {
        Sheets::loadMutable($params['id'], $user);
        $n = Db::exec("DELETE FROM character_effects WHERE character_id = ? AND duration = 'long_rest'", [$params['id']]);
        return ['removed' => $n];
    }

    // ------------------------------------------------------------------ pomocné

    /**
     * Načte (a zamkne) postavy vybrané DM; všechny musí patřit do kampaně.
     * @param array<string, mixed> $in obsahuje characterIds
     * @return list<array<string, mixed>>
     */
    private static function targets(string $campaignId, array $in): array
    {
        $ids = $in['characterIds'] ?? null;
        if (!is_array($ids) || $ids === [] || count($ids) > 30) {
            throw HttpError::validation('Vyber 1 až 30 postav.', 'characterIds');
        }
        foreach ($ids as $id) {
            if (!is_string($id) || !Ids::isUuid($id)) {
                throw HttpError::validation('Neplatné id postavy.', 'characterIds');
            }
        }
        $ids = array_values(array_unique($ids));
        sort($ids);
        $rows = Db::all(
            'SELECT * FROM characters WHERE campaign_id = ? AND id IN (' . implode(',', array_fill(0, count($ids), '?')) . ') ORDER BY id FOR UPDATE',
            [$campaignId, ...$ids],
        );
        if (count($rows) !== count($ids)) {
            throw HttpError::validation('Některá z vybraných postav není v této kampani.', 'characterIds');
        }
        return $rows;
    }

    private static function describe(string $target, int $value): string
    {
        $label = self::EFFECT_LABELS[$target] ?? $target;
        return ($value > 0 ? "+$value" : (string) $value) . ' ' . $label;
    }
}
