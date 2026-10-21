-- Push notifikace (Web Push). Odběr = jedno zařízení (prohlížeč) jednoho uživatele; kategorie si volí uživatel pro každé zařízení zvlášť.
-- endpoint_hash (SHA-256 adresy) je jedinečný: stejné zařízení po přihlášení jiného účtu odběr převezme, nikdy nemá dva majitele.
CREATE TABLE push_subscriptions (
  id CHAR(36) NOT NULL PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  endpoint VARCHAR(1000) NOT NULL,
  endpoint_hash CHAR(64) NOT NULL,
  p256dh VARCHAR(128) NOT NULL,
  auth VARCHAR(64) NOT NULL,
  categories VARCHAR(100) NOT NULL DEFAULT 'messages,dm,maps,journal',
  user_agent VARCHAR(200) NOT NULL DEFAULT '',
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  UNIQUE KEY push_subscriptions_endpoint_uq (endpoint_hash),
  KEY push_subscriptions_user_idx (user_id),
  CONSTRAINT push_subscriptions_user_fk FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Kdy byl uživatel naposledy vidět s otevřenou aplikací (každý dotaz /summary ho obnoví; ptá se jen viditelné okno).
-- Podle toho se rozhoduje, jestli push poslat: kdo má aplikaci otevřenou, žádný push nedostane.
CREATE TABLE user_presence (
  user_id CHAR(36) NOT NULL PRIMARY KEY,
  seen_at DATETIME NOT NULL,
  CONSTRAINT user_presence_user_fk FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tajemství aplikace vytvořená za běhu (klíč VAPID, kterým server podepisuje push). Vzniká při prvním použití, nemění se.
CREATE TABLE app_secrets (
  name VARCHAR(40) NOT NULL PRIMARY KEY,
  value TEXT NOT NULL,
  created_at DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
