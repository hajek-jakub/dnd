# D&D kampaňová aplikace

Webová aplikace pro D&D 5e skupinu (DM + 3–6 hráčů). Nahrazuje papírový character sheet, DM má vlastní panel.
Mobile-first (hráči z telefonů), ale DM hraje na počítači, takže vše musí fungovat na obou. UI česky, herní obsah anglicky (SRD 5.1).

## Důležité rozhodnutí: vše na Endoře, žádný Supabase

Hosting je **Endora** (Apache, PHP, MySQL, FTP, žádné Node ani Postgres). Původní zadání počítalo se Supabase (Postgres + RLS + Realtime),
to na Endoře nejde, proto je backend **vlastní PHP API + MySQL**. Důsledky pro původní zadání:

| Původní zadání | Skutečnost |
| --- | --- |
| Supabase Auth (magic link) | Přihlášení jménem a heslem, vlastní relace (tabulka `sessions`, HttpOnly cookie) |
| Row Level Security v Postgresu | Autorizace v PHP (`api/src/Access.php` + kontroly v controllerech), vynucená a testovaná na úrovni API |
| Postgres funkce (RPC) | PHP endpointy, kritické operace v DB transakcích |
| Realtime | Polling (react-query `refetchInterval`, zatím 10 s); později případně kratší u zpráv/hodů |
| Supabase Storage | Nahrávání do složky na FTP přes PHP (až ve fázích s fotkami a mapami) |
| Migrace Supabase | SQL migrace v `api/migrations/*.sql` + vlastní runner |
| Typy z DB schématu | Ručně psané typy v `src/lib/types.ts` (sladit s API) |
| `VITE_` proměnné pro Supabase | Nepotřeba: frontend volá `/api` na vlastním originu, nic tajného v buildu |

## Architektura

