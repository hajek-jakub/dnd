-- Taktiky postavy (combat cheat sheet): útoky, kouzla, ki schopnosti, pasivky a reakce, komba a krátké poučky.
-- Jedna tabulka s typem a JSON daty (tvar dat podle typu hlídá server, viz Dnd\Tactics), řazení podle position.
CREATE TABLE character_tactics (
  id CHAR(36) NOT NULL PRIMARY KEY,
  character_id CHAR(36) NOT NULL,
  kind ENUM('attack', 'spell', 'ki', 'passive', 'combo', 'rule') NOT NULL,
  position INT NOT NULL DEFAULT 0,
  title VARCHAR(120) NOT NULL,
  data MEDIUMTEXT NOT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  KEY character_tactics_char_idx (character_id, kind, position),
  CONSTRAINT character_tactics_char_fk FOREIGN KEY (character_id) REFERENCES characters (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
