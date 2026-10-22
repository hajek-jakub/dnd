-- Plánování session: hráči (i DM) si v kalendáři označí dny, kdy můžou hrát, a DM zadá datum další session.
-- Datum a čas session jsou místní (Europe/Prague, `timezone` v konfiguraci), ne UTC: „25. 10. v 18:00“ je pro hráče stejné datum vždy.
CREATE TABLE session_availability (
  campaign_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  day DATE NOT NULL,
  PRIMARY KEY (campaign_id, user_id, day),
  KEY session_availability_day_idx (campaign_id, day),
  CONSTRAINT session_availability_campaign_fk FOREIGN KEY (campaign_id) REFERENCES campaigns (id) ON DELETE CASCADE,
  CONSTRAINT session_availability_user_fk FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE game_sessions (
  id CHAR(36) NOT NULL PRIMARY KEY,
  campaign_id CHAR(36) NOT NULL,
  session_date DATE NOT NULL,
  session_time CHAR(5) NULL,
  note VARCHAR(200) NOT NULL DEFAULT '',
  created_by CHAR(36) NULL,
  reminded_at DATETIME NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  UNIQUE KEY game_sessions_date_uq (campaign_id, session_date),
  KEY game_sessions_due_idx (reminded_at, session_date),
  CONSTRAINT game_sessions_campaign_fk FOREIGN KEY (campaign_id) REFERENCES campaigns (id) ON DELETE CASCADE,
  CONSTRAINT game_sessions_user_fk FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Nová kategorie push notifikací „sessions“ se zapne i zařízením, která už mají odběr (kdo má všechno vypnuté, zůstane vypnuté).
UPDATE push_subscriptions SET categories = CONCAT(categories, ',sessions') WHERE categories <> '' AND categories NOT LIKE '%sessions%';
