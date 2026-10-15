<?php
// Konfigurace pro automatické testy (API testy a E2E). Používá oddělenou DB dnd_test.
return [
    'db' => ['host' => '127.0.0.1', 'port' => 3307, 'name' => 'dnd_test', 'user' => 'dnd', 'password' => 'dnd'],
    'registration_key' => 'test-key',
    'migrate_key' => 'test-migrate',
    'debug' => true,
    // Povolí hlavičku X-Test-Ip (simulace různých klientů pro rate limit). NIKDY ne na ostrém serveru.
    'trust_test_ip_header' => true,
];
