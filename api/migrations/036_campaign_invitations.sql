-- Pozvánka existujícího uživatele do kampaně: DM ho pozve přihlašovacím jménem, pozvaný ji přijme (stane se hráčem) nebo odmítne.
-- Přijetí i odmítnutí řádek smaže; jeden uživatel má do jedné kampaně nejvýš jednu čekající pozvánku.
CREATE TABLE campaign_invitations (
  id CHAR(36) NOT NULL PRIMARY KEY,
  campaign_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  invited_by CHAR(36) NOT NULL,
  created_at DATETIME NOT NULL,
  UNIQUE KEY campaign_invitations_uq (campaign_id, user_id),
  KEY campaign_invitations_user_idx (user_id),
  CONSTRAINT campaign_invitations_campaign_fk FOREIGN KEY (campaign_id) REFERENCES campaigns (id) ON DELETE CASCADE,
  CONSTRAINT campaign_invitations_user_fk FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT campaign_invitations_inviter_fk FOREIGN KEY (invited_by) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Nová kategorie push notifikací „invites“ se zapne i zařízením, která už mají odběr (kdo má všechno vypnuté, zůstane vypnuté).
UPDATE push_subscriptions SET categories = CONCAT(categories, ',invites') WHERE categories <> '' AND categories NOT LIKE '%invites%';
