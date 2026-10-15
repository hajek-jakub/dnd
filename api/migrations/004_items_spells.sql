-- Fáze 4: kouzla postavy, inventář, koncentrace.

ALTER TABLE characters ADD COLUMN concentration VARCHAR(200) NULL;

-- Kouzla, která postava zná nebo má připravená. Odkaz na pravidla (SRD nebo homebrew).
CREATE TABLE character_spells (
  id CHAR(36) NOT NULL PRIMARY KEY,
  character_id CHAR(36) NOT NULL,
  rule_id CHAR(36) NOT NULL,
  -- seznam které třídy kouzlo patří (prázdné = mimo třídu, např. rasové nebo z itemu)
  class_idx VARCHAR(100) NOT NULL DEFAULT '',
  prepared TINYINT(1) NOT NULL DEFAULT 0,
  always_prepared TINYINT(1) NOT NULL DEFAULT 0,
  source VARCHAR(40) NOT NULL DEFAULT 'class',
  created_at DATETIME NOT NULL,
  UNIQUE KEY character_spells_uq (character_id, rule_id, class_idx),
  CONSTRAINT character_spells_char_fk FOREIGN KEY (character_id) REFERENCES characters (id) ON DELETE CASCADE,
  CONSTRAINT character_spells_rule_fk FOREIGN KEY (rule_id) REFERENCES rules_entries (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Inventář. Item vzniká jako kopie z pravidel (nebo vlastní), takže pozdější změna pravidel postavu nerozbije.
CREATE TABLE character_items (
  id CHAR(36) NOT NULL PRIMARY KEY,
  character_id CHAR(36) NOT NULL,
  rule_id CHAR(36) NULL,
  name VARCHAR(200) NOT NULL,
  description MEDIUMTEXT NOT NULL,
  kind ENUM('armor', 'shield', 'weapon', 'item') NOT NULL DEFAULT 'item',
  quantity INT NOT NULL DEFAULT 1,
  weight DECIMAL(9,2) NOT NULL DEFAULT 0,
  equipped TINYINT(1) NOT NULL DEFAULT 0,
  attuned TINYINT(1) NOT NULL DEFAULT 0,
  requires_attunement TINYINT(1) NOT NULL DEFAULT 0,
  rarity VARCHAR(20) NULL,
  -- JSON: {"armor": {...}} nebo {"weapon": {...}}
  stats TEXT NULL,
  -- JSON: seznam efektů [{"target": "ac", "value": 1, "source": "..."}]
  effects TEXT NULL,
  notes TEXT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  KEY character_items_char_idx (character_id),
  CONSTRAINT character_items_char_fk FOREIGN KEY (character_id) REFERENCES characters (id) ON DELETE CASCADE,
  CONSTRAINT character_items_rule_fk FOREIGN KEY (rule_id) REFERENCES rules_entries (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
