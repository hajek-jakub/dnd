<?php

declare(strict_types=1);

namespace Dnd\Controllers;

use Dnd\Auth;
use Dnd\Config;
use Dnd\Db;
use Dnd\HttpError;
use Dnd\Ids;
use Dnd\Input;
use Dnd\Invites;
use Dnd\RateLimiter;
use Dnd\Request;
use Dnd\Response;
use PDOException;

final class AuthController
{
    private const USERNAME_PATTERN = '/^[\p{L}\p{N}_.-]+$/u';

    /**
     * Registrace jménem a heslem. Povolená jen s platným kódem pozvánky (hráč se rovnou připojí
     * do kampaně) nebo s tajným registračním heslem z konfigurace (DM / první uživatel).
     */
    public static function register(Request $req): Response
    {
        RateLimiter::hit('register:' . $req->ip, 10, 3600);

        $data = $req->json();
        $username = Input::string($data, 'username', 3, 30, 'Jméno');
        if (preg_match(self::USERNAME_PATTERN, $username) !== 1) {
            throw HttpError::validation('Jméno smí obsahovat jen písmena, číslice, tečku, pomlčku a podtržítko.', 'username');
        }
        $password = Input::string($data, 'password', 0, 200, 'Heslo', trim: false);
        Auth::validatePassword($password);
        $displayName = Input::optionalString($data, 'displayName', 60, 'Zobrazované jméno');
        $displayName = ($displayName === null || $displayName === '') ? $username : $displayName;
        $code = Input::string($data, 'code', 1, 100, 'Kód pozvánky nebo registrační heslo');

        $registrationKey = (string) Config::get('registration_key', '');
        $usesKey = $registrationKey !== '' && hash_equals($registrationKey, $code);

        $user = Db::transaction(function () use ($username, $password, $displayName, $code, $usesKey): array {
            $invite = null;
            if (!$usesKey) {
                $invite = Invites::findValid($code, forUpdate: true);
                if ($invite === null) {
                    throw HttpError::forbidden('Kód pozvánky ani registrační heslo není platné.');
                }
            }

            $id = Ids::uuid();
            try {
                Db::exec(
                    'INSERT INTO users (id, username, display_name, password_hash, created_at)
                     VALUES (?, ?, ?, ?, UTC_TIMESTAMP())',
                    [$id, $username, $displayName, Auth::hashPassword($password)],
                );
            } catch (PDOException $e) {
                if ((int) ($e->errorInfo[1] ?? 0) === 1062) {
                    throw new HttpError(409, 'username_taken', 'Toto jméno už někdo používá.', 'username');
                }
                throw $e;
            }

            if ($invite !== null) {
                Invites::join($invite, $id);
            }
            return ['id' => $id, 'username' => $username, 'display_name' => $displayName];
        });

        Auth::startSession($user['id'], $req);
        return Response::json(['user' => Auth::payload($user)], 201);
    }

    public static function login(Request $req): Response
    {
        $data = $req->json();
        $username = Input::string($data, 'username', 1, 60, 'Jméno');
        $password = Input::string($data, 'password', 1, 200, 'Heslo', trim: false);

        // Limit na dvojici (IP, jméno) i na samotné jméno, ať se heslo nedá hádat ani z více adres.
        $keyIp = 'login:' . $req->ip . ':' . strtolower($username);
        $keyUser = 'login-user:' . strtolower($username);
        RateLimiter::hit($keyIp, 8, 900);
        RateLimiter::hit($keyUser, 30, 900);

        $row = Db::one('SELECT id, username, display_name, password_hash FROM users WHERE username = ?', [$username]);
        // I u neexistujícího jména se ověřuje hash, ať se podle rychlosti odpovědi nedá jméno uhodnout.
        $hash = $row['password_hash'] ?? '$2y$10$abcdefghijklmnopqrstuuAbCdEfGhIjKlMnOpQrStUvWxYzAbCdE';
        $ok = password_verify($password, (string) $hash);
        if ($row === null || !$ok) {
            throw new HttpError(401, 'invalid_credentials', 'Špatné jméno nebo heslo.');
        }

        RateLimiter::clear($keyIp);
        if (password_needs_rehash((string) $row['password_hash'], PASSWORD_DEFAULT)) {
            Db::exec('UPDATE users SET password_hash = ? WHERE id = ?', [Auth::hashPassword($password), $row['id']]);
        }

        Auth::startSession((string) $row['id'], $req);
        return Response::json(['user' => Auth::payload([
            'id' => (string) $row['id'],
            'username' => (string) $row['username'],
            'display_name' => (string) $row['display_name'],
        ])]);
    }

    public static function me(Request $req): Response
    {
        $user = Auth::currentUser($req);
        if ($user === null) {
            return Response::json(['user' => null]);
        }
        return Response::json(['user' => Auth::payload($user)]);
    }

    public static function logout(Request $req): Response
    {
        Auth::endSession($req);
        return Response::noContent();
    }

    /** @param array{id:string} $user */
    public static function changePassword(Request $req, array $params, array $user): Response
    {
        RateLimiter::hit('pwchange:' . $user['id'], 10, 900);
        $data = $req->json();
        $current = Input::string($data, 'currentPassword', 1, 200, 'Současné heslo', trim: false);
        $new = Input::string($data, 'newPassword', 0, 200, 'Nové heslo', trim: false);
        Auth::validatePassword($new);

        $hash = (string) Db::value('SELECT password_hash FROM users WHERE id = ?', [$user['id']]);
        if (!password_verify($current, $hash)) {
            throw new HttpError(403, 'invalid_credentials', 'Současné heslo nesedí.', 'currentPassword');
        }

        Db::exec('UPDATE users SET password_hash = ? WHERE id = ?', [Auth::hashPassword($new), $user['id']]);
        // Ostatní přihlášená zařízení se odhlásí; aktuální relace zůstává.
        $token = $req->cookie(Auth::COOKIE);
        Db::exec('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?', [$user['id'], hash('sha256', (string) $token)]);
        return Response::noContent();
    }

    /** @param array{id:string,username:string,display_name:string} $user */
    public static function updateProfile(Request $req, array $params, array $user): Response
    {
        $displayName = Input::string($req->json(), 'displayName', 1, 60, 'Zobrazované jméno');
        Db::exec('UPDATE users SET display_name = ? WHERE id = ?', [$displayName, $user['id']]);
        $user['display_name'] = $displayName;
        return Response::json(['user' => Auth::payload($user)]);
    }
}
