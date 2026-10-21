<?php
// Konfigurace pro automatické testy (API testy a E2E). Používá oddělenou DB dnd_test.
return [
    'db' => ['host' => '127.0.0.1', 'port' => 3307, 'name' => 'dnd_test', 'user' => 'dnd', 'password' => 'dnd'],
    'registration_key' => 'test-key',
    'migrate_key' => 'test-migrate',
    'debug' => true,
    // Povolí hlavičku X-Test-Ip (simulace různých klientů pro rate limit). NIKDY ne na ostrém serveru.
    'trust_test_ip_header' => true,
    // Nahrané soubory testů se ukládají do dočasné složky, ne do api/storage.
    'storage_dir' => sys_get_temp_dir() . '/dnd-test-storage',
    // AI pomocník proti napodobenému serveru (scripts/claude-mock.mjs), žádné skutečné volání. Pomocníka smí jen účty začínající „aidm“.
    'claude_api_key' => 'test-claude-key',
    'claude_base_url' => 'http://127.0.0.1:8199',
    'claude_users' => ['aidm*'],
    'claude_monthly_budget_usd' => 5,
    // Push notifikace proti napodobené push službě (scripts/push-mock.mjs), žádné skutečné volání. Adresy odběrů jen z tohoto seznamu.
    'push_test_hosts' => ['127.0.0.1:8198'],
    // Kratší doba „aplikace je otevřená“, ať testy nečekají 12 sekund.
    'push_presence_seconds' => 3,
];
