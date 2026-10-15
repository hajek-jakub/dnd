-- Databáze pro testy (API testy a E2E). Vývojová DB "dnd" se vytvoří přes MYSQL_DATABASE.
CREATE DATABASE IF NOT EXISTS dnd_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
GRANT ALL PRIVILEGES ON dnd_test.* TO 'dnd'@'%';
FLUSH PRIVILEGES;
