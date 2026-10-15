<?php
// Nastaví uživateli nové heslo (reset zapomenutého hesla). Zruší i všechny jeho přihlášené relace.
//
//   NEW_PASSWORD='nove-heslo-123' php api/bin/set-password.php <přihlašovací jméno>
//
// Cílová DB je ta z api/config.php; pro ostrou ji vybereš jen pro tento jeden příkaz:
//   DND_CONFIG=api/config.production.php NEW_PASSWORD='...' php api/bin/set-password.php jakub
declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require __DIR__ . '/../src/bootstrap_cli.php';

use Dnd\Auth;
use Dnd\Config;
use Dnd\Db;

$username = $argv[1] ?? '';
$password = getenv('NEW_PASSWORD') ?: '';
if ($username === '' || $password === '') {
    fwrite(STDERR, "Použití: NEW_PASSWORD='nove-heslo' php api/bin/set-password.php <přihlašovací jméno>\n");
    exit(2);
}
$length = strlen($password);
if ($length < 8 || $length > 72) {
    fwrite(STDERR, "Heslo musí mít 8 až 72 bajtů.\n");
    exit(2);
}

$db = Config::get('db', []);
fwrite(STDOUT, 'Databáze: ' . ($db['name'] ?? '?') . ' @ ' . ($db['host'] ?? '?') . "\n");

$user = Db::one('SELECT id, username FROM users WHERE username = ?', [$username]);
if ($user === null) {
    fwrite(STDERR, "Uživatel \"$username\" neexistuje.\n");
    exit(3);
}
Db::exec('UPDATE users SET password_hash = ? WHERE id = ?', [Auth::hashPassword($password), $user['id']]);
Db::exec('DELETE FROM sessions WHERE user_id = ?', [$user['id']]);
fwrite(STDOUT, "Heslo uživatele {$user['username']} je změněné a všechny jeho relace jsou odhlášené.\n");
