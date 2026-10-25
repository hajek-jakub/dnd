-- Barva motivu aplikace pro každého uživatele (#rrggbb); NULL = výchozí červená.
ALTER TABLE users ADD COLUMN accent VARCHAR(7) NULL;
