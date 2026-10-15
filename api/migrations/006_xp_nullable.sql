-- Fáze 6b: XP může být "nedoplněno" (NULL), třeba u postavy přepsané z papírového sheetu. NULL se v UI ukáže jako "nedoplněno";
-- jakákoli změna XP (DM, level up, adjust) bere NULL jako 0.
ALTER TABLE characters MODIFY xp INT NULL DEFAULT 0;
