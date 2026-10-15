# D&D kampaňová aplikace

Webová aplikace pro D&D 5e skupinu (DM + hráči): character sheet, DM panel, zprávy, mapy, kostky. Mobile-first, česky.
Celé to běží na Endoře: statický frontend (React), PHP API a MySQL.

Architektura, konvence, příkazy a stav projektu jsou v [CLAUDE.md](CLAUDE.md). Postup nasazení je v [docs/NASAZENI.md](docs/NASAZENI.md). Jak aplikaci používat (hráč a DM) je v [docs/NAVOD.md](docs/NAVOD.md).

## Rychlý start (lokálně)

Potřebuješ Node.js, PHP 8 a Docker Desktop (pro MySQL).

1. Spusť Docker Desktop.
2. `npm install`
3. `npm run db:start` (spustí MySQL v Dockeru a založí tabulky)
4. `npm start` (spustí PHP API na portu 8080 a web na http://localhost:5173)
5. Otevři http://localhost:5173, klepni na „Zaregistruj se“ a jako registrační heslo zadej `dev`.

Testy: `npm run test:all` (typy, lint, unit testy, API testy, E2E v Chromiu na počítači i telefonu, včetně kontroly přístupnosti a rozložení všech stránek). `npm run test:csp` ověří, že produkční build běží pod Content Security Policy.

**Pozor:** proměnnou `DND_CONFIG` nikdy neexportuj do shellu (viz CLAUDE.md, sekce o pojistkách).

## Licence obsahu

Herní obsah vychází z SRD 5.1 (CC-BY-4.0), atribuce je na stránce „O aplikaci“.
