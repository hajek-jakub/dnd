-- Kletba na itemu: text vidí jen DM, dokud ji neodkryje (curse_revealed = 1). Hráči se neodhalená kletba do odpovědi vůbec nedostane.
-- Jediný příkaz: buď proběhne celý, nebo vůbec.
ALTER TABLE character_items
  ADD COLUMN curse TEXT NULL AFTER notes,
  ADD COLUMN curse_revealed TINYINT(1) NOT NULL DEFAULT 0 AFTER curse;
