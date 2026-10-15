<?php
/**
 * Konfigurace API. Zkopíruj jako config.php (lokálně) nebo vyplň api/config.production.php (server).
 * Soubory config.php a config.production.php jsou v .gitignore a nikdy se necommitují.
 * Výchozí hodnoty níže odpovídají lokální databázi z docker-compose.yml.
 */
return [
    'db' => [
        'host' => '127.0.0.1',
        'port' => 3307,
        'name' => 'dnd',
        'user' => 'dnd',
        'password' => 'dnd',
    ],

    // Tajné heslo pro vytvoření účtu BEZ pozvánky (pro DM / prvního uživatele).
    // Hráči se registrují kódem pozvánky z kampaně. Prázdné = registrace jen s pozvánkou.
    'registration_key' => 'dev',

    // Klíč, kterým deploy spouští databázové migrace na serveru (POST /api/admin/migrate).
    // Prázdné = migrace přes web vypnuté. Na ostrém serveru nastav dlouhý náhodný řetězec.
    'migrate_key' => 'dev-migrate',

    // true vypíše do odpovědi podrobnosti chyb (jen pro lokální vývoj!).
    'debug' => true,
];
