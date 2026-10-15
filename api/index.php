<?php
// Vstupní bod API. Tento soubor je záměrně napsaný staře (bez novinek PHP 8), aby šlo
// na starším PHP aspoň srozumitelně vypsat, že je potřeba novější verze.
if (PHP_VERSION_ID < 80000) {
    http_response_code(500);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(array('error' => array(
        'code' => 'php_version',
        'message' => 'Aplikace vyžaduje PHP 8.0 nebo novější (běží ' . PHP_VERSION . '). Přepni verzi PHP v administraci Endory.',
    )));
    exit;
}

require __DIR__ . '/src/bootstrap.php';
