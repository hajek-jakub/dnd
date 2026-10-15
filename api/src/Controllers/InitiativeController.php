<?php

declare(strict_types=1);

namespace Dnd\Controllers;

use Dnd\Access;
use Dnd\Db;
use Dnd\HttpError;
use Dnd\Ids;
use Dnd\Initiative;
use Dnd\Request;

/**
 * Iniciativa v kampani: jen pro DM. Hráči nic nevidí (hod na iniciativu se jim sám zapíše, ale pořadí je DM).
 * Hodnota se zapisuje z hodu (`initiative: true` v hodu postavy, hod za nepřítele), pořadí DM přetahuje.
 */
final class InitiativeController
{
    /** @param array{id:string} $user */
    public static function index(Request $req, array $params, array $user): array
    {
        Access::requireDm($user, $params['id']);
        return Db::transaction(static fn (): array => Initiative::view($params['id']));
    }

    /**
     * Přidá postavy a nepřátele do iniciativy (bez hodnoty) nebo nastaví hodnotu jednomu z nich.
     * Tělo: `{kind, id, value?}` nebo `{subjects: [{kind, id}, ...]}` pro přidání víc najednou.
     * @param array{id:string} $user
     */
    public static function set(Request $req, array $params, array $user): array
    {
        Access::requireDm($user, $params['id']);
        $in = $req->json();
        $items = isset($in['subjects']) ? $in['subjects'] : [$in];
        if (!is_array($items) || $items === [] || count($items) > 100) {
            throw HttpError::validation('Pošli 1 až 100 záznamů.', 'subjects');
        }
        $parsed = [];
        foreach ($items as $it) {
            $kind = is_array($it) ? ($it['kind'] ?? null) : null;
            $id = is_array($it) && is_string($it['id'] ?? null) ? $it['id'] : '';
            if (!is_string($kind) || !in_array($kind, Initiative::KINDS, true) || !Ids::isUuid($id)) {
                throw HttpError::validation('Záznam musí mít kind (character, enemy) a id.', 'subjects');
            }
            $value = $it['value'] ?? null;
            if ($value !== null && (!is_int($value) || $value < -20 || $value > 60)) {
                throw HttpError::validation('Iniciativa musí být celé číslo od -20 do 60.', 'value');
            }
            $parsed[] = [$kind, $id, $value];
        }
        Db::transaction(static function () use ($params, $parsed): void {
            foreach ($parsed as [$kind, $id, $value]) {
                if (!self::exists($params['id'], $kind, $id)) {
                    throw HttpError::validation('Postava nebo nepřítel není z této kampaně.', 'subjects');
                }
                Initiative::set($params['id'], $kind, $id, $value);
            }
        });
        return Db::transaction(static fn (): array => Initiative::view($params['id']));
    }

    /** Nové pořadí po přetažení: `{keys: ["character:<id>", "enemy:<id>", ...]}`. @param array{id:string} $user */
    public static function reorder(Request $req, array $params, array $user): array
    {
        Access::requireDm($user, $params['id']);
        $keys = $req->json()['keys'] ?? null;
        if (!is_array($keys) || count($keys) > 200 || array_filter($keys, static fn ($k): bool => !is_string($k)) !== []) {
            throw HttpError::validation('Pošli pole klíčů.', 'keys');
        }
        Db::transaction(static function () use ($params, $keys): void {
            Initiative::reorder($params['id'], array_values($keys));
        });
        return Db::transaction(static fn (): array => Initiative::view($params['id']));
    }

    /** Další tah (po posledním nové kolo). @param array{id:string} $user */
    public static function next(Request $req, array $params, array $user): array
    {
        Access::requireDm($user, $params['id']);
        Db::transaction(static function () use ($params): void {
            Initiative::next($params['id']);
        });
        return Db::transaction(static fn (): array => Initiative::view($params['id']));
    }

    /** @param array{id:string, kind:string, sid:string} $user */
    public static function remove(Request $req, array $params, array $user): array
    {
        Access::requireDm($user, $params['id']);
        if (!in_array($params['kind'], Initiative::KINDS, true) || !Ids::isUuid($params['sid'])) {
            throw HttpError::validation('Neplatný záznam.', 'kind');
        }
        Db::transaction(static function () use ($params): void {
            Db::one('SELECT id FROM campaigns WHERE id = ? FOR UPDATE', [$params['id']]);
            Initiative::remove($params['id'], $params['kind'], $params['sid']);
        });
        return Db::transaction(static fn (): array => Initiative::view($params['id']));
    }

    /** Konec souboje: smaže celé pořadí i kolo. @param array{id:string} $user */
    public static function clear(Request $req, array $params, array $user): array
    {
        Access::requireDm($user, $params['id']);
        Db::transaction(static function () use ($params): void {
            Initiative::clear($params['id']);
        });
        return ['round' => 1, 'active' => null, 'entries' => []];
    }

    private static function exists(string $campaignId, string $kind, string $id): bool
    {
        $table = $kind === 'character' ? 'characters' : 'enemies';
        return Db::one("SELECT id FROM $table WHERE id = ? AND campaign_id = ?", [$id, $campaignId]) !== null;
    }
}
