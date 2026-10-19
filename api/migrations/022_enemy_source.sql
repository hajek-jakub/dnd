-- Nepřítel v boji si pamatuje šablonu z přípravy, ze které vznikl: Panel DM pak u něj ukáže, jaký loot z něj padá.
ALTER TABLE enemies
  ADD COLUMN source_entry_id CHAR(36) NULL AFTER campaign_id,
  ADD CONSTRAINT enemies_source_fk FOREIGN KEY (source_entry_id) REFERENCES loot_entries (id) ON DELETE SET NULL;
