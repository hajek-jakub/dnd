<?php

declare(strict_types=1);

namespace Dnd;

use Dnd\Controllers\AuthController;
use Dnd\Controllers\CampaignController;
use Dnd\Controllers\CharacterController;
use Dnd\Controllers\InventoryController;
use Dnd\Controllers\LevelUpController;
use Dnd\Controllers\RulesController;
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
        $r->add('POST', '/characters/{id}/spells', [InventoryController::class, 'addSpell']);
        $r->add('PATCH', '/characters/{id}/spells/{spellId}', [InventoryController::class, 'updateSpell']);
        $r->add('DELETE', '/characters/{id}/spells/{spellId}', [InventoryController::class, 'deleteSpell']);
        $r->add('GET', '/campaigns/{id}/dm-notes', [CharacterController::class, 'notes']);
        $r->add('POST', '/campaigns/{id}/dm-notes', [CharacterController::class, 'createNote']);
        $r->add('PATCH', '/dm-notes/{id}', [CharacterController::class, 'updateNote']);
        $r->add('DELETE', '/dm-notes/{id}', [CharacterController::class, 'deleteNote']);

        // Pravidla (SRD, katalog itemů) a homebrew
        $r->add('GET', '/rules', [RulesController::class, 'index']);
        $r->add('GET', '/rules/facets', [RulesController::class, 'facets']);
        $r->add('GET', '/rules/engine', [RulesController::class, 'engine']);
        $r->add('GET', '/rules/class-features', [RulesController::class, 'classFeatures']);
        $r->add('GET', '/rules/{id}', [RulesController::class, 'show']);
        $r->add('PATCH', '/rules/{id}', [RulesController::class, 'update']);
        $r->add('DELETE', '/rules/{id}', [RulesController::class, 'delete']);
        $r->add('POST', '/campaigns/{id}/homebrew', [RulesController::class, 'createHomebrew']);

        // Správa (migrace databáze a seed pravidel z deploye)
        $r->add('POST', '/admin/migrate', [AdminController::class, 'migrate'], auth: false);
        $r->add('POST', '/admin/seed', [AdminController::class, 'seed'], auth: false);
        $r->add('POST', '/admin/diagnostics', [AdminController::class, 'diagnostics'], auth: false);
    }
}
