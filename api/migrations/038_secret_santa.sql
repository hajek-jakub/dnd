-- Secret Santa v kampani: losování (kdo komu dává dárek). Dvojice vidí jen dárce, a to až po odkrytí (revealed_at).
-- visible_until (UTC): od té chvíle se losování nikomu neukazuje.
CREATE TABLE secret_santa_draws (
  id CHAR(36) NOT NULL PRIMARY KEY,
  campaign_id CHAR(36) NOT NULL,
  title VARCHAR(80) NOT NULL,
  visible_until DATETIME NOT NULL,
  created_at DATETIME NOT NULL,
  KEY secret_santa_draws_campaign_idx (campaign_id),
  CONSTRAINT secret_santa_draws_campaign_fk FOREIGN KEY (campaign_id) REFERENCES campaigns (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE secret_santa_pairs (
  draw_id CHAR(36) NOT NULL,
  giver_id CHAR(36) NOT NULL,
  giver_label VARCHAR(80) NOT NULL,
  receiver_id CHAR(36) NOT NULL,
  receiver_label VARCHAR(80) NOT NULL,
  revealed_at DATETIME NULL,
  PRIMARY KEY (draw_id, giver_id),
  UNIQUE KEY secret_santa_pairs_receiver_uq (draw_id, receiver_id),
  CONSTRAINT secret_santa_pairs_draw_fk FOREIGN KEY (draw_id) REFERENCES secret_santa_draws (id) ON DELETE CASCADE,
  CONSTRAINT secret_santa_pairs_giver_fk FOREIGN KEY (giver_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT secret_santa_pairs_receiver_fk FOREIGN KEY (receiver_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
