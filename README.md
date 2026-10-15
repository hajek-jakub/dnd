# D&D kampaňová aplikace

Webová aplikace pro D&D 5e skupinu (DM + hráči): character sheet, DM panel, zprávy, mapy, kostky. Mobile-first, česky.

Architektura, konvence, příkazy a stav projektu jsou v [CLAUDE.md](CLAUDE.md). Postup nasazení je v [docs/NASAZENI.md](docs/NASAZENI.md).

## Rychlý start (lokálně)

1. Spusť Docker Desktop.
2. `npm install`
3. `npm run db:start` (poprvé stahuje obrazy, chvíli to trvá)
4. Zkopíruj `.env.example` do `.env.development.local` a doplň klíč z `npx supabase status -o env` (`PUBLISHABLE_KEY`).
5. `npm run dev`, otevři http://localhost:5173
6. Přihlašovací e-maily najdeš v Mailpitu: http://127.0.0.1:54324

## Licence obsahu

Herní obsah vychází z SRD 5.1 (CC-BY-4.0), atribuce bude na stránce „O aplikaci“ (fáze 2).
