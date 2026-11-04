-- Opotřebení zbraně a zlodějského náčiní: po nat 1 se na k20 přehodí číslo (1, pak 2, 3… až 20).
-- 0 = v pořádku (tmavé), broken = zbraň je rozbitá, dokud ji někdo neopraví (počítadlo se vynuluje).
ALTER TABLE character_items
  ADD COLUMN nat1 TINYINT UNSIGNED NOT NULL DEFAULT 0 AFTER charges_recharge,
  ADD COLUMN broken TINYINT(1) NOT NULL DEFAULT 0 AFTER nat1;
