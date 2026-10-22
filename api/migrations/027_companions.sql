-- Společníci a přivolaná stvoření (familiar, animal companion, summon): malé karty patřící postavě, ne nepřátelé v Panelu DM.
-- Vidí je majitel postavy, DM a členové, kteří vidí postavu celou; upravuje majitel a DM. Smazáním postavy zmizí i oni.
CREATE TABLE character_companions (
  id CHAR(36) NOT NULL PRIMARY KEY,
  character_id CHAR(36) NOT NULL,
  name VARCHAR(100) NOT NULL,
  hp_max INT NOT NULL,
  hp_current INT NOT NULL,
  ac INT NULL,
  -- seznam útoků: [{name, toHit, damage}], stejný tvar jako u nepřátel
  attacks MEDIUMTEXT NOT NULL,
  notes TEXT NOT NULL,
  position INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  KEY character_companions_character_idx (character_id, position),
  CONSTRAINT character_companions_character_fk FOREIGN KEY (character_id) REFERENCES characters (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
