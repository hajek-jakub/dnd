-- NPC: postava, za kterou hraje DM. Nepatří žádnému hráči ani DM (owner_id je NULL), DM jich může mít víc a hráči je vidí
-- (veřejný náhled) a můžou jim předávat peníze a itemy. Hráčská postava má kind 'pc'.
ALTER TABLE characters
  MODIFY owner_id CHAR(36) NULL,
  ADD COLUMN kind ENUM('pc', 'npc') NOT NULL DEFAULT 'pc' AFTER owner_id;

-- Nepřátelé: jednoduché záznamy jen pro DM (HP, AC, útoky), hráči o nich nic nevidí a nejde jim nic předat.
CREATE TABLE enemies (
  id CHAR(36) NOT NULL PRIMARY KEY,
  campaign_id CHAR(36) NOT NULL,
  name VARCHAR(100) NOT NULL,
  hp_max INT NOT NULL,
  hp_current INT NOT NULL,
  ac INT NULL,
  -- seznam útoků: [{name, toHit, damage}]
  attacks MEDIUMTEXT NOT NULL,
  notes TEXT NOT NULL,
  position INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  KEY enemies_campaign_idx (campaign_id, position),
  CONSTRAINT enemies_campaign_fk FOREIGN KEY (campaign_id) REFERENCES campaigns (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
