-- Které zápisy deníku patří k bodu mapy (místo ↔ zápisy, oběma směry).
CREATE TABLE map_pin_entries (
  pin_id CHAR(36) NOT NULL,
  entry_id CHAR(36) NOT NULL,
  PRIMARY KEY (pin_id, entry_id),
  KEY map_pin_entries_entry_idx (entry_id),
  CONSTRAINT map_pin_entries_pin_fk FOREIGN KEY (pin_id) REFERENCES map_pins (id) ON DELETE CASCADE,
  CONSTRAINT map_pin_entries_entry_fk FOREIGN KEY (entry_id) REFERENCES journal_entries (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
