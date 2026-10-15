-- Fáze 7: zprávy v kampani. Vlákno (thread): 'group' = skupinový chat, 'dm:<id hráče>' = soukromá konverzace DM a hráče,
-- 'secret' = tajné zprávy od DM více hráčům. Soukromé a tajné zprávy vidí jen odesílatel a příjemci (message_recipients),
-- skupinové všichni členové kampaně.
CREATE TABLE messages (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  campaign_id CHAR(36) NOT NULL,
  sender_id CHAR(36) NOT NULL,
  thread VARCHAR(60) NOT NULL,
  body TEXT NOT NULL,
  created_at DATETIME NOT NULL,
  KEY messages_campaign_idx (campaign_id, id),
  KEY messages_thread_idx (campaign_id, thread, id),
  CONSTRAINT messages_campaign_fk FOREIGN KEY (campaign_id) REFERENCES campaigns (id) ON DELETE CASCADE,
  CONSTRAINT messages_sender_fk FOREIGN KEY (sender_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE message_recipients (
  message_id BIGINT UNSIGNED NOT NULL,
  user_id CHAR(36) NOT NULL,
  PRIMARY KEY (message_id, user_id),
  KEY message_recipients_user_idx (user_id, message_id),
  CONSTRAINT message_recipients_msg_fk FOREIGN KEY (message_id) REFERENCES messages (id) ON DELETE CASCADE,
  CONSTRAINT message_recipients_user_fk FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Do které zprávy ve vlákně už uživatel dočetl (podle toho se počítají nepřečtené).
CREATE TABLE message_reads (
  campaign_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  thread VARCHAR(60) NOT NULL,
  last_read_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (campaign_id, user_id, thread),
  CONSTRAINT message_reads_campaign_fk FOREIGN KEY (campaign_id) REFERENCES campaigns (id) ON DELETE CASCADE,
  CONSTRAINT message_reads_user_fk FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
