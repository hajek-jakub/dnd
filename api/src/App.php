<?php

declare(strict_types=1);

namespace Dnd;

use Dnd\Controllers\AiController;
use Dnd\Controllers\AuthController;
use Dnd\Controllers\CampaignController;
use Dnd\Controllers\CharacterController;
use Dnd\Controllers\DiceController;
use Dnd\Controllers\DmController;
use Dnd\Controllers\EnemyController;
use Dnd\Controllers\InitiativeController;
use Dnd\Controllers\InventoryController;
use Dnd\Controllers\JournalController;
use Dnd\Controllers\JournalNpcController;
use Dnd\Controllers\LootController;
use Dnd\Controllers\MapController;
use Dnd\Controllers\MessageController;
use Dnd\Controllers\NotificationController;
use Dnd\Controllers\PushController;
use Dnd\Controllers\LevelUpController;
use Dnd\Controllers\RulesController;
use Dnd\Controllers\SessionController;
use Dnd\Controllers\SummaryController;
use Dnd\Controllers\CompanionController;
use Dnd\Controllers\TacticsController;
use Dnd\Controllers\AdminController;
use Throwable;

/** Složí požadavek, spustí router a pošle odpověď. Chyby převede na JSON. */
final class App
{
    public static function run(): void
    {
        header('Content-Type: application/json; charset=utf-8');
        header('Cache-Control: no-store');
        header('X-Content-Type-Options: nosniff');

        try {
            $request = Request::fromGlobals();
            $router = new Router();
            self::routes($router);
            $response = $router->dispatch($request);
        } catch (HttpError $e) {
            $response = Response::error($e->status, $e->errorCode, $e->getMessage(), $e->field);
        } catch (Throwable $e) {
            error_log('[dnd] ' . $e::class . ': ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine());
            $detail = Config::get('debug', false) ? $e->getMessage() : null;
            $response = Response::error(500, 'server_error', 'Chyba serveru. Zkus to prosím znovu.', null, $detail);
        }

        $response->send();
        self::sendPush();
    }

    /**
     * Push notifikace zařazené během požadavku se odesílají až teď, když klient odpověď už má (cURL k push službám trvá desetiny sekundy).
     * Kde to jde (PHP-FPM), spojení se předtím uzavře, takže uživatel na push nečeká ani vteřinu.
     */
    private static function sendPush(): void
    {
        if (!Push::pending()) {
            return;
        }
        ignore_user_abort(true);
        if (function_exists('fastcgi_finish_request')) {
            fastcgi_finish_request();
        } else {
            while (ob_get_level() > 0) {
                ob_end_flush();
            }
            flush();
        }
        Push::flush();
    }

    private static function routes(Router $r): void
    {
        $r->add('GET', '/health', static fn () => ['ok' => true], auth: false);

        // Přihlášení a účet
        $r->add('POST', '/auth/register', [AuthController::class, 'register'], auth: false);
        $r->add('POST', '/auth/login', [AuthController::class, 'login'], auth: false);
        $r->add('GET', '/auth/me', [AuthController::class, 'me'], auth: false);
        $r->add('POST', '/auth/logout', [AuthController::class, 'logout'], auth: false);
        $r->add('POST', '/auth/password', [AuthController::class, 'changePassword']);
        $r->add('PATCH', '/profile', [AuthController::class, 'updateProfile']);

        // Kampaně a členové
        $r->add('GET', '/campaigns', [CampaignController::class, 'index']);
        $r->add('POST', '/campaigns', [CampaignController::class, 'create']);
        $r->add('GET', '/campaigns/{id}', [CampaignController::class, 'show']);
        $r->add('PATCH', '/campaigns/{id}', [CampaignController::class, 'update']);
        $r->add('DELETE', '/campaigns/{id}', [CampaignController::class, 'delete']);
        $r->add('GET', '/campaigns/{id}/members', [CampaignController::class, 'members']);
        $r->add('DELETE', '/campaigns/{id}/members/{userId}', [CampaignController::class, 'removeMember']);

        // Pozvánky
        $r->add('GET', '/campaigns/{id}/invites', [CampaignController::class, 'invites']);
        $r->add('POST', '/campaigns/{id}/invites', [CampaignController::class, 'createInvite']);
        $r->add('PATCH', '/campaigns/{id}/invites/{inviteId}', [CampaignController::class, 'updateInvite']);
        $r->add('GET', '/invites/{code}', [CampaignController::class, 'previewInvite']);
        $r->add('POST', '/invites/{code}/accept', [CampaignController::class, 'acceptInvite']);

        // Postavy a DM poznámky
        $r->add('GET', '/campaigns/{id}/characters', [CharacterController::class, 'index']);
        $r->add('POST', '/campaigns/{id}/characters', [CharacterController::class, 'create']);
        $r->add('GET', '/characters/{id}', [CharacterController::class, 'show']);
        $r->add('PATCH', '/characters/{id}', [CharacterController::class, 'update']);
        $r->add('DELETE', '/characters/{id}', [CharacterController::class, 'delete']);
        $r->add('POST', '/characters/{id}/adjust', [CharacterController::class, 'adjust']);
        $r->add('POST', '/characters/{id}/photo', [CharacterController::class, 'uploadPhoto']);
        $r->add('GET', '/characters/{id}/photo', [CharacterController::class, 'photo']);
        $r->add('DELETE', '/characters/{id}/photo', [CharacterController::class, 'deletePhoto']);
        $r->add('POST', '/characters/{id}/levelup', [LevelUpController::class, 'levelUp']);
        $r->add('POST', '/characters/{id}/levelup/revert', [LevelUpController::class, 'revert']);
        $r->add('POST', '/characters/{id}/items', [InventoryController::class, 'addItem']);
        $r->add('PATCH', '/characters/{id}/items/{itemId}', [InventoryController::class, 'updateItem']);
        $r->add('DELETE', '/characters/{id}/items/{itemId}', [InventoryController::class, 'deleteItem']);
        $r->add('POST', '/characters/{id}/transfer', [InventoryController::class, 'transfer']);
        $r->add('POST', '/characters/{id}/spend', [InventoryController::class, 'spend']);
        $r->add('POST', '/characters/{id}/spells', [InventoryController::class, 'addSpell']);
        $r->add('PATCH', '/characters/{id}/spells/{spellId}', [InventoryController::class, 'updateSpell']);
        $r->add('DELETE', '/characters/{id}/spells/{spellId}', [InventoryController::class, 'deleteSpell']);
        $r->add('GET', '/campaigns/{id}/dm-notes', [CharacterController::class, 'notes']);
        $r->add('POST', '/campaigns/{id}/dm-notes', [CharacterController::class, 'createNote']);
        $r->add('PATCH', '/dm-notes/{id}', [CharacterController::class, 'updateNote']);
        $r->add('DELETE', '/dm-notes/{id}', [CharacterController::class, 'deleteNote']);

        // DM panel: rozdávání, zranění, stavy, efekty; oznámení hráčům
        $r->add('GET', '/campaigns/{id}/loot', [LootController::class, 'index']);
        $r->add('POST', '/campaigns/{id}/loot/folders', [LootController::class, 'createFolder']);
        $r->add('PATCH', '/loot/folders/{id}', [LootController::class, 'updateFolder']);
        $r->add('DELETE', '/loot/folders/{id}', [LootController::class, 'deleteFolder']);
        $r->add('POST', '/campaigns/{id}/loot/entries', [LootController::class, 'createEntry']);
        $r->add('PATCH', '/loot/entries/{id}', [LootController::class, 'updateEntry']);
        $r->add('DELETE', '/loot/entries/{id}', [LootController::class, 'deleteEntry']);
        $r->add('POST', '/campaigns/{id}/loot/give', [LootController::class, 'give']);
        $r->add('POST', '/campaigns/{id}/loot/deploy', [LootController::class, 'deploy']);
        $r->add('GET', '/campaigns/{id}/initiative', [InitiativeController::class, 'index']);
        $r->add('POST', '/campaigns/{id}/initiative', [InitiativeController::class, 'set']);
        $r->add('POST', '/campaigns/{id}/initiative/order', [InitiativeController::class, 'reorder']);
        $r->add('POST', '/campaigns/{id}/initiative/next', [InitiativeController::class, 'next']);
        $r->add('DELETE', '/campaigns/{id}/initiative/{kind}/{sid}', [InitiativeController::class, 'remove']);
        $r->add('DELETE', '/campaigns/{id}/initiative', [InitiativeController::class, 'clear']);
        $r->add('POST', '/campaigns/{id}/enemies/initiative', [EnemyController::class, 'rollAllInitiative']);
        $r->add('POST', '/enemies/{id}/initiative', [EnemyController::class, 'rollInitiative']);
        $r->add('GET', '/campaigns/{id}/enemies', [EnemyController::class, 'index']);
        $r->add('POST', '/campaigns/{id}/enemies', [EnemyController::class, 'create']);
        $r->add('PATCH', '/enemies/{id}', [EnemyController::class, 'update']);
        $r->add('DELETE', '/enemies/{id}', [EnemyController::class, 'delete']);
        $r->add('POST', '/enemies/{id}/hp', [EnemyController::class, 'hp']);
        $r->add('POST', '/enemies/{id}/duplicate', [EnemyController::class, 'duplicate']);
        $r->add('POST', '/campaigns/{id}/dm/items', [DmController::class, 'giveItem']);
        $r->add('POST', '/campaigns/{id}/dm/currency', [DmController::class, 'giveCurrency']);
        $r->add('POST', '/campaigns/{id}/dm/inspiration', [DmController::class, 'setInspiration']);
        $r->add('POST', '/campaigns/{id}/dm/hp', [DmController::class, 'hp']);
        $r->add('POST', '/campaigns/{id}/dm/conditions', [DmController::class, 'condition']);
        $r->add('POST', '/campaigns/{id}/dm/temp-hp', [DmController::class, 'tempHp']);
        $r->add('POST', '/campaigns/{id}/dm/effects', [DmController::class, 'addEffect']);
        $r->add('DELETE', '/effects/{effectId}', [DmController::class, 'removeEffect']);
        $r->add('DELETE', '/characters/{id}/effects/long-rest', [DmController::class, 'expireLongRestEffects']);
        // Plánování session: kalendář dostupnosti hráčů a termíny od DM
        $r->add('GET', '/campaigns/{id}/calendar', [SessionController::class, 'index']);
        $r->add('POST', '/campaigns/{id}/availability', [SessionController::class, 'setAvailability']);
        $r->add('POST', '/campaigns/{id}/sessions', [SessionController::class, 'create']);
        $r->add('PATCH', '/sessions/{id}', [SessionController::class, 'update']);
        $r->add('DELETE', '/sessions/{id}', [SessionController::class, 'delete']);
        $r->add('GET', '/summary', [SummaryController::class, 'index']);
        // Push notifikace (Web Push): odběr zařízení, výběr kategorií, zkouška
        $r->add('GET', '/push/config', [PushController::class, 'config']);
        $r->add('GET', '/push/subscription', [PushController::class, 'show']);
        $r->add('POST', '/push/subscription', [PushController::class, 'subscribe']);
        $r->add('PATCH', '/push/subscription', [PushController::class, 'update']);
        $r->add('DELETE', '/push/subscription', [PushController::class, 'unsubscribe']);
        $r->add('POST', '/push/test', [PushController::class, 'test']);
        $r->add('GET', '/notifications', [NotificationController::class, 'index']);
        $r->add('POST', '/notifications/read', [NotificationController::class, 'markRead']);

        // Zprávy v kampani (skupinový chat, soukromě DM a hráč, tajné zprávy od DM)
        $r->add('GET', '/campaigns/{id}/messages', [MessageController::class, 'index']);
        $r->add('POST', '/campaigns/{id}/messages', [MessageController::class, 'send']);
        $r->add('POST', '/campaigns/{id}/messages/read', [MessageController::class, 'markRead']);
        $r->add('GET', '/messages/unread', [MessageController::class, 'unreadOverview']);
        $r->add('PATCH', '/messages/{id}', [MessageController::class, 'edit']);
        $r->add('DELETE', '/messages/{id}', [MessageController::class, 'remove']);
        $r->add('POST', '/messages/{id}/reactions', [MessageController::class, 'react']);
        // Připravené zprávy DM (koncepty): nachystá se text a příjemci, odešle se jedním klepnutím
        $r->add('GET', '/campaigns/{id}/message-drafts', [MessageController::class, 'drafts']);
        $r->add('POST', '/campaigns/{id}/message-drafts', [MessageController::class, 'createDraft']);
        $r->add('PATCH', '/message-drafts/{id}', [MessageController::class, 'updateDraft']);
        $r->add('DELETE', '/message-drafts/{id}', [MessageController::class, 'deleteDraft']);
        $r->add('POST', '/message-drafts/{id}/send', [MessageController::class, 'sendDraft']);

        // Mapy kampaně a body na nich
        $r->add('GET', '/campaigns/{id}/maps', [MapController::class, 'index']);
        $r->add('POST', '/campaigns/{id}/maps', [MapController::class, 'create']);
        $r->add('POST', '/campaigns/{id}/maps/order', [MapController::class, 'reorder']);
        $r->add('PATCH', '/maps/{id}', [MapController::class, 'update']);
        $r->add('DELETE', '/maps/{id}', [MapController::class, 'delete']);
        $r->add('GET', '/maps/{id}/image', [MapController::class, 'image']);
        $r->add('GET', '/maps/{id}/pins', [MapController::class, 'pins']);
        $r->add('POST', '/maps/{id}/pins', [MapController::class, 'createPin']);
        $r->add('PATCH', '/pins/{id}', [MapController::class, 'updatePin']);
        $r->add('DELETE', '/pins/{id}', [MapController::class, 'deletePin']);

        // Taktiky postavy (útoky, kouzla, ki, pasivky, komba, poučky)
        $r->add('GET', '/characters/{id}/tactics', [TacticsController::class, 'index']);
        $r->add('POST', '/characters/{id}/tactics', [TacticsController::class, 'create']);
        $r->add('POST', '/characters/{id}/tactics/reorder', [TacticsController::class, 'reorder']);
        $r->add('PATCH', '/tactics/{id}', [TacticsController::class, 'update']);
        $r->add('DELETE', '/tactics/{id}', [TacticsController::class, 'delete']);
        $r->add('GET', '/characters/{id}/companions', [CompanionController::class, 'index']);
        $r->add('POST', '/characters/{id}/companions', [CompanionController::class, 'create']);
        $r->add('PATCH', '/companions/{id}', [CompanionController::class, 'update']);
        $r->add('DELETE', '/companions/{id}', [CompanionController::class, 'delete']);
        $r->add('POST', '/companions/{id}/hp', [CompanionController::class, 'hp']);
        $r->add('POST', '/companions/{id}/duplicate', [CompanionController::class, 'duplicate']);

        // Kostky: hody na serveru a sdílený log kampaně
        $r->add('POST', '/campaigns/{id}/rolls', [DiceController::class, 'roll']);
        $r->add('POST', '/campaigns/{id}/rolls/batch', [DiceController::class, 'batch']);
        $r->add('GET', '/campaigns/{id}/rolls', [DiceController::class, 'index']);

        // Deník kampaně (zápisy podle témat)
        $r->add('GET', '/campaigns/{id}/journal', [JournalController::class, 'index']);
        $r->add('POST', '/campaigns/{id}/journal', [JournalController::class, 'create']);
        $r->add('POST', '/campaigns/{id}/journal/read', [JournalController::class, 'markRead']);
        $r->add('GET', '/journal/unread', [JournalController::class, 'unreadOverview']);
        $r->add('PATCH', '/journal/{id}', [JournalController::class, 'update']);
        $r->add('DELETE', '/journal/{id}', [JournalController::class, 'delete']);
        // Přehled NPC v deníku (abecední seznam, propojený se zápisy)
        $r->add('GET', '/campaigns/{id}/journal/npcs', [JournalNpcController::class, 'index']);
        $r->add('POST', '/campaigns/{id}/journal/npcs', [JournalNpcController::class, 'create']);
        $r->add('PATCH', '/journal-npcs/{id}', [JournalNpcController::class, 'update']);
        $r->add('DELETE', '/journal-npcs/{id}', [JournalNpcController::class, 'delete']);

        // Pravidla (SRD, katalog itemů) a homebrew
        $r->add('GET', '/rules', [RulesController::class, 'index']);
        $r->add('GET', '/rules/facets', [RulesController::class, 'facets']);
        $r->add('GET', '/rules/engine', [RulesController::class, 'engine']);
        $r->add('GET', '/rules/class-features', [RulesController::class, 'classFeatures']);
        $r->add('GET', '/rules/{id}', [RulesController::class, 'show']);
        $r->add('PATCH', '/rules/{id}', [RulesController::class, 'update']);
        $r->add('DELETE', '/rules/{id}', [RulesController::class, 'delete']);
        $r->add('POST', '/campaigns/{id}/homebrew', [RulesController::class, 'createHomebrew']);

        // AI pomocník DM (Claude): konverzace a návrhy do lootu, které DM potvrdí
        $r->add('GET', '/campaigns/{id}/ai', [AiController::class, 'status']);
        $r->add('POST', '/campaigns/{id}/ai/conversations', [AiController::class, 'create']);
        $r->add('GET', '/ai/conversations/{id}', [AiController::class, 'show']);
        $r->add('POST', '/ai/conversations/{id}/messages', [AiController::class, 'message']);
        $r->add('POST', '/ai/conversations/{id}/step', [AiController::class, 'step']);
        $r->add('DELETE', '/ai/conversations/{id}', [AiController::class, 'delete']);
        $r->add('POST', '/ai/proposals/{id}/apply', [AiController::class, 'applyProposal']);
        $r->add('POST', '/ai/proposals/{id}/discard', [AiController::class, 'discardProposal']);

        // Správa (migrace databáze a seed pravidel z deploye)
        $r->add('POST', '/admin/migrate', [AdminController::class, 'migrate'], auth: false);
        $r->add('POST', '/admin/seed', [AdminController::class, 'seed'], auth: false);
        $r->add('POST', '/admin/diagnostics', [AdminController::class, 'diagnostics'], auth: false);
        $r->add('POST', '/admin/reminders', [AdminController::class, 'reminders'], auth: false);
        // Pro plánovač (cron) na hostingu: umí jen volat adresu, takže klíč je v adrese. HEAD (kontrola existence při přidání úlohy) nic nedělá.
        $r->add('GET', '/cron/reminders', [AdminController::class, 'cronReminders'], auth: false);
        $r->add('HEAD', '/cron/reminders', [AdminController::class, 'cronHead'], auth: false);
    }
}
