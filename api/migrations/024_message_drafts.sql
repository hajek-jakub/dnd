-- Připravené zprávy DM: text a příjemci se nachystají předem a odešlou jedním klepnutím (stejná logika a viditelnost jako běžná zpráva).
-- Koncept vidí jen jeho autor (DM). Příjemci: to_all = skupina, jinak řádky v message_draft_recipients (jeden hráč = soukromá zpráva, víc = tajná).
CREATE TABLE message_drafts (
  id CHAR(36) NOT NULL PRIMARY KEY,
  campaign_id CHAR(36) NOT NULL,
  author_id CHAR(36) NOT NULL,
  title VARCHAR(80) NOT NULL DEFAULT '',
  body TEXT NOT NULL,
  to_all TINYINT(1) NOT NULL DEFAULT 0,
  sent_at DATETIME NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  KEY message_drafts_author_idx (campaign_id, author_id, created_at),
  CONSTRAINT message_drafts_campaign_fk FOREIGN KEY (campaign_id) REFERENCES campaigns (id) ON DELETE CASCADE,
  CONSTRAINT message_drafts_author_fk FOREIGN KEY (author_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE message_draft_recipients (
  draft_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  PRIMARY KEY (draft_id, user_id),
  CONSTRAINT message_draft_recipients_draft_fk FOREIGN KEY (draft_id) REFERENCES message_drafts (id) ON DELETE CASCADE,
  CONSTRAINT message_draft_recipients_user_fk FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
