-- Body na mapě od hráčů vidí všichni, kdo mapu vidí; dosavadní soukromé poznámky (owner) se zveřejní.
UPDATE map_pins SET visibility = 'all', updated_at = UTC_TIMESTAMP() WHERE visibility = 'owner';
