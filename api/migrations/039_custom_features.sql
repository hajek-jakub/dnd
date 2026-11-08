-- Vlastní featury postavy, které engine nezná (manévry Battle Master, schopnosti z rasy nebo od DM).
-- JSON seznam [{id, name, source, description}], NULL = žádné.
ALTER TABLE characters
  ADD COLUMN custom_features MEDIUMTEXT NULL AFTER extra_proficiencies;
