-- Spotřebovatelné itemy (šípy, šipky, lektvary, svitky): tlačítko Použít ubere kus a taktiky jimi platí střelbu.
ALTER TABLE character_items ADD COLUMN consumable TINYINT(1) NOT NULL DEFAULT 0 AFTER requires_attunement;
