-- Loot DM: stromová struktura složek (dungeon -> místnosti) a v nich připravené itemy a zlato k rozdání.
-- IF NOT EXISTS: po chybě v půlce jde migrace pustit znovu.
CREATE TABLE IF NOT EXISTS loot_folders (
  id CHAR(36) NOT NULL PRIMARY KEY,
  campaign_id CHAR(36) NOT NULL,
  parent_id CHAR(36) NULL,
  name VARCHAR(120) NOT NULL,
  position INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL,
  KEY loot_folders_campaign_idx (campaign_id, parent_id, position),
  CONSTRAINT loot_folders_campaign_fk FOREIGN KEY (campaign_id) REFERENCES campaigns (id) ON DELETE CASCADE,
  CONSTRAINT loot_folders_parent_fk FOREIGN KEY (parent_id) REFERENCES loot_folders (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS loot_entries (
  id CHAR(36) NOT NULL PRIMARY KEY,
  campaign_id CHAR(36) NOT NULL,
  folder_id CHAR(36) NULL,
  kind ENUM('item', 'gold') NOT NULL,
  -- item: samostatná kopie vstupu itemu (stejný tvar jako při přidání vlastního itemu, včetně kletby), gold: mince a název
  data MEDIUMTEXT NOT NULL,
  position INT NOT NULL DEFAULT 0,
  -- komu už byl rozdán (jen text pro DM, položka zůstává k dalšímu použití)
  given_to VARCHAR(400) NOT NULL DEFAULT '',
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  KEY loot_entries_campaign_idx (campaign_id, folder_id, position),
  CONSTRAINT loot_entries_campaign_fk FOREIGN KEY (campaign_id) REFERENCES campaigns (id) ON DELETE CASCADE,
  CONSTRAINT loot_entries_folder_fk FOREIGN KEY (folder_id) REFERENCES loot_folders (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
