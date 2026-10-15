-- Deník kampaně: informace od DM rozdělené podle témat (příběh, místa, postavy, frakce, domácí pravidla…).
-- visibility: all = všichni v kampani, selected = vybraní hráči (journal_viewers) a DM, dm = jen DM,
-- owner = soukromý zápis hráče (nevidí ho nikdo jiný, ani DM).
CREATE TABLE journal_entries (
  id CHAR(36) NOT NULL PRIMARY KEY,
  campaign_id CHAR(36) NOT NULL,
  topic VARCHAR(60) NOT NULL,
  title VARCHAR(120) NOT NULL,
  body MEDIUMTEXT NOT NULL,
  visibility ENUM('all', 'selected', 'dm', 'owner') NOT NULL DEFAULT 'all',
  -- připnuté zápisy se ukazují nahoře (jen DM)
  pinned TINYINT(1) NOT NULL DEFAULT 0,
  created_by CHAR(36) NOT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  KEY journal_entries_campaign_idx (campaign_id, updated_at),
  CONSTRAINT journal_entries_campaign_fk FOREIGN KEY (campaign_id) REFERENCES campaigns (id) ON DELETE CASCADE,
  CONSTRAINT journal_entries_user_fk FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE journal_viewers (
  entry_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  PRIMARY KEY (entry_id, user_id),
  CONSTRAINT journal_viewers_entry_fk FOREIGN KEY (entry_id) REFERENCES journal_entries (id) ON DELETE CASCADE,
  CONSTRAINT journal_viewers_user_fk FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Kdy uživatel naposledy otevřel deník (podle toho se počítají nové zápisy).
CREATE TABLE journal_reads (
  campaign_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  last_read_at DATETIME NOT NULL,
  PRIMARY KEY (campaign_id, user_id),
  CONSTRAINT journal_reads_campaign_fk FOREIGN KEY (campaign_id) REFERENCES campaigns (id) ON DELETE CASCADE,
  CONSTRAINT journal_reads_user_fk FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
