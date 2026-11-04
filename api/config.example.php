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

    // AI pomocník DM (Claude API). Bez klíče je vypnutý. Klíč z Claude Console (API Keys), nikdy ho necommituj.
    // 'claude_api_key' => 'sk-ant-...',
    // Pomocníka má každý DM (jen v kampaních, kde je DM). Osobní limit útraty jednoho uživatele za kalendářní měsíc v USD (výchozí 2).
    // 'claude_user_monthly_budget_usd' => 2,
    // Účty bez osobního limitu (přihlašovací jména, `*` na konci = začátek jména); platí pro ně jen společný strop.
    // 'claude_users' => ['jakub'],
    // Společný strop útraty za kalendářní měsíc v USD (všechna volání dohromady); pak AI do konce měsíce neodpoví.
    // 'claude_monthly_budget_usd' => 10,
    // Model a úsilí (low | medium | high | xhigh | max); výchozí claude-opus-5-5 a medium.
    // 'claude_model' => 'claude-opus-5-5',
    // 'claude_effort' => 'medium',
];
