-- Druhy itemů: wondrous, weapon, armor, shield, staff, wand, rod, scroll, potion, other (dřív armor, shield, weapon, item).
-- Všechny příkazy jde bezpečně pustit znovu (migrátor zapíše soubor až po posledním příkazu, takže po chybě poběží celý znovu).
ALTER TABLE character_items MODIFY kind VARCHAR(20) NOT NULL DEFAULT 'other';

-- Magické itemy podle kategorie z pravidel (stejně jako Items::kindForRule). Magické zbroje a zbraně s jasným základem
-- převede na skutečnou zbroj a zbraň oprava při seedu (Items::repairMagicGear), tady zůstanou wondrous.
UPDATE character_items i JOIN rules_entries r ON r.id = i.rule_id
  SET i.kind = CASE
    WHEN LOWER(r.category) LIKE 'potion%' THEN 'potion'
    WHEN LOWER(r.category) LIKE 'scroll%' THEN 'scroll'
    WHEN LOWER(r.category) LIKE 'wand%' THEN 'wand'
    WHEN LOWER(r.category) LIKE 'staff%' THEN 'staff'
    WHEN LOWER(r.category) LIKE 'rod%' THEN 'rod'
    WHEN LOWER(r.category) LIKE 'ammunition%' OR LOWER(r.category) LIKE 'weapon (ammunition%' OR LOWER(r.category) LIKE 'weapon (arrow%' THEN 'other'
    ELSE 'wondrous'
  END
  WHERE i.kind = 'item' AND r.kind = 'magic_item';

-- Ostatní (vybavení a vlastní itemy) podle začátku názvu, jinak other.
UPDATE character_items SET kind = 'potion' WHERE kind = 'item' AND name LIKE 'Potion%';
UPDATE character_items SET kind = 'scroll' WHERE kind = 'item' AND (name LIKE 'Scroll%' OR name LIKE 'Spell Scroll%');
UPDATE character_items SET kind = 'wand' WHERE kind = 'item' AND name LIKE 'Wand%';
UPDATE character_items SET kind = 'staff' WHERE kind = 'item' AND name LIKE 'Staff%';
UPDATE character_items SET kind = 'rod' WHERE kind = 'item' AND name LIKE 'Rod%';
UPDATE character_items SET kind = 'other' WHERE kind = 'item';
