<?php
// Pošle připomínky session, které už mají přijít (den předem od session_reminder_hour, v den session ještě jednou). Určeno pro cron na hostingu.
// Je bezpečné volat často (každých 15 minut): připomínka se pošle jen jednou. Aplikace je navíc spouští sama při každém /summary.
//
//   php api/bin/remind.php
declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require __DIR__ . '/../src/bootstrap_cli.php';

use Dnd\Push;
use Dnd\Sessions;

$sent = Sessions::remindDue();
// V CLI není odpověď, po které se push normálně odesílá, takže ho odešleme hned.
Push::flush();
fwrite(STDOUT, gmdate('c') . " odesláno připomínek: $sent\n");
