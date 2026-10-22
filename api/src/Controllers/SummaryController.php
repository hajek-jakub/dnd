<?php

declare(strict_types=1);

namespace Dnd\Controllers;

use Dnd\Push;
use Dnd\Request;
use Dnd\Sessions;

/**
 * Jedna odpověď místo tří dotazů, které aplikace posílá pořád dokola (oznámení, nepřečtené zprávy, nové zápisy v deníku).
 * Obsah je přesně to, co vracejí původní trasy, takže klient jen sloučí tři dotazy do jednoho.
 */
final class SummaryController
{
    /** @param array{id:string} $user */
    public static function index(Request $req, array $params, array $user): array
    {
        // Dotaz posílá jen viditelné okno aplikace: kdo se ptá, má aplikaci otevřenou a push nepotřebuje.
        Push::touch($user['id']);
        // Hosting nemá cron: připomínky session spouští ten, kdo má právě aplikaci otevřenou (levný indexovaný dotaz).
        Sessions::remindDue();
        return [
            'notifications' => NotificationController::index($req, $params, $user),
            'messages' => MessageController::unreadOverview($req, $params, $user),
            'journal' => JournalController::unreadOverview($req, $params, $user),
        ];
    }
}
