-- Fáze 9: kostky. Hody se losují na serveru (nejde je zfalšovat z prohlížeče) a ukládají do sdíleného logu kampaně.
-- hidden = skrytý hod: vidí ho jen ten, kdo hodil, a DM.
CREATE TABLE dice_rolls (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  campaign_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  character_id CHAR(36) NULL,
  label VARCHAR(100) NOT NULL,
  expression VARCHAR(120) NOT NULL,
  mode ENUM('normal', 'advantage', 'disadvantage') NOT NULL DEFAULT 'normal',
  crit TINYINT(1) NOT NULL DEFAULT 0,
  hidden TINYINT(1) NOT NULL DEFAULT 0,
  total INT NOT NULL,
  result TEXT NOT NULL,
  created_at DATETIME NOT NULL,
  KEY dice_rolls_campaign_idx (campaign_id, id),
  CONSTRAINT dice_rolls_campaign_fk FOREIGN KEY (campaign_id) REFERENCES campaigns (id) ON DELETE CASCADE,
  CONSTRAINT dice_rolls_user_fk FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT dice_rolls_char_fk FOREIGN KEY (character_id) REFERENCES characters (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
