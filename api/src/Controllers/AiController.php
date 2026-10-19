<?php

declare(strict_types=1);

namespace Dnd\Controllers;

use Dnd\Access;
use Dnd\Assistant;
use Dnd\Claude;
use Dnd\Db;
use Dnd\HttpError;
use Dnd\Ids;
use Dnd\Input;
use Dnd\Request;
use Dnd\Response;

/**
 * AI pomocník DM. Všechno je jen pro DM kampaně (hráč 403, cizinec 404) a používat ho smí jen účty z `claude_users`.
 * Konverzace jsou soukromé: cizí konverzace (i jiného DM téže kampaně) se tváří, že neexistuje (404).
 */
final class AiController
{
    private const MAX_MESSAGE = 4000;

    /** Stav pro UI: jestli je pomocník zapnutý, útrata za měsíc a seznam konverzací. @param array{id:string} $user */
    public static function status(Request $req, array $params, array $user): array
    {
        Access::requireDm($user, $params['id']);
        $enabled = Assistant::enabledFor($user);
        $budget = Assistant::budget();
        return [
            'enabled' => $enabled,
            'configured' => Claude::configured(),
            'model' => Assistant::model(),
            'spentUsd' => round($budget['spent'] / 1_000_000, 2),
            'budgetUsd' => round($budget['budget'] / 1_000_000, 2),
            'conversations' => $enabled ? array_map(static fn (array $c): array => [
                'id' => $c['id'],
                'title' => $c['title'],
                'updatedAt' => Ids::iso((string) $c['updated_at']),
            ], Db::all('SELECT id, title, updated_at FROM ai_conversations WHERE campaign_id = ? AND user_id = ? ORDER BY updated_at DESC, id LIMIT 100', [$params['id'], $user['id']])) : [],
        ];
    }

    /** Nová konverzace s první zprávou; rovnou proběhne první krok AI. @param array{id:string} $user */
    public static function create(Request $req, array $params, array $user): Response
    {
        Access::requireDm($user, $params['id']);
        self::requireEnabled($user);
        $text = Input::string($req->json(), 'message', 1, self::MAX_MESSAGE, 'Zpráva');
        $id = Assistant::create($params['id'], $user, $text);
        try {
            return Response::json(self::stepAndView($id, $user), 201);
        } catch (HttpError $e) {
            // Konverzace už vznikla (zpráva DM je uložená); klient potřebuje její id, aby šlo krok zopakovat.
            return Response::json(['conversation' => Assistant::view(self::row($id)), 'error' => ['code' => $e->errorCode, 'message' => $e->getMessage()]], 201);
        }
    }

    /** @param array{id:string} $user */
    public static function show(Request $req, array $params, array $user): array
    {
        return ['conversation' => Assistant::view(self::conversation($params['id'], $user))];
    }

    /** Další zpráva DM do konverzace a první krok AI. @param array{id:string} $user */
    public static function message(Request $req, array $params, array $user): array
    {
        $conv = self::conversation($params['id'], $user);
        self::requireEnabled($user);
        $text = Input::string($req->json(), 'message', 1, self::MAX_MESSAGE, 'Zpráva');
        if ($conv['busy_until'] !== null && strtotime((string) $conv['busy_until'] . ' UTC') > time()) {
            throw new HttpError(409, 'ai_busy', 'AI na tuhle konverzaci zrovna odpovídá, chvíli počkej.');
        }
        Assistant::appendUser((string) $conv['id'], $text);
        return self::stepAndView((string) $conv['id'], $user);
    }

    /** Další krok AI (po nástrojích, nebo po chybě spojení). @param array{id:string} $user */
    public static function step(Request $req, array $params, array $user): array
    {
        $conv = self::conversation($params['id'], $user);
        self::requireEnabled($user);
        return self::stepAndView((string) $conv['id'], $user);
    }

    /** @param array{id:string} $user */
    public static function delete(Request $req, array $params, array $user): ?array
    {
        $conv = self::conversation($params['id'], $user);
        Db::exec('DELETE FROM ai_conversations WHERE id = ?', [$conv['id']]);
        return null;
    }

    /** DM návrh potvrdí: složky a položky vzniknou v lootu (jedna transakce, stejná validace jako ruční zadání). @param array{id:string} $user */
    public static function applyProposal(Request $req, array $params, array $user): array
    {
        [$proposal, $conv] = self::proposal($params['id'], $user);
        Assistant::applyProposal($proposal, (string) $conv['campaign_id'], $user);
        return ['proposal' => self::proposalView((string) $proposal['id'])] + LootController::tree((string) $conv['campaign_id']);
    }

    /** @param array{id:string} $user */
    public static function discardProposal(Request $req, array $params, array $user): array
    {
        [$proposal] = self::proposal($params['id'], $user);
        if (Db::exec("UPDATE ai_proposals SET status = 'discarded', decided_at = UTC_TIMESTAMP() WHERE id = ? AND status = 'pending'", [$proposal['id']]) === 0) {
            throw new HttpError(409, 'conflict', 'Návrh už je vyřízený.');
        }
        return ['proposal' => self::proposalView((string) $proposal['id'])];
    }

    // ------------------------------------------------------------------ pomocné

    /** @param array{id:string} $user @return array<string, mixed> */
    private static function stepAndView(string $conversationId, array $user): array
    {
        // Volání modelu může trvat desítky sekund; kde to hosting dovolí, prodlouží se časový limit PHP.
        @set_time_limit(150);
        Assistant::step(self::row($conversationId), $user);
        return ['conversation' => Assistant::view(self::row($conversationId))];
    }

    /** @param array{id:string} $user */
    private static function requireEnabled(array $user): void
    {
        if (!Assistant::enabledFor($user)) {
            throw HttpError::forbidden(Claude::configured() ? 'AI pomocník není pro tvůj účet zapnutý (claude_users v konfiguraci serveru).' : 'AI pomocník není na serveru nastavený.');
        }
    }

    /**
     * Konverzace volajícího; cizí (i jiného DM téže kampaně) je 404. Volající musí být pořád DM její kampaně.
     * @param array{id:string} $user
     * @return array<string, mixed>
     */
    private static function conversation(string $id, array $user): array
    {
        $row = Ids::isUuid($id) ? Db::one('SELECT * FROM ai_conversations WHERE id = ? AND user_id = ?', [$id, $user['id']]) : null;
        if ($row === null) {
            throw HttpError::notFound('Konverzace nenalezena.');
        }
        Access::requireDm($user, (string) $row['campaign_id']);
        return $row;
    }

    /** @return array<string, mixed> */
    private static function row(string $id): array
    {
        return Db::one('SELECT * FROM ai_conversations WHERE id = ?', [$id]) ?? throw HttpError::notFound('Konverzace nenalezena.');
    }

    /**
     * Návrh z konverzace volajícího (jinak 404).
     * @param array{id:string} $user
     * @return array{0: array<string, mixed>, 1: array<string, mixed>}
     */
    private static function proposal(string $id, array $user): array
    {
        $row = Ids::isUuid($id) ? Db::one('SELECT * FROM ai_proposals WHERE id = ?', [$id]) : null;
        if ($row === null) {
            throw HttpError::notFound('Návrh nenalezen.');
        }
        return [$row, self::conversation((string) $row['conversation_id'], $user)];
    }

    /** @return array<string, mixed> */
    private static function proposalView(string $id): array
    {
        return Assistant::proposalPayload(Db::one('SELECT * FROM ai_proposals WHERE id = ?', [$id]) ?? throw HttpError::notFound());
    }
}
