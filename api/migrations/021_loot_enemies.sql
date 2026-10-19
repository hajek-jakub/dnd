-- Nepřátelé v přípravě (loot): položka druhu 'enemy' je šablona nepřítele (stat blok a počet kusů), kterou DM pošle do boje.
-- drop_from: item nebo zlato, které z nepřítele padá (odkaz na položku 'enemy' ve stejné kampani). Bez cizího klíče:
-- při mazání složky by se smazání a nulování odkazů v jedné tabulce křížilo; neplatné odkazy aplikace při čtení ignoruje.
-- Jeden příkaz: když selže, nic se nezmění a migrace jde pustit znovu.
ALTER TABLE loot_entries
  MODIFY kind ENUM('item', 'gold', 'enemy') NOT NULL,
  ADD COLUMN drop_from CHAR(36) NULL AFTER folder_id,
  ADD KEY loot_entries_drop_idx (drop_from);
