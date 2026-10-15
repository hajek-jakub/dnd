-- Fáze 1: uživatelé, sessions, kampaně, členství (role per kampaň), pozvánky,
-- minimální postavy a soukromé DM poznámky.
-- Kompatibilní s MySQL 5.7+ / MariaDB 10.3+. Všechny časy jsou v UTC.

CREATE TABLE users (
  id CHAR(36) NOT NULL PRIMARY KEY,
  username VARCHAR(30) NOT NULL,
  display_name VARCHAR(60) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at DATETIME NOT NULL,
  -- collation není citlivá na velikost písmen, takže "Jakub" a "jakub" je stejné jméno
  UNIQUE KEY users_username_uq (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE sessions (
  token_hash CHAR(64) NOT NULL PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  created_at DATETIME NOT NULL,
  last_seen DATETIME NOT NULL,
  expires_at DATETIME NOT NULL,
  KEY sessions_user_idx (user_id),
  KEY sessions_expires_idx (expires_at),
  CONSTRAINT sessions_user_fk FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE rate_limits (
  rkey CHAR(64) NOT NULL PRIMARY KEY,
  window_start INT NOT NULL,
  hits INT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE campaigns (
  id CHAR(36) NOT NULL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  description TEXT NOT NULL,
  -- JSON jako text (např. {"encumbrance": false}); pravidla se doplní v dalších fázích
  settings TEXT NOT NULL,
  created_by CHAR(36) NOT NULL,
  created_at DATETIME NOT NULL,
  CONSTRAINT campaigns_creator_fk FOREIGN KEY (created_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE campaign_members (
  campaign_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  role ENUM('dm', 'player') NOT NULL,
  joined_at DATETIME NOT NULL,
  PRIMARY KEY (campaign_id, user_id),
  KEY members_user_idx (user_id),
  CONSTRAINT members_campaign_fk FOREIGN KEY (campaign_id) REFERENCES campaigns (id) ON DELETE CASCADE,
  CONSTRAINT members_user_fk FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE invites (
  id CHAR(36) NOT NULL PRIMARY KEY,
  campaign_id CHAR(36) NOT NULL,
  code CHAR(10) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_by CHAR(36) NOT NULL,
  created_at DATETIME NOT NULL,
  expires_at DATETIME NULL,
  max_uses INT NULL,
  uses INT NOT NULL DEFAULT 0,
  revoked TINYINT(1) NOT NULL DEFAULT 0,
  -- kód se porovnává přesně (binární collation), ať jsou velká a malá písmena jednoznačná
  UNIQUE KEY invites_code_uq (code),
  KEY invites_campaign_idx (campaign_id),
  CONSTRAINT invites_campaign_fk FOREIGN KEY (campaign_id) REFERENCES campaigns (id) ON DELETE CASCADE,
  CONSTRAINT invites_creator_fk FOREIGN KEY (created_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Minimální postava; plný character sheet přijde ve fázi 3.
CREATE TABLE characters (
  id CHAR(36) NOT NULL PRIMARY KEY,
  campaign_id CHAR(36) NOT NULL,
  owner_id CHAR(36) NOT NULL,
  name VARCHAR(100) NOT NULL,
  race VARCHAR(100) NOT NULL DEFAULT '',
  class_summary VARCHAR(200) NOT NULL DEFAULT '',
  level INT NOT NULL DEFAULT 1,
  photo_path VARCHAR(255) NULL,
  -- soukromá část: ostatní hráči ji nevidí, pokud DM nenastaví visibility = 'full'
  notes TEXT NOT NULL,
  visibility ENUM('public_only', 'full') NOT NULL DEFAULT 'public_only',
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  UNIQUE KEY characters_id_campaign_uq (id, campaign_id),
  KEY characters_campaign_idx (campaign_id),
  KEY characters_owner_idx (owner_id),
  CONSTRAINT characters_campaign_fk FOREIGN KEY (campaign_id) REFERENCES campaigns (id) ON DELETE CASCADE,
  CONSTRAINT characters_owner_fk FOREIGN KEY (owner_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE dm_notes (
  id CHAR(36) NOT NULL PRIMARY KEY,
  campaign_id CHAR(36) NOT NULL,
  character_id CHAR(36) NULL,
  author_id CHAR(36) NOT NULL,
  body TEXT NOT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  KEY dm_notes_campaign_idx (campaign_id),
  CONSTRAINT dm_notes_campaign_fk FOREIGN KEY (campaign_id) REFERENCES campaigns (id) ON DELETE CASCADE,
  -- poznámka k postavě musí patřit do stejné kampaně jako postava
  CONSTRAINT dm_notes_character_fk FOREIGN KEY (character_id, campaign_id)
    REFERENCES characters (id, campaign_id) ON DELETE CASCADE,
  CONSTRAINT dm_notes_author_fk FOREIGN KEY (author_id) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
