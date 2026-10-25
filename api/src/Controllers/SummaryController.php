<?php

declare(strict_types=1);

namespace Dnd\Controllers;

use Dnd\Db;
use Dnd\Push;
use Dnd\Request;
use Dnd\Sessions;

/**
 * Jedna odpověď místo tří dotazů, které aplikace posílá pořád dokola (oznámení, nepřečtené zprávy, nové zápisy v deníku).
 * Obsah je přesně to, co vracejí původní trasy, takže klient jen sloučí tři dotazy do jednoho.
 * Navíc `rolls`: id posledního hodu, který uživatel v každé své kampani vidí; log kostek se pak stahuje, jen když přibyl hod
 * (dřív se na něj ptal každý otevřený prohlížeč každých 5 s a hosting to při hraní nestíhal).
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
            'rolls' => self::lastRolls($user['id']),
        ];
    }

    /**
     * Poslední viditelný hod v každé kampani uživatele (skrytý hod jiného hráče se nepočítá, ať nikdo nepozná, že padl).
     * @return array<string, int>
     */
    private static function lastRolls(string $userId): array
    {
        $out = [];
        foreach (Db::all('SELECT campaign_id, role FROM campaign_members WHERE user_id = ?', [$userId]) as $m) {
            $out[(string) $m['campaign_id']] = (int) Db::value(
                'SELECT id FROM dice_rolls WHERE campaign_id = ? AND (hidden = 0 OR user_id = ? OR ? = \'dm\') ORDER BY id DESC LIMIT 1',
                [$m['campaign_id'], $userId, $m['role']],
            );
        }
        return $out;
    }
}
