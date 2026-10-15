-- Fáze 8: mapy. DM nahraje obrázek mapy (uloží se mimo web, vydává ho jen autorizované API), na mapu přidává body (piny).
-- Souřadnice bodů jsou v pixelech obrázku (levý horní roh = 0,0), takže sedí i po změně velikosti zobrazení.
CREATE TABLE maps (
  id CHAR(36) NOT NULL PRIMARY KEY,
  campaign_id CHAR(36) NOT NULL,
  name VARCHAR(100) NOT NULL,
  image_path VARCHAR(200) NOT NULL,
  width INT NOT NULL,
  height INT NOT NULL,
  -- hráči vidí jen mapy, které DM zveřejnil
  visible TINYINT(1) NOT NULL DEFAULT 0,
  created_by CHAR(36) NULL,
  created_at DATETIME NOT NULL,
  KEY maps_campaign_idx (campaign_id),
  CONSTRAINT maps_campaign_fk FOREIGN KEY (campaign_id) REFERENCES campaigns (id) ON DELETE CASCADE,
  CONSTRAINT maps_user_fk FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- visibility: all = všichni, kdo mapu vidí; selected = vybraní hráči (map_pin_viewers) a DM; dm = jen DM;
-- owner = soukromá poznámka hráče, vidí ji jen její autor (ani DM ne)
CREATE TABLE map_pins (
  id CHAR(36) NOT NULL PRIMARY KEY,
  map_id CHAR(36) NOT NULL,
  x DOUBLE NOT NULL,
  y DOUBLE NOT NULL,
  title VARCHAR(100) NOT NULL,
  description TEXT NOT NULL,
  icon VARCHAR(20) NOT NULL DEFAULT 'pin',
  visibility ENUM('all', 'selected', 'dm', 'owner') NOT NULL DEFAULT 'all',
  created_by CHAR(36) NOT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  KEY map_pins_map_idx (map_id),
  CONSTRAINT map_pins_map_fk FOREIGN KEY (map_id) REFERENCES maps (id) ON DELETE CASCADE,
  CONSTRAINT map_pins_user_fk FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE map_pin_viewers (
  pin_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  PRIMARY KEY (pin_id, user_id),
  CONSTRAINT map_pin_viewers_pin_fk FOREIGN KEY (pin_id) REFERENCES map_pins (id) ON DELETE CASCADE,
  CONSTRAINT map_pin_viewers_user_fk FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
