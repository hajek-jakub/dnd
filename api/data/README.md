# Data pravidel

- `srd51/*.json`: SRD 5.1 (D&D 5e, 2014) z repozitáře [5e-bits/5e-database](https://github.com/5e-bits/5e-database) (`src/2014/en`), beze změn.
  Obsah SRD 5.1 © Wizards of the Coast, licence CC-BY-4.0. Atribuce je na stránce „O aplikaci“.
- `extra/item-catalog.json`: katalog magických itemů (jen fakta: název, typ, vzácnost, attunement, zdroj, cena, odkaz),
  sestavený skriptem `scripts/data/build-item-catalog.mjs` z aidedd.org (seznam) a app.eventyrgames.com (ceny).
  Popisy itemů mimo SRD se nekopírují.

Načtení do databáze: `php api/bin/seed.php` lokálně, na serveru ho spouští deploy (`POST /api/admin/seed`).
Seed je idempotentní a přeskočí se, pokud se data nezměnila.
