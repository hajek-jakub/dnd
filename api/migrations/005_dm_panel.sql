-- Fáze 6: DM panel. Efekty (bonusy) od DM a notifikace hráčům.

CREATE TABLE character_effects (
  id CHAR(36) NOT NULL PRIMARY KEY,
  character_id CHAR(36) NOT NULL,
  target VARCHAR(40) NOT NULL,
  value INT NOT NULL,
  source VARCHAR(100) NOT NULL,
  -- permanent = trvalé, long_rest = zmizí po long restu, manual = platí do ručního zrušení
  duration ENUM('permanent', 'long_rest', 'manual') NOT NULL DEFAULT 'manual',
  created_by CHAR(36) NULL,
  created_at DATETIME NOT NULL,
  KEY character_effects_char_idx (character_id),
  CONSTRAINT character_effects_char_fk FOREIGN KEY (character_id) REFERENCES characters (id) ON DELETE CASCADE,
  CONSTRAINT character_effects_user_fk FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Oznámení pro hráče ("DM ti dal: Bag of Holding"). Klient je průběžně dotazuje a zobrazuje.
CREATE TABLE notifications (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  campaign_id CHAR(36) NOT NULL,
  character_id CHAR(36) NULL,
  kind VARCHAR(30) NOT NULL,
  text VARCHAR(400) NOT NULL,
  created_at DATETIME NOT NULL,
  read_at DATETIME NULL,
  KEY notifications_user_idx (user_id, id),
  CONSTRAINT notifications_user_fk FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT notifications_campaign_fk FOREIGN KEY (campaign_id) REFERENCES campaigns (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
