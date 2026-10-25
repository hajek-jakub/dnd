-- Chat: odpověď na zprávu (reply_to_id, jen odkaz bez cizího klíče: zpráva mizí jen s kampaní), úprava vlastní zprávy (edited_at)
-- a smazání (deleted_at; text se při smazání vymaže, zpráva v chatu zůstane jako „smazaná“, ať odpovědi nevisí ve vzduchu).
ALTER TABLE messages
  ADD COLUMN reply_to_id BIGINT UNSIGNED NULL,
  ADD COLUMN edited_at DATETIME NULL,
  ADD COLUMN deleted_at DATETIME NULL;

-- Emoji reakce: jedna reakce daného emoji od jednoho uživatele na jednu zprávu. Vidí je ten, kdo vidí zprávu.
CREATE TABLE message_reactions (
  message_id BIGINT UNSIGNED NOT NULL,
  user_id CHAR(36) NOT NULL,
  emoji VARCHAR(16) NOT NULL,
  created_at DATETIME NOT NULL,
  PRIMARY KEY (message_id, user_id, emoji),
  KEY message_reactions_user_idx (user_id),
  CONSTRAINT message_reactions_msg_fk FOREIGN KEY (message_id) REFERENCES messages (id) ON DELETE CASCADE,
  CONSTRAINT message_reactions_user_fk FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
