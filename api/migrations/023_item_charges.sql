-- Náboje itemů (Wand of Wonder 7, Staff of Healing 10…): maximum, kolik je spotřebovaných a jak se obnovují
-- („1d6+1“ hod za úsvitu, „all“ = všechny, NULL = samy se neobnovují). Item bez nábojů má charges_max NULL.
-- Jeden příkaz: když selže, nic se nezmění a migrace jde pustit znovu.
ALTER TABLE character_items
  ADD COLUMN charges_max SMALLINT NULL AFTER quantity,
  ADD COLUMN charges_used SMALLINT NOT NULL DEFAULT 0 AFTER charges_max,
  ADD COLUMN charges_recharge VARCHAR(40) NULL AFTER charges_used;
