-- Pořadí map v kampani (DM dává důležité mapy dopředu). Stávající mapy mají 0 a řadí se dál podle data nahrání.
ALTER TABLE maps ADD COLUMN position INT NOT NULL DEFAULT 0;
