-- XP a váha (nosnost) se v aplikaci nesledují. Sloupce se odstraňují, ať v DB nezůstávají mrtvá data.
ALTER TABLE characters DROP COLUMN xp;
ALTER TABLE character_items DROP COLUMN weight;
