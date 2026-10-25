-- Přehled NPC v deníku: jméno, rasa a popis (abecední seznam), propojené se zápisy deníku (příběh NPC).
-- character_id: záznam může vycházet z postavy nebo NPC postavy z kampaně (jméno a rasu pak ukazuje podle postavy);
-- smazáním postavy záznam zůstane s posledním známým jménem.
-- visibility: all = vidí všichni v kampani, dm = zatím jen DM (NPC, které družina ještě nepotkala).
CREATE TABLE journal_npcs (
  id CHAR(36) NOT NULL PRIMARY KEY,
  campaign_id CHAR(36) NOT NULL,
  character_id CHAR(36) NULL,
  name VARCHAR(100) NOT NULL,
  race VARCHAR(100) NOT NULL DEFAULT '',
  description TEXT NOT NULL,
  visibility ENUM('all', 'dm') NOT NULL DEFAULT 'all',
  created_by CHAR(36) NOT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  UNIQUE KEY journal_npcs_character_uq (campaign_id, character_id),
  KEY journal_npcs_campaign_idx (campaign_id, name),
  CONSTRAINT journal_npcs_campaign_fk FOREIGN KEY (campaign_id) REFERENCES campaigns (id) ON DELETE CASCADE,
  CONSTRAINT journal_npcs_character_fk FOREIGN KEY (character_id) REFERENCES characters (id) ON DELETE SET NULL,
  CONSTRAINT journal_npcs_user_fk FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Které NPC (a postavy) se v zápisu vyskytují.
CREATE TABLE journal_entry_npcs (
  entry_id CHAR(36) NOT NULL,
  npc_id CHAR(36) NOT NULL,
  PRIMARY KEY (entry_id, npc_id),
  KEY journal_entry_npcs_npc_idx (npc_id),
  CONSTRAINT journal_entry_npcs_entry_fk FOREIGN KEY (entry_id) REFERENCES journal_entries (id) ON DELETE CASCADE,
  CONSTRAINT journal_entry_npcs_npc_fk FOREIGN KEY (npc_id) REFERENCES journal_npcs (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