- **Frontend**: Vite + React 19 + React Router + TypeScript (strict), Tailwind v4 + shadcn/ui (styl base-nova, `src/components/ui`). Statická SPA.
- **Backend**: PHP 8.0+ bez frameworku a bez Composeru (na Endoře nejde spustit). `api/index.php` je front controller, kód v `api/src` (namespace `Dnd\`, vlastní autoloader).
  Nepoužívat funkce PHP 8.1+ (`readonly`, `array_is_list`, enumy, `never`, standalone `null` typ ...).
- **DB**: MySQL 5.7+/MariaDB 10.3+, InnoDB, utf8mb4, všechny časy v UTC (`DATETIME`, API vrací ISO 8601 s `Z`). ID jsou UUID v4 (`CHAR(36)`).
- **API**: JSON, camelCase, chyby ve tvaru `{"error":{"code","message","field?"}}`. Stejný origin jako frontend (`/api/...`), cookie `dnd_session`.
- **Hosting**: `dnd.hajekjakub.cz` = automatická subdoména Endory (složka `_sub/dnd` v kořeni domény). Nasazuje se samostatným FTP účtem zamčeným do `_sub/dnd` (`FTP_JAILED=true`). Účet `jakubhajek` (stafeta) je zamčený v `public_html` a na `_sub` nedosáhne. `npm run deploy` nahraje `dist/` + `api/` a zavolá migrace.
- **Stav v klientu**: TanStack Query s optimistickými aktualizacemi (rollback při chybě). Vzor: `src/features/campaigns/api.ts`.
- **Pravidlový engine** (od fáze 3): čisté TS funkce v `src/engine/`, bez UI a DB, pokryté Vitestem.

### Adresáře

```
src/components/        sdílené komponenty (AppLayout, theme, ui/ = shadcn)
src/features/<modul>/  auth, campaigns, profile, rules (procházeč pravidel + homebrew), sheet (postava), about (další: inventory, levelup, dm, messages, maps, dice)
src/lib/               api.ts (fetch klient), types.ts (tvary API), utils.ts
src/engine/            pravidlový engine (čisté TS, unit testy)
api/                   PHP backend (index.php, src/, migrations/, bin/, data/, config*.php)
api/data/              srd51/*.json (SRD 5.1 z 5e-bits/5e-database, beze změn) a extra/item-catalog.json (katalog itemů); seed je načte do DB
scripts/data/          build-item-catalog.mjs (jednorázové sestavení katalogu itemů z aidedd + Eventyr)
api-tests/             API testy autorizace (Vitest proti skutečnému PHP + MySQL)
e2e/                   Playwright E2E (Chromium, desktop + mobil)
scripts/deploy.mjs     FTP nasazení + migrace
docker-compose.yml     lokální MySQL
public/.htaccess       SPA routing + cache + hlavičky (kopíruje se do dist/)
docs/NASAZENI.md       postup nastavení Endory (PHP, DB, HTTPS, deploy)
```

## Příkazy

| Příkaz | Co dělá |
| --- | --- |
| `npm run db:start` | spustí lokální MySQL (Docker musí běžet) a aplikuje migrace |
| `npm run db:migrate` | aplikuje nové migrace do vývojové DB (`dnd`) |
| `npm run db:seed` | načte pravidla (SRD 5.1 + katalog itemů) do vývojové DB; přeskočí se, když se data nezměnila (`--force` vynutí) |
| `npm run db:reset` | SMAŽE vývojovou DB a aplikuje vše znovu |
| `npm run db:stop` | zastaví MySQL |
| `npm start` | PHP API (8080) + Vite dev server (5173) najednou |
| `npm run api` / `npm run dev` | jen API / jen frontend |
| `npm test` | Vitest unit testy (frontend a engine) |
| `npm run test:api` | API testy proti PHP + testovací DB `dnd_test` (DB se při každém běhu smaže) |
| `npm run test:e2e` | Playwright v Chromiu: projekt `desktop` (1440x900) a `mobile` (Pixel 7); vlastní porty 5174/8182, DB `dnd_test` |
| `npm run test:all` | typecheck + lint + unit + API + E2E |
| `npm run typecheck` / `npm run lint` | kontrola typů / oxlint |
| `npm run build` | produkční build do `dist/` |
| `npm run deploy` (`deploy:dry`) | build + FTP + migrace (suchý běh nic nemění) |

`test:api` a `test:e2e` sdílejí DB `dnd_test`, nespouštět je souběžně (`test:all` je pouští po sobě).
Nová migrace: přidat `api/migrations/00N_nazev.sql` (jen SQL, příkazy oddělené `;` na konci řádku, žádné procedury), `npm run db:migrate`.
Nikdy neupravovat už nasazenou migraci, vždy přidat novou.

## Konfigurace

- `api/config.php` (lokální vývoj, v `.gitignore`): kopie `api/config.example.php`. Výchozí hodnoty sedí na docker-compose (DB `dnd`, registrační heslo `dev`).
- `api/config.test.php` (v gitu): testy, DB `dnd_test`, `trust_test_ip_header` (jen pro testy!), registrační heslo `test-key`.
- `api/config.production.php` (v `.gitignore`): ostrý server, deploy ho nahraje jako `api/config.php`. Deploy odmítne dev hodnoty, `debug: true` a slabé klíče.
- `.env.deploy` (v `.gitignore`): FTP údaje, viz `.env.deploy.example`. Nikdy se necommituje, heslo nepsat do chatu.
- Env `DND_CONFIG` přepíše cestu ke konfiguraci (používají ho testy).
- `VITE_BASE_PATH` (výchozí `/`): při nasazení do podsložky; uprav i `RewriteBase` v `public/.htaccess`.

## Bezpečnostní model (místo RLS)

- **Každý endpoint, který pracuje s daty kampaně, musí volat `Access::requireMember` / `Access::requireDm`** (nebo odvodit roli z kampaně záznamu).
  Zásada: kdo není členem kampaně, dostane **404** (nesmí poznat, že existuje); člen bez práv dostane **403**.
- Všechny SQL dotazy jen s prepared statements (`Db::all/one/value/exec`), žádné skládání uživatelského vstupu do SQL.
- Roli v kampani (`campaign_members.role`) klient nemůže měnit: žádný endpoint, členové vznikají jen přes `POST /campaigns` a registraci/přijetí pozvánky.
- Postavy: majitel a DM vidí vše, ostatní členové jen veřejný náhled (jméno, fotka, rasa, třída, level; `payload()` soukromá pole do odpovědi vůbec nevloží),
  pokud DM nenastaví `visibility = full`. Majitele, viditelnost a kampaň postavy hráč měnit nesmí.
- DM poznámky: jen DM. Soukromé zprávy (fáze 7) musí dostat stejně důkladné testy.
- Přihlášení: bcrypt (`password_hash`), heslo 8–72 bajtů, relace = náhodný token v HttpOnly cookie (`SameSite=Lax`, `Secure` při HTTPS), v DB jen SHA-256 hash tokenu.
  Rate limity (tabulka `rate_limits`): přihlášení, registrace, hádání kódů pozvánek, změna hesla. CSRF: kontrola `Origin` u mutací + SameSite.
- Registrace: jen s platným kódem pozvánky (hráč se rovnou připojí do kampaně) nebo s tajným `registration_key` z konfigurace (DM / první uživatel).
- API testy autorizace jsou povinné pro každý nový endpoint s citlivými daty (`api-tests/`): cizinec (404), hráč (403 / jen veřejná data), DM, anonym (401).
  Při změně pravidel nejdřív rozbít kód a ověřit, že test spadne (mutation check).

## Konvence

- TypeScript strict, `noUncheckedIndexedAccess`. Importy přes alias `@/` (= `src/`).
- UI texty česky. Jména souborů a kódu anglicky. Komentáře k pravidlům a bezpečnosti česky.
- **Dvě zařízení**: DM na počítači, hráči na telefonu. Telefon = jeden sloupec, `lg:` (≥1024 px) = víc sloupců a širší kontejner (`max-w-6xl`).
  Nová stránka dostane layout test v `e2e/layout.spec.ts` (žádný horizontální scroll, dotykové cíle ≥ 44 px, rozložení podle šířky).
- Mobile-first: tlačítka a inputy min. 44 px (výchozí velikosti v `ui/button` a `ui/input` jsou upravené). Tmavý režim třídou `dark`, vlastní `ThemeProvider` (`src/components/theme.tsx`).
- Přístupnost: ikonová tlačítka mají `aria-label`, chyby `role="alert"`, stavy `role="status"`, nadpisy karet jsou skutečné `h2` (`CardTitle`).
- Optimistické UI: mutace, které hráč klikáním opakuje (HP, sloty, ...), aktualizují cache hned a při chybě vrací (viz `useRevokeInvite`).
- `components/ui/*` (shadcn) se upravují jen kvůli velikostem a přístupnosti.

## Stav projektu

### Fáze 1 – Kostra: HOTOVO (backend přestavěn na PHP + MySQL)
- Přihlášení jménem a heslem, registrace kódem pozvánky nebo registračním heslem, změna hesla, profil.
- Kampaně, členové, role per kampaň, pozvánky (kód 10 znaků, platnost, max. použití, zrušení), odchod/odebrání hráče, smazání kampaně.
- Minimální postavy s veřejným náhledem a DM poznámky (zatím jen API, UI přijde ve fázi 3 a 6).
- API testy autorizace (viz fáze 2: celkem 71), E2E testy (desktop i mobil), unit testy, deploy skript otestovaný proti lokálnímu FTP.
- **Nasazeno** na https://dnd.hajekjakub.cz (PHP 8, MariaDB 11.8 na `db.db055.endora.cz`, Let's Encrypt). FTP účet `dnd.hajekjakub.cz` je zamčený v `_sub/dnd`. Další nasazení: `npm run deploy`. První účet DM se zakládá registračním heslem z `api/config.production.php`.

### Fáze 2 – Data: HOTOVO
- Tabulka `rules_entries` (migrace 002): jeden řádek = jedna položka (kouzlo, item, featura, třída, ...). Sloupce pro filtry (`kind`, `level`, `category`, `rarity`, `attunement`, `source`, `tags`, `price_gp`),
  zbytek v JSON sloupci `data`, připravené `name_cs`/`desc_cs` pro češtinu, `ruleset` (`srd51`, později `srd52`; `ref` = jen odkazový záznam mimo SRD).
  Homebrew = řádek s `campaign_id`, `owner_id`, `visibility` (`campaign` nebo `private`). Oficiální obsah je přes API neměnný.
- Seed (`api/src/Seeder.php`): idempotentní upsert z `api/data`, hash dat v `seed_state`; běží lokálně (`php api/bin/seed.php`) i na serveru (`POST /api/admin/seed`, volá ho deploy). Překlady (`name_cs`, `desc_cs`) a homebrew seed nepřepíše.
- Obsah: SRD 5.1 celý (319 kouzel, 12 tříd, 12 subclass, featury, levelové tabulky, rasy, conditions, zbraně, zbroje, vybavení, 362 SRD magických itemů). Magické itemy mimo SRD (Xanathar, Tasha, DMG mimo SRD, komunitní) jsou **jen fakta**
  (název, typ, vzácnost, attunement, zdroj, cena) + odkaz na aidedd.org; jejich popisy se NEkopírují (autorská práva). Ceny z Eventyr Games ceníku.
- API: `GET /rules` (filtry `kinds,q,level,category,rarity,attunement,source,tag,scope,campaignId`), `GET /rules/facets`, `GET /rules/{id}`, `POST /campaigns/{id}/homebrew`, `PATCH|DELETE /rules/{id}`.
  Viditelnost homebrew: jen členové kampaně, `private` jen autor a DM; úprava jen autor a DM.
- UI: `/rules` (kategorie, hledání, filtry v URL, na počítači seznam + detail vedle sebe, na telefonu seznam a detail po sobě), `/rules/new`, `/rules/:id/edit`, veřejná `/about` s atribucí SRD 5.1 (CC-BY-4.0).
- Testy: 71 API testů (viditelnost homebrew, oprávnění, filtry, seed), 25 E2E (desktop + mobil).
- Zdroj dat `class_level` (levelové tabulky) a `proficiency` jsou jen pro engine (fáze 3), v procházeči se nezobrazují.

### Fáze 3 – Sheet a engine: HOTOVO
- **Engine** (`src/engine`, čisté TS, bez UI a DB): `computeSheet(input, bundle)` počítá proficiency, vlastnosti, savy, skilly, passive perception, iniciativu, rychlost
  (Unarmored Movement, Fast Movement), AC (zbroj + štít + limit DEX, Unarmored Defense mnicha a barbara), HP z levelů, hit dice, útoky (finesse, martial arts), Extra Attack (nesčítá se),
  sesílání po třídách (DC, bonus, cantripy, prepared), sloty (multiclass tabulka, half/third caster), pact magic zvlášť, třídní zdroje (ki, rage, bardic inspiration, channel divinity, ...).
  Každá hodnota je `Computed` {value, base, overridden, sources}; ruční přepis = klíč v `overrides` (např. `ac`, `save.wis`, `spellDc.warlock`, `resource.monk.ki.max`, `slots.1`).
  Efekty (`Effect`: target, value, source) od DM a z equipnutých/attunovaných itemů se propisují s původem. `rest.ts`: short rest, long rest, utracení hit dice.
- Pravidla pro engine dodává `GET /rules/engine` (třídy + tabulky levelů ze SRD); `buildRulesBundle` je jediná implementace (app i testy). Popisy featur: `GET /rules/class-features`.
- **Datový model postavy** (migrace 003): `characters` rozšířeno (vlastnosti, HP, death saves, sloty, skilly, přepisy, osobnost, peníze, `rev`), `character_levels` (každý získaný level = řádek, základ pro level up),
  `character_resources`. Class/level shrnutí a `level` se přepočítávají (`Sheets::syncDerived`).
- **API**: `POST/GET/PATCH/DELETE /characters/...`; `PATCH` s `rev` (409 při souběhu), `POST /characters/{id}/adjust` = atomické změny o hodnotu (HP, temp HP, sloty, pact, zdroje, hit dice, death saves, XP, inspirace, stavy),
  aby se kliknutí hráče a DM nepřepisovala; `POST/GET/DELETE /characters/{id}/photo` (fotka: klient ořízne na čtverec, server přegeneruje přes GD na 512 px JPEG, soubory v `api/storage`, vidí je členové kampaně).
- **UI** (`src/features/sheet`): vytvoření postavy, sheet s přehledem (AC, iniciativa, rychlost, proficiency, passive perception, HP s velkými tlačítky, sloty a zdroje se steppery, útoky, vlastnosti, savy, skilly,
  sesílání), klepnutím na hodnotu se ukáže rozpis a jde ji přepsat (značka „ručně“, tlačítko vrácení), short a long rest (včetně hodu hit dice), featury s popisy, záložka Postava (údaje, osobnost, poznámky, fotka s ořezem, viditelnost pro DM).
  Optimistické UI: `useAdjust` mění cache hned (`applyOps`), při chybě vrací; odpověď serveru platí jen pro poslední změnu.
- Logo (`public/logo.svg`) je i favicon; PNG ikony se generují `node scripts/build-icons.mjs`; `site.webmanifest` pro „přidat na plochu“.
- Deploy: `api/storage` (nahrané soubory) se nikdy nenahrává z lokálu ani nemaže na serveru (`PRESERVE`); po nasazení deploy vypíše diagnostiku serveru (PHP, GD, zapisovatelné úložiště).
- Testy: 55 unit testů enginu (včetně povinného Monk 5 / Warlock 1, multiclass sloty, AC, přepisy, resty, attunement), 98 API testů, 33 E2E (desktop + mobil) včetně UI scénáře Hajoš a nahrání fotky.

### Další fáze (dle zadání)
4. Kouzla a inventář. 5. Level up. 6. DM panel. 7. Zprávy. 8. Mapy. 9. Kostky. 10. Leštění.

Po každé fázi: aplikace jde spustit, testy projdou, commit, zastavit se a ukázat výsledek.

## Zadání (shrnutí)

- Role: DM nebo hráč v kampani (per kampaň). Hráč vidí/upravuje jen své postavy, cizí jen veřejný náhled. DM vidí a upravuje vše ve své kampani. Vše vynucené na serveru a testované.
- Engine počítá proficiency, mody, savy, skilly, AC (Unarmored Defense), útoky, spell DC, sloty (multiclass tabulka, pact magic zvlášť), třídní zdroje. **Každá dopočtená hodnota jde ručně přepsat (override)** s viditelnou značkou a návratem k výpočtu.
- Zdroje a resty jako obecný model (max číslo/vzorec, aktuální, kdy se obnovuje).
- Homebrew obsah (item, kouzlo, featura, subclass) pro DM i hráče. Datový model musí umožnit české názvy/popisy a druhý ruleset (SRD 5.2) a později iniciativní tracker.
- Mimo rozsah: tokeny a pohyb po mapě, fog of war, iniciativní tracker, hlas/video, monster statbloky, prodej/sdílení obsahu.
