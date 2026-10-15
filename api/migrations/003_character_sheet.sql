-- Fáze 3: character sheet. Rozšíření tabulky characters, historie levelů a zdroje.
-- JSON sloupce jsou TEXT NULL (NULL = výchozí hodnota), aby migrace fungovala na MySQL i MariaDB bez výrazových defaultů.

ALTER TABLE characters
  ADD COLUMN subrace VARCHAR(100) NOT NULL DEFAULT '',
  ADD COLUMN background VARCHAR(100) NOT NULL DEFAULT '',
  ADD COLUMN alignment VARCHAR(40) NOT NULL DEFAULT '',
  ADD COLUMN xp INT NOT NULL DEFAULT 0,
  ADD COLUMN inspiration TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN abil_str TINYINT UNSIGNED NOT NULL DEFAULT 10,
  ADD COLUMN abil_dex TINYINT UNSIGNED NOT NULL DEFAULT 10,
  ADD COLUMN abil_con TINYINT UNSIGNED NOT NULL DEFAULT 10,
  ADD COLUMN abil_int TINYINT UNSIGNED NOT NULL DEFAULT 10,
  ADD COLUMN abil_wis TINYINT UNSIGNED NOT NULL DEFAULT 10,
  ADD COLUMN abil_cha TINYINT UNSIGNED NOT NULL DEFAULT 10,
  ADD COLUMN base_speed SMALLINT NOT NULL DEFAULT 30,
  ADD COLUMN hp_current INT NULL,
  ADD COLUMN hp_temp INT NOT NULL DEFAULT 0,
  ADD COLUMN death_successes TINYINT NOT NULL DEFAULT 0,
  ADD COLUMN death_failures TINYINT NOT NULL DEFAULT 0,
  ADD COLUMN pact_slots_used TINYINT NOT NULL DEFAULT 0,
  ADD COLUMN hit_dice_used TEXT NULL,
  ADD COLUMN slots_used TEXT NULL,
  ADD COLUMN conditions TEXT NULL,
  ADD COLUMN skill_proficiencies TEXT NULL,
  ADD COLUMN extra_save_proficiencies TEXT NULL,
  ADD COLUMN extra_proficiencies TEXT NULL,
  ADD COLUMN subclasses TEXT NULL,
  ADD COLUMN overrides TEXT NULL,
  ADD COLUMN personality TEXT NULL,
  ADD COLUMN description TEXT NULL,
  ADD COLUMN currency TEXT NULL,
  ADD COLUMN rev INT NOT NULL DEFAULT 0;

-- Každý získaný level jako jeden řádek (pořadí = seq). Z toho se skládají třídy, HP a historie level upů.
CREATE TABLE character_levels (
  id CHAR(36) NOT NULL PRIMARY KEY,
  character_id CHAR(36) NOT NULL,
  seq SMALLINT NOT NULL,
  class_idx VARCHAR(100) NOT NULL,
  -- hozený hit die; NULL = průměr (první level vždy plná kostka)
  hp_roll TINYINT NULL,
  -- volby při levelu (ASI, feat, kouzla, ...) jako JSON; využije level up ve fázi 5
  choices TEXT NULL,
  created_at DATETIME NOT NULL,
  UNIQUE KEY character_levels_seq_uq (character_id, seq),
  CONSTRAINT character_levels_char_fk FOREIGN KEY (character_id) REFERENCES characters (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Zdroje (ki, rage, sloty vlastních zdrojů...). Třídní zdroje mají jen aktuální hodnotu (max počítá engine),
-- vlastní zdroje mají i název, maximum a způsob obnovy.
CREATE TABLE character_resources (
  character_id CHAR(36) NOT NULL,
  rkey VARCHAR(80) NOT NULL,
  current_value INT NOT NULL DEFAULT 0,
  is_custom TINYINT(1) NOT NULL DEFAULT 0,
  name VARCHAR(80) NULL,
  max_value INT NULL,
  recharge ENUM('short', 'long', 'dawn', 'manual') NULL,
  PRIMARY KEY (character_id, rkey),
  CONSTRAINT character_resources_char_fk FOREIGN KEY (character_id) REFERENCES characters (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
