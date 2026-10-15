-- Iniciativa v kampani (vidí a řídí ji jen DM): pořadí postav (hráči, NPC) a nepřátel v boji.
-- Hodnota se zapisuje sama z hodu na iniciativu a DM pořadí ručně přetahuje, takže pořadí drží `position`.
CREATE TABLE initiative_entries (
  campaign_id CHAR(36) NOT NULL,
  subject_kind ENUM('character', 'enemy') NOT NULL,
  subject_id CHAR(36) NOT NULL,
  value INT NULL,
  position INT NOT NULL,
  PRIMARY KEY (campaign_id, subject_kind, subject_id),
  KEY initiative_order_idx (campaign_id, position),
  CONSTRAINT initiative_campaign_fk FOREIGN KEY (campaign_id) REFERENCES campaigns (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Kdo je zrovna na tahu a které je kolo.
CREATE TABLE initiative_state (
  campaign_id CHAR(36) NOT NULL PRIMARY KEY,
  active_kind ENUM('character', 'enemy') NULL,
  active_id CHAR(36) NULL,
  round INT NOT NULL DEFAULT 1,
  CONSTRAINT initiative_state_campaign_fk FOREIGN KEY (campaign_id) REFERENCES campaigns (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Bonus nepřítele k hodu na iniciativu.
ALTER TABLE enemies ADD COLUMN initiative INT NOT NULL DEFAULT 0 AFTER ac;
