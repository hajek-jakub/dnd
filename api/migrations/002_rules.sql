-- Fáze 2: pravidla (SRD 5.1 + katalog itemů) a homebrew obsah v jedné tabulce.
-- Jeden řádek = jedna položka (kouzlo, item, featura, třída, ...). Filtrovatelné údaje jsou ve sloupcích,
-- zbytek (např. komponenty kouzla, tabulky tříd) v JSON sloupci data. Český překlad se doplní do name_cs / desc_cs.

CREATE TABLE rules_entries (
  id CHAR(36) NOT NULL PRIMARY KEY,
  -- sada pravidel: srd51 = SRD 5.1 (2014); později např. srd52 (2024). 'ref' = jen odkazový záznam mimo SRD
  ruleset VARCHAR(12) NOT NULL,
  kind VARCHAR(20) NOT NULL,
  idx VARCHAR(100) NOT NULL,
  -- id kampaně u homebrew, prázdné u oficiálního obsahu (kvůli unikátnímu klíči)
  scope CHAR(36) NOT NULL DEFAULT '',
  name VARCHAR(200) NOT NULL,
  name_cs VARCHAR(200) NULL,
  desc_text MEDIUMTEXT NOT NULL,
  desc_cs MEDIUMTEXT NULL,
  level TINYINT NULL,
  category VARCHAR(80) NULL,
  rarity VARCHAR(20) NULL,
  attunement TINYINT(1) NULL,
  source VARCHAR(40) NOT NULL,
  is_srd TINYINT(1) NOT NULL DEFAULT 0,
  price_gp DECIMAL(14,2) NULL,
  price_note VARCHAR(160) NULL,
  ref_url VARCHAR(255) NULL,
  -- oddělené svislítky pro filtr, např. |Wizard|Sorcerer| (třídy kouzla)
  tags VARCHAR(255) NOT NULL DEFAULT '',
  data MEDIUMTEXT NOT NULL,
  campaign_id CHAR(36) NULL,
  owner_id CHAR(36) NULL,
  visibility ENUM('campaign', 'private') NOT NULL DEFAULT 'campaign',
  seed_batch CHAR(12) NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  UNIQUE KEY rules_entry_uq (ruleset, kind, idx, scope),
  KEY rules_kind_name_idx (kind, name),
  KEY rules_kind_level_idx (kind, level),
  KEY rules_campaign_idx (campaign_id),
  KEY rules_seed_idx (seed_batch),
  CONSTRAINT rules_campaign_fk FOREIGN KEY (campaign_id) REFERENCES campaigns (id) ON DELETE CASCADE,
  CONSTRAINT rules_owner_fk FOREIGN KEY (owner_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE seed_state (
  name VARCHAR(40) NOT NULL PRIMARY KEY,
  hash CHAR(64) NOT NULL,
  seeded_at DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
