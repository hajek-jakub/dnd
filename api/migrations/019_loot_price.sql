-- Cena položky lootu: NULL = nalezená věc (zdarma), číslo = na prodej (v měďácích); při rozdání ji příjemce zaplatí s rozměněním jako „Utratit“.
ALTER TABLE loot_entries ADD COLUMN price_cp INT NULL AFTER data;
