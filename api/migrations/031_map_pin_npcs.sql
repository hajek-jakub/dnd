-- Které NPC a postavy z přehledu deníku se nacházejí na bodu mapy (místo ↔ postavy, oběma směry).
CREATE TABLE map_pin_npcs (
  pin_id CHAR(36) NOT NULL,
  npc_id CHAR(36) NOT NULL,
  PRIMARY KEY (pin_id, npc_id),
  KEY map_pin_npcs_npc_idx (npc_id),
  CONSTRAINT map_pin_npcs_pin_fk FOREIGN KEY (pin_id) REFERENCES map_pins (id) ON DELETE CASCADE,
  CONSTRAINT map_pin_npcs_npc_fk FOREIGN KEY (npc_id) REFERENCES journal_npcs (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
