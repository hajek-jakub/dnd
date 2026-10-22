<?php

declare(strict_types=1);

namespace Dnd\Controllers;

use Dnd\Access;
use Dnd\Db;
use Dnd\HttpError;
use Dnd\Ids;
use Dnd\Input;
use Dnd\RateLimiter;
use Dnd\Request;
use Dnd\Response;
use Dnd\Sessions;

/**
 * Plánování session (kalendář kampaně).
 *  - Každý člen kampaně (i DM) si označí dny, kdy může hrát; vidí to všichni členové (DM podle toho vybírá termín),
 *  - termín session zadává, mění a ruší jen DM; hráč dostane oznámení a push, den předem připomínku (viz `Sessions`).
 * Cizinec dostane 404, hráč u zápisu session 403, anonym 401.
 */
final class SessionController
{
    /** Kolik dní dopředu jde dostupnost označit. */
    private const HORIZON_DAYS = 400;
    private const MAX_DAYS_PER_REQUEST = 100;

    /** @param array{id:string} $user */
    public static function index(Request $req, array $params, array $user): array
    {
        Access::requireMember($user, $params['id']);
        Sessions::remindDue();
        $today = Sessions::today();
        $horizon = Sessions::now()->modify('+' . self::HORIZON_DAYS . ' days')->format('Y-m-d');

        $sessions = Db::all(
            'SELECT * FROM game_sessions WHERE campaign_id = ? AND session_date >= ? ORDER BY session_date',
            [$params['id'], $today],
        );
        $past = Db::all(
            'SELECT * FROM game_sessions WHERE campaign_id = ? AND session_date < ? ORDER BY session_date DESC LIMIT 3',
            [$params['id'], $today],
        );
        $members = Db::all(
            'SELECT u.id, u.display_name, m.role FROM campaign_members m JOIN users u ON u.id = m.user_id
             WHERE m.campaign_id = ? ORDER BY (m.role = \'dm\') DESC, u.display_name',
            [$params['id']],
        );
        $availability = [];
        foreach ($members as $m) {
            $availability[(string) $m['id']] = [];
        }
        foreach (Db::all('SELECT user_id, day FROM session_availability WHERE campaign_id = ? AND day >= ? AND day <= ? ORDER BY day', [$params['id'], $today, $horizon]) as $row) {
            $availability[(string) $row['user_id']][] = (string) $row['day'];
        }
        return [
            'today' => $today,
            'sessions' => array_map(static fn (array $s): array => self::payload($s), array_merge(array_reverse($past), $sessions)),
            'members' => array_map(static fn (array $m): array => ['userId' => $m['id'], 'name' => $m['display_name'], 'role' => $m['role']], $members),
            'availability' => $availability,
        ];
    }

    /** Označí (nebo odznačí) dny, kdy může přihlášený uživatel hrát. @param array{id:string} $user */
    public static function setAvailability(Request $req, array $params, array $user): array
    {
        Access::requireMember($user, $params['id']);
        RateLimiter::hit('availability:' . $user['id'], 120, 60);
        $data = $req->json();
        $days = $data['days'] ?? null;
        if (!is_array($days) || $days === [] || count($days) > self::MAX_DAYS_PER_REQUEST || !array_key_exists('available', $data) || !is_bool($data['available'])) {
            throw HttpError::validation('Zadej days (1 až ' . self::MAX_DAYS_PER_REQUEST . ' dní) a available (true/false).', 'days');
        }
        $today = Sessions::today();
        $horizon = Sessions::now()->modify('+' . self::HORIZON_DAYS . ' days')->format('Y-m-d');
        foreach ($days as $day) {
            if (!Sessions::validDate($day)) {
                throw HttpError::validation('Neplatné datum.', 'days');
            }
            if ($day < $today || $day > $horizon) {
                throw HttpError::validation('Dny jde označit od dneška do ' . self::HORIZON_DAYS . ' dní dopředu.', 'days');
            }
        }
        $days = array_values(array_unique($days));
        Db::transaction(static function () use ($days, $data, $params, $user): void {
            foreach ($days as $day) {
                if ($data['available']) {
                    Db::exec('INSERT IGNORE INTO session_availability (campaign_id, user_id, day) VALUES (?, ?, ?)', [$params['id'], $user['id'], $day]);
                } else {
                    Db::exec('DELETE FROM session_availability WHERE campaign_id = ? AND user_id = ? AND day = ?', [$params['id'], $user['id'], $day]);
                }
            }
        });
        $mine = array_map(static fn (array $r): string => (string) $r['day'], Db::all('SELECT day FROM session_availability WHERE campaign_id = ? AND user_id = ? AND day >= ? ORDER BY day', [$params['id'], $user['id'], $today]));
        return ['days' => $mine];
    }

    /** DM zadá termín session. Hráči dostanou oznámení a push. @param array{id:string} $user */
    public static function create(Request $req, array $params, array $user): Response
    {
        Access::requireDm($user, $params['id']);
        $data = $req->json();
        $date = self::date($data['date'] ?? null);
        if ($date < Sessions::today()) {
            throw HttpError::validation('Termín session nesmí být v minulosti.', 'date');
        }
        $time = self::time($data, null);
        $note = Input::optionalString($data, 'note', 200, 'Poznámka') ?? '';
        if ((int) Db::value('SELECT COUNT(*) FROM game_sessions WHERE campaign_id = ?', [$params['id']]) >= Sessions::MAX_PER_CAMPAIGN) {
            throw HttpError::validation('V kampani může být nejvýš ' . Sessions::MAX_PER_CAMPAIGN . ' session.', 'date');
        }
        $id = Ids::uuid();
        Db::transaction(static function () use ($id, $params, $user, $date, $time, $note): void {
            if (Db::value('SELECT 1 FROM game_sessions WHERE campaign_id = ? AND session_date = ?', [$params['id'], $date]) !== null) {
                throw HttpError::validation('V ten den už session je.', 'date');
            }
            // Je-li session tak blízko, že by připomínka přišla hned, stačí oznámení samotné.
            $reminded = Sessions::reminderWindowOpen($date) ? gmdate('Y-m-d H:i:s') : null;
            Db::exec(
                'INSERT INTO game_sessions (id, campaign_id, session_date, session_time, note, created_by, reminded_at, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())',
                [$id, $params['id'], $date, $time, $note, $user['id'], $reminded],
            );
            Sessions::notify($params['id'], 'Další session: ' . Sessions::label($date, $time) . '.' . ($note !== '' ? ' ' . $note : ''), 'session-' . $id, $user['id']);
        });
        return Response::json(['session' => self::payload(self::load($id))], 201);
    }

    /** Změní datum, čas nebo poznámku; při změně termínu o tom hráči dostanou zprávu. @param array{id:string} $user */
    public static function update(Request $req, array $params, array $user): array
    {
        $session = self::loadForDm($params['id'], $user);
        $data = $req->json();
        $date = array_key_exists('date', $data) ? self::date($data['date']) : (string) $session['session_date'];
        $time = array_key_exists('time', $data) ? self::time($data, $session['session_time']) : $session['session_time'];
        $note = array_key_exists('note', $data) ? Input::string($data, 'note', 0, 200, 'Poznámka') : (string) $session['note'];
        $moved = $date !== (string) $session['session_date'] || $time !== $session['session_time'];
        if ($date !== (string) $session['session_date'] && $date < Sessions::today()) {
            throw HttpError::validation('Termín session nesmí být v minulosti.', 'date');
        }
        Db::transaction(static function () use ($session, $date, $time, $note, $moved, $user): void {
            if ($date !== (string) $session['session_date'] && Db::value('SELECT 1 FROM game_sessions WHERE campaign_id = ? AND session_date = ? AND id <> ?', [$session['campaign_id'], $date, $session['id']]) !== null) {
                throw HttpError::validation('V ten den už session je.', 'date');
            }
            // Přesunutá session má novou připomínku (kromě případu, kdy už by přišla hned).
            $reminded = $moved ? (Sessions::reminderWindowOpen($date) ? gmdate('Y-m-d H:i:s') : null) : $session['reminded_at'];
            Db::exec(
                'UPDATE game_sessions SET session_date = ?, session_time = ?, note = ?, reminded_at = ?, updated_at = UTC_TIMESTAMP() WHERE id = ?',
                [$date, $time, $note, $reminded, $session['id']],
            );
            if ($moved) {
                Sessions::notify((string) $session['campaign_id'], 'Session se přesouvá: ' . Sessions::label($date, $time) . '.' . ($note !== '' ? ' ' . $note : ''), 'session-' . $session['id'], $user['id']);
            }
        });
        return ['session' => self::payload(self::load((string) $session['id']))];
    }

    /** Zruší session. Byla-li ještě před námi, hráči se to dozvědí. @param array{id:string} $user */
    public static function delete(Request $req, array $params, array $user): array
    {
        $session = self::loadForDm($params['id'], $user);
        Db::transaction(static function () use ($session, $user): void {
            Db::exec('DELETE FROM game_sessions WHERE id = ?', [$session['id']]);
            if ((string) $session['session_date'] >= Sessions::today()) {
                Sessions::notify((string) $session['campaign_id'], 'Session ' . Sessions::label((string) $session['session_date'], $session['session_time']) . ' se ruší.', 'session-' . $session['id'], $user['id']);
            }
        });
        return ['deleted' => true];
    }

    // ------------------------------------------------------------------ pomocné

    /** @return array<string, mixed> */
    private static function load(string $id): array
    {
        $row = Db::one('SELECT * FROM game_sessions WHERE id = ?', [$id]);
        if ($row === null) {
            throw HttpError::notFound('Session nenalezena.');
        }
        return $row;
    }

    /** Session, kterou smí měnit přihlášený DM; cizí kampaň nebo neznámé id = 404, hráč 403. @param array{id:string} $user @return array<string, mixed> */
    private static function loadForDm(string $id, array $user): array
    {
        $row = Db::one('SELECT * FROM game_sessions WHERE id = ?', [Input::uuid($id, 'Session')]);
        if ($row === null) {
            throw HttpError::notFound('Session nenalezena.');
        }
        Access::requireDm($user, (string) $row['campaign_id']);
        return $row;
    }

    /** @param array<string, mixed> $row */
    private static function payload(array $row): array
    {
        return [
            'id' => $row['id'],
            'date' => (string) $row['session_date'],
            'time' => $row['session_time'],
            'note' => (string) $row['note'],
        ];
    }

    private static function date(mixed $value): string
    {
        if (!Sessions::validDate($value)) {
            throw HttpError::validation('Zadej datum ve tvaru RRRR-MM-DD.', 'date');
        }
        return (string) $value;
    }

    /** @param array<string, mixed> $data */
    private static function time(array $data, mixed $current): ?string
    {
        if (!array_key_exists('time', $data)) {
            return $current === null ? null : (string) $current;
        }
        $time = $data['time'];
        if ($time === null || $time === '') {
            return null;
        }
        if (!is_string($time) || preg_match('/^([01]\d|2[0-3]):[0-5]\d$/', $time) !== 1) {
            throw HttpError::validation('Čas zadej ve tvaru HH:MM.', 'time');
        }
        return $time;
    }
}
