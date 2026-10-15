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
| `npm run seed:hajos` (`-- --check`, `-- --force`) | idempotentní seed postavy Hajoš ze `seed/hajos.json`, viz „Seed postavy Hajoš“ níže |
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
- DM poznámky: jen DM (API testy i E2E ověřují, že hráč dostane 403 a text nikde nevidí). Oznámení vidí jen jejich příjemce. Soukromé zprávy (fáze 7) musí dostat stejně důkladné testy.
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

### Fáze 4 – Kouzla a inventář: HOTOVO
- **Kouzla** (`character_spells`, odkaz na `rules_entries`, SRD i homebrew kampaně): přidání do seznamu třídy (nebo mimo třídu), připravená kouzla u cleric/druid/paladin/wizard (limity jen jako upozornění, nikdy neblokují),
  detail kouzla, **seslání**: výběr slotu (kouzlo na vyšší úrovni ukáže text „na vyšší úrovni“), pact slot (např. warlock v multiclassu), rituál bez slotu, cantripy bez slotu, **koncentrace** (`characters.concentration`, adjust op `concentration`).
- **Inventář** (`character_items`): položka je kopie z pravidel (`Items::fromRule`: zbraň, zbroj, štít, magický item včetně známých efektů jako Ring of Protection, +N zbroj/štít/zbraň) nebo vlastní.
  Equip se promítá do enginu (AC, útoky, efekty); nosí se jedna zbroj a jeden štít; **attunement max 3** vynucuje server (transakce se zámkem postavy, souběžné požadavky se nepředběhnou).
  Efekty itemů (bonusy k AC, savům, skillům, rychlosti, ...) se započítají jen u nošeného (a u attunement itemů attunovaného) itemu a s původem se ukážou v rozpisu hodnoty.
- **Peníze**: cp/sp/ep/gp/pp, převod mincí (`money.ts`, jen celé násobky), celková hodnota. **Předávání** (`POST /characters/{id}/transfer`): item (i část stacku) a/nebo peníze jiné postavě ve stejné kampani, v transakci s zámkem obou postav
  (souběžné předání stejného itemu projde jen jednou). Předaný item se odequipuje a ztratí attunement.
- **Nosnost/přetížení**: volitelné pravidlo kampaně (`campaigns.settings.encumbrance`, přepíná DM v kampani), engine: nad 5× STR −10 ft, nad 10× STR −20 ft, váha a limity vždy vidět.
- API: `POST/PATCH/DELETE /characters/{id}/items[/{itemId}]`, `POST /characters/{id}/transfer`, `POST/PATCH/DELETE /characters/{id}/spells[/{spellId}]`, `PATCH /campaigns/{id}` s `settings`.
- Testy: 58 unit testů enginu, 129 API testů (inventář, attunement, souběhy, předávání, kouzla, oprávnění), 46 E2E (desktop + mobil) včetně warlocka z pact slotu a předání mezi DM na počítači a hráčem na telefonu.

### Fáze 5 – Level up: HOTOVO
- **Historie**: každý level je řádek v `character_levels` (`class_idx`, `hp_roll`, `choices` JSON: subclass, ASI, feat, počty kouzel, poznámka, `hpGain`, `classLevel` a `undo` údaje pro vrácení).
- **API**: `POST /characters/{id}/levelup` (transakce se zámkem postavy; validuje třídu, level ≤ 20, hod do velikosti kostky, subclass od správného levelu a ke správné třídě, ASI jen na ASI levelech podle tabulek tříd
  (fighter 6 a 14, rogue 10) s celkem +2 a max 20, feat místo ASI, přidání/odebrání kouzel; zvedne aktuální HP o `hpGain`), `POST /characters/{id}/levelup/revert` (vrací vždy jen poslední level včetně vlastností, subclassu, kouzel a HP; první level nejde).
- **Engine** (`src/engine/levelup.ts`): prerekvizity multiclassu (nová i všechny současné třídy, 13+), přírůstek HP, ASI levely, nová kouzla a nejvyšší úroveň kouzla podle SRD.
- **Průvodce** (`/characters/:id/levelup`, `LevelUpWizard.tsx`): Třída (včetně multiclassu s kontrolou prerekvizit; výjimku „povolil DM“ lze zaškrtnout, aplikace hráče neblokuje) → Životy (průměr / hod / ruční zadání) → Featury (nové featury z SRD, výběr subclassu, pole pro ruční doplnění toho, co engine nezná) →
  Vlastnosti (ASI +2 nebo feat; krok se přeskočí, když level ASI nedává) → Kouzla (doporučené počty, přidání, výměna; přeskočí se u nesesilatelů) → Souhrn (před/po z enginu: HP, proficiency, sloty, pact, zdroje, útoky, martial arts).
- Historie levelů s tlačítkem „Vrátit poslední level“ je na záložce Postava; featy jsou v záložce Featury.
- Testy: 62 unit testů enginu, 148 API testů, 58 E2E (stav po fázi 5; aktuální počty jsou u fáze 6).

### Fáze 6 – Panel DM: HOTOVO
- **Panel** (`/campaigns/:id/dm`, `src/features/dm/`; odkaz „Panel DM“ na stránce kampaně vidí jen DM, hráč je z URL přesměrován): karty všech postav (HP s rychlými −5/−1/+1/+5, AC, pasivní vnímání, rychlost, stavy, sloty a zdroje, bonusy s tlačítkem Zrušit), výběr jedné/více/všech postav a akce pro výběr:
  zranění/léčení (i skupinově), XP (každý dostane celou částku, nebo rozdělit rovným dílem), peníze, item (z pravidel s počtem kusů, nebo jednorázový přes `ItemForm`), stav (nastavit/zrušit), inspirace, bonus/efekt. Poznámky DM (`NotesPanel`, obecné i k postavě).
- **API** (`DmController`, vše `POST /campaigns/{id}/dm/{items|currency|xp|inspiration|hp|conditions|effects}`, jen DM; cílové postavy se zamknou `FOR UPDATE` a musí patřit do kampaně, jinak 422; vše v jedné transakci),
  `DELETE /effects/{id}` (DM) a `DELETE /characters/{id}/effects/long-rest` (majitel/DM, maže jen efekty „do long restu“).
- **Efekty** (`character_effects`: cíl, hodnota, zdroj, trvání `permanent|long_rest|manual`) vstupují do enginu přes `toEngineInput` a ve výpočtu mají viditelný zdroj (tooltip hodnoty). Na sheetu je karta „Bonusy od DM“ (hráč vidí, zrušit jen DM). Long rest efekty „do long restu“ smaže.
- **Oznámení** (`notifications`, `NotificationController`): každá změna od DM pošle hráči (majiteli postavy) oznámení („DM ti dal: Bag of Holding“); neposílá se sám sobě. Klient se ptá každých 5 s (`useNotifications`, žádný websocket – Endora), nové ukáže jako toast,
  zvonek v hlavičce má odznak nepřečtených, `/notifications` je seznam a po otevření se označí jako přečtené. Při předávání itemů mezi hráči se oznámení posílá také.
- Testy: 174 API testů (26 v `dm.test.ts`: autorizace všech akcí, cizí kampaň, atomicita, notifikace), E2E `dm.spec.ts` (DM počítač + hráč telefon: item, XP, bonus, stav, zranění, oznámení, long rest, soukromí poznámek; panel na telefonu bez horizontálního scrollu).

### Seed postavy Hajoš (`seed/hajos.json`, `api/src/CharacterSeeder.php`, `api/bin/seed-hajos.php`)
- Spuštění: `SEED_OWNER_USERNAME=<tvé přihlašovací jméno> npm run seed:hajos` (proměnné jdou i z `.env`, viz `.env.example`; aplikace nemá e-maily, účet se hledá podle jména).
  `SEED_CAMPAIGN_ID` je volitelné; bez něj se založí (a příště znovu použije) „Testovací kampaň (seed)“, kde je majitel DM. Majitel musí být členem zadané kampaně.
  Cílová DB je ta z `api/config.php` (nebo `DND_CONFIG`); skript na začátku vypíše, do které píše. `-- --check` jen ověří mapování, `-- --force` Hajoše smaže a založí znovu.
- **Idempotence**: postava se hledá podle kampaně, majitele a jména, existující se nemění (nezdvojí se). Homebrew záznamy se hledají podle kampaně, druhu a názvu a při opakování se aktualizují.
- **Ukládají se jen vstupy**: staty, třídy po levelech (HP z průměru), subclassy, skill proficiencies, extra savy (jen mimo třídní), texty (jazyky a proficiencies, které engine ze třídy nezná), aktuální a dočasné HP, inventář, peníze, kouzla, inspirace.
  Žádné `overrides`, žádný ki, sloty ani AC. Plné zdroje (ki, pact sloty) se neukládají, částečně vyčerpaný zdroj seed odmítne.
- **Mapování na SRD**: itemy podle názvu (alias `Light Crossbow` → `Crossbow, light`), kouzla podle názvu. Co v SRD není, vznikne jako homebrew kampaně: Nunchaku a Demonic Spear (zbraně; Spear je základ Demonic Spear, `attunement: true` nastaví `requires_attunement` i `attuned`). Kouzla mimo SRD se berou z katalogu kouzel (`ruleset 'ref'`, viz níže), ne z homebrew.
  Zbraně s řádkem v sekci `attacks` se nosí v ruce (`equipped`), aby se jejich útoky ukázaly na sheetu.
- **Zastavení před zápisem** (`SeedStop`, exit 3): neznámá sekce nebo pole, neznámý item, kouzlo, zdroj nebo dovednost, nečitelné `extraDamage`, neexistující majitel nebo kampaň. Seed nejdřív celé ověří (`plan()`), teprve pak zapisuje. Když model něco neumí uložit, nejdřív se zeptat, schéma neměnit bez dohody.
- **null a TO_CONFIRM**: `null` zůstane prázdné (XP = NULL v DB, background a alignment prázdný text), UI to ukáže jako „nedoplněno“ (`MissingInfo` na sheetu, „XP nedoplněno“ v hlavičce). Texty začínající `TO_CONFIRM` se uloží do poznámek postavy a itemů tak, jak jsou,
  a UI je ukáže ve výpisu „Ke ověření“ a se štítkem „ke ověření“ u poznámek itemů (`unconfirmed.ts`, `NotesText`). `openQuestions` se na konci seedu vypíšou do konzole (do DB se neukládají).
- **Aktuální podoba papíru** (druhá verze seedu): pravidla 2014 jsou rozhodnutá, Warlock má cantripy Eldritch Blast a Minor Illusion (SRD) a čtyři kouzla 1. úrovně: Hex a Armor of Agathys (katalog kouzel, viz níže) a Command a Burning Hands (SRD; DM povolil všechna čtyři, dvě má z výběru a dvě od fienda); seed bere kouzla z `cantrips` a `known` (nebo `leveled`).
  Nunchaku jsou homebrew zbraň s kostkou d8 (kostku a typ zranění seed bere z řádku útoku v `attacks`, kategorie simple melee je odhad), Unarmed Strike (martial arts d6) vychází z enginu sám. Heroic Inspiration z první verze už v seedu není (inspirace je vypnutá).
- **Fixture pro engine**: `src/engine/hajos-sheet.test.ts` bere vstupy a `sheetValues` ze `seed/hajos.json`; engine vyjde stejně jako papír (včetně útoků Nunchaku 1d8+4, Unarmed Strike 1d6+4 a Demonic Spear +8, ki 5, martial arts d6, DC ki 13, Dark One's Blessing 4 temp HP, 2 paprsky Eldritch Blast).
  Spell save DC warlocka je 14 (8 + 3 + CHA 3), seed má `warlockSpellSaveDC: 14` (13 je DC ki); versatile 1d8 spearu se v útoku nemodeluje. Opravené hodnoty ze `discrepancies` (Stealth +7, STR save +3) engine dává přímo.
- **Použití taktik: hody, cena a munice** (migrace 013, `character_items.consumable`, `DiceController::batch`, `features/tactics/run.ts`, `cost.ts`): tlačítko **Použít** u položky taktik zaplatí cenu a **rovnou hodí všechny útoky**. Data: `count` (kolik útoků jedno použití provede; útok, kouzlo, ki), `toHit`/`roll` (u ki i kouzel), `ammo` (id itemu postavy, každý útok ubere 1 kus), u komba `uses: [{id, count}]` (taktiky téže postavy, které kombo provede). `planRun` poskládá z položky (nebo z komba) seznam útoků, ceny (každá položka jednou) a spotřebu munice; Hex se přidá ke zranění útoků s `hex`, a když se v kombu sesílá kouzlo se soustředěním (Hex), nastaví se soustředění a bonus platí už pro tyto útoky. `planSpend` zaplatí víc cen najednou (ki se sčítá, sloty pact → nejnižší dost vysoký). Vše se pošle jako jedno `adjust` (`resource`, `pact`, `slot`, `item`, `concentration`) a jedno `POST /campaigns/{id}/rolls/batch` `{attacks:[{label,toHit?,damage?}], mode, hidden, characterId}` (max 24 útoků; přirozená 20 na zásah hodí zranění jako kritické, výhoda/nevýhoda jen na zásah, skryté série vidí jen ten, kdo hodil, a DM; chyba v jednom útoku nezapíše nic). Výsledek ukáže `BatchResultDialog` (zásah a zranění u každého útoku, součet zranění). Munice dojde → částečný počet útoků nebo tlačítko vypnuté.
  **Spotřebovatelné itemy**: `consumable` (checkbox ve formuláři itemu, u SRD munice, lektvarů, svitků, olejů, pochodní a příděluů automaticky) → v inventáři tlačítko **Použít** (−1 ks); množství smí klesnout na 0 (item zůstane, „Došlo“). `adjust` má operaci `{op:'item', itemId, delta}` (jen item téže postavy, jinak 404; meze 0 až 9999). V seedu `ammoItem` (název itemu), `uses: [{title, count}]` a `consumable: true`; `Tactics::replaceAll` je převede na id (nejdřív vloží všechno kromě komb).
- **Death saves**: na sheetu u 0 HP tlačítko **Hodit death save** (k20 bez bonusu, vždy skrytý hod: vidí ho jen hráč a DM; 10+ úspěch, méně neúspěch, přirozená 1 dva neúspěchy, přirozená 20 vrátí 1 HP a smaže značky; 3 úspěchy stabilizovaná, 3 neúspěchy mrtvá). Značky `deathSuccesses`/`deathFailures` server nevrací nikomu kromě majitele a DM (`CharacterController::hideDeathSaves`, i když má hráč plný náhled cizí postavy); sekce se jim ani nezobrazí. DM je vidí na kartě postavy v Panelu DM.
- **Katalog warlockových kouzel** (`api/data/extra/warlock-spells.json`, 68 kouzel z rpgbot.net): jen fakta (úroveň, škola, čas, dosah, složky, trvání, soustředění, ritual, zdroj), žádné popisy. `Seeder::catalogSpells()` je zakládá jako `ruleset 'ref'`, `kind 'spell'`, `is_srd 0`, tag `|Warlock|`; v prohlížeči pravidel jsou vedle SRD (celkem 387 kouzel, z toho 319 SRD).
- **Taktiky** (migrace 011, `character_tactics`, `api/src/Tactics.php`, `TacticsController`, `src/features/tactics/`): tahák do boje na záložce **Taktiky** sheetu. Data jsou v DB, ne v kódu. Druhy: `attack`, `spell`, `ki`, `passive`, `combo`, `rule` (tvar `data` a validace v `Tactics::normalize`; neznámá pole se zahodí). Cena je `free`, `ki:N` nebo `slot:N`.
  API: `GET/POST /characters/{id}/tactics`, `POST /characters/{id}/tactics/reorder` (`kind` + všechna `ids` toho druhu), `PATCH/DELETE /tactics/{id}`. Čtou majitel, DM a členové, kteří vidí postavu celou; mění majitel a DM (`Sheets::loadMutable`). Max 200 položek na postavu.
  UI: klíčová čísla (AC, iniciativa, rychlost, HP, ki a ki DC, spell DC a útok, CON save, sloty), sekce Útoky, Kouzla, Ki schopnosti, Pasivky a reakce, Komba (zvýrazněné `highlight`), Pravidla (rozbalovací). Štítky ceny: ki tmavý, slot červený, zdarma obrys; když ki nebo slot nestačí, zešednou a jsou přeškrtnuté (`cost.ts`: `availability`, `spendOps`; slot se bere nejdřív z pact slotů, pak z nejnižšího dost vysokého). Tlačítko **Použít** cenu odečte přes `adjust`, hod kostkou nic neodečítá. Hody přes `RollButton` (`damage.ts` převede „1d8+5 + 1d4 fire“ na výraz; pole `roll` má přednost; s Hexem se přidá 1d6). Úpravy: tlačítko „Upravit taktiky“ zapne přidávání, úpravu, smazání a řazení šipkami.
  Seed: sekce `tactics` v `seed/hajos.json` (`attacks`, `spells`, `ki`, `passives`, `combos`, `rules`); `seed-hajos.php --tactics-only` jen vymění taktiky existující postavy (hráčské úpravy se přepíšou, nic jiného se nemění; `SEED_CHARACTER_NAME` je pro postavu, kterou hráč přejmenoval, na ostré DB se jmenuje Obalatomi). Deflect Missiles je podle 2014 1d10 + DEX + level mnicha = 1d10+9.
- API test `api-tests/seed-hajos.test.ts`: spouští seed skript proti testovací DB, kontroluje uložená data, SRD vs. homebrew mapování, engine z uložených dat, idempotenci, `--force`, zastavení před zápisem a soukromí postavy. E2E `e2e/hajos.spec.ts` (počítač i telefon): sheet ze seedu a formulář homebrew zbraně.

- **Přídavek ke zranění od kouzla (Hex, Hunter's Mark)**: když se postava soustředí na Hex (seslání ze záložky Kouzla nastaví soustředění), objeví se na kartě Útoky přepínač „Cíl je pod kouzlem Hex“ (výchozí zapnuto). Zapnutý přidá ke každému zranění 1d6 necrotic (v hodu i v kritu, kde se kostky zdvojí); vypne se pro útok na jiného protivníka, protože bonus platí jen proti jednomu cíli.
  Aplikace cíle nesleduje. Seznam kouzel je v `features/sheet/riders.ts`. Jinak se Hex dá hodit i jako volný hod `1d6` v panelu kostek.
- Seed: položka může mít `damageDice` (kostka jiná než u základní zbraně); Demonic Spear má d8 místo d6 u Spear.

- **Utrácení peněz** (`POST /characters/{id}/spend`, `Money::pay`): v inventáři tlačítko „Utratit“ (částka v mincích + nepovinně za co, např. pivo u barmana nebo úplatek pro NPC). Platí se nejdřív přesnými mincemi od nejmenších, když nestačí, rozmění se nejmenší mince, která zbytek pokryje, a vrátí se drobné v gp, sp a cp (ep a pp se nevrací).
  Celé v transakci se zámkem postavy (nic se nezaplatí napůl, souběžná změna peněz se neztratí); nedostatek peněz je 422 s vysvětlením, platit smí majitel a DM. Součet se vždy zachová (testováno). Tlačítko „Předat peníze“ zůstává pro předání jiné postavě.

### Pravidla kampaně: 2014 / 2024
- DM je nastaví na stránce kampaně („Nastavení kampaně“ → Pravidla kampaně); uloží se do `campaigns.settings.ruleset` (`'2014'` | `'2024'`, bez hodnoty = 2014, bez migrace), API: `PATCH /campaigns/{id}` `{settings: {ruleset}}` jen DM, jiná hodnota 422, ostatní nastavení se nepřepíše.
  Odznak „Pravidla 2014/2024“ je v hlavičce kampaně. Frontend skládá pravidla pro engine přes `engineRulesOf(settings)` (`src/features/campaigns/ruleset.ts`): sheet, panel DM i průvodce level upem.
- **Engine** (`CharacterInput.rules.ruleset`): v 2024 je martial arts kostka o stupeň vyšší (d6/d8/d10/d12 místo d4/d6/d8/d10), monk zbraně jsou simple melee a martial melee s vlastností Light (2014: simple melee a shortsword), ki se jmenuje Focus Points (klíč `monk.ki` zůstává). Ostatní třídy a výpočty se nemění.
- **Data pravidel jsou stále jen SRD 5.1** (tabulka `rules_entries` má sloupec `ruleset`, SRD 5.2 se nenačítá). Prohlížeč pravidel u kampaně s 2024 ukáže upozornění, že itemy, kouzla a třídy jsou z 5.1. Načtení SRD 5.2 a filtrování podle sady je případná další práce.
- Testy: engine (`engine.test.ts` blok „Pravidla kampaně“, `hajos-sheet.test.ts`: s 2024 vychází Nunchaku 1d8+4 přesně podle papíru), API (`campaigns.test.ts`), E2E (`hajos.spec.ts`: přepnutí 2024 a zpět, počítač i telefon).

### Změny datového modelu při seedu Hajoše (domluvené)
- **Migrace 006**: `characters.xp` je nepovinné, `NULL` = nedoplněno. Změna XP (DM, `adjust`, level up) bere NULL jako 0; běžné úpravy (HP apod.) NULL zachovají. `PATCH {xp: null}` XP zase „odnastaví“.
- **Doplňková zranění zbraně**: ve `stats` zbraně (JSON, bez migrace) je volitelné `extraDamage: [{dice, type}]` (nejvýš 3, např. `1d4` + `Fire`). Engine ho vrací v `AttackInfo.extraDamage`, sheet ukazuje „+ 1d4 fire“ (bonus k útoku se k němu nepřidává). Formulář itemu má pole „Doplňková zranění“.
- **Homebrew druh `weapon`** (`POST /campaigns/{id}/homebrew`, formulář „Nová zbraň“ ve skupině Vybavení): data mají tvar SRD zbraní (`damage`, `weapon_category`, `weapon_range`, `properties`, `weight`, `two_handed_damage`) plus `magic_bonus` a `extra_damage`;
  inventář z ní vyrobí zbraň včetně magického bonusu a doplňkových zranění.

### Fáze 7 – Zprávy: HOTOVO
- **Model** (migrace 007): `messages` (vlákno `thread`: `group` | `dm:<id hráče>` | `secret`), `message_recipients` (adresáti soukromých a tajných zpráv), `message_reads` (do které zprávy ve vlákně uživatel dočetl).
- **Viditelnost** má jediné pravidlo (`MessageController::visibleSql`): skupinové zprávy vidí každý člen kampaně, ostatní jen odesílatel a příjemci. DM tedy nečte nic, co mu nebylo adresováno ani sám neposlal.
  Kdo smí psát: skupinově každý člen; hráč soukromě jen DM (jednomu), jinak 403; DM jednomu hráči (vlákno `dm:<hráč>`) nebo víc hráčům naráz (`secret`); sám sobě, cizinci ani ne-hráči ne (422). Cizinec dostane 404, anonym 401, 40 zpráv za minutu na uživatele (429).
- **API**: `GET /campaigns/{id}/messages[?after=]` (posledních 200, s `after` jen novější, plus nepřečtené po vláknech), `POST /campaigns/{id}/messages` `{to: 'all' | [userIds], body ≤ 4000}`, `POST /campaigns/{id}/messages/read` `{thread}` (server sám spočítá poslední viditelnou zprávu),
  `GET /messages/unread` (nepřečtené napříč kampaněmi). Text se ukládá a vrací beze změny, UI ho ukazuje jako text (žádné HTML).
- **UI** (`/campaigns/:id/messages`, odkaz „Zprávy“ na stránce kampaně pro všechny členy): vlákna Skupina, soukromé (hráč vidí jedno s DM, DM jedno na hráče) a Tajné zprávy (DM vybírá aspoň dva příjemce, hráč je jen čte a vidí, komu byla určena).
  Na telefonu je nejdřív seznam vláken a pak vlákno, na počítači vedle sebe. Průběžné dotazování každé 4 s jen na novější zprávy, odznak nepřečtených u vláken, u kampaně i v hlavičce, toast při nové zprávě.
- **Zprávy v jazyce** (`Languages.php`, `MessageController::languageTarget`, bez migrace): hráči se stejným jazykem si píšou tak, že to nevidí nikdo jiný, ani DM. Jazyk postavy je položka `Language: <název>` v `extra_proficiencies` (stejně ho zapisuje seed; editor je karta **Jazyky** na záložce Postava, `languages.ts`). Hráč zná jazyk, když ho zná kterákoli jeho postava v kampani; DM se nepočítá. `POST .../messages` s `to: {language: 'Orc'}` vytvoří vlákno `lang:<slug>` (slug = malá písmena, čísla, pomlčky, max 40; velikost písmen nerozhoduje) a příjemci jsou ostatní hráči s tím jazykem **v okamžiku odeslání** (kdo se jazyk naučí později, starší zprávy neuvidí). Nezná-li jazyk odesílatel nebo je DM 403, žádný další hráč s jazykem 422. `GET .../messages` vrací navíc `languages` (moje jazyky a s kým je sdílím); vlákno se v UI ukáže, jen když je s kým psát nebo už v něm jsou zprávy. Testy `messages.test.ts` (blok „zprávy v jazyce“), E2E `messages.spec.ts`.
- Testy: 17 API testů (`messages.test.ts`: autorizace, soukromí, tajné zprávy, validace, nepřečtené, rate limit) + E2E `messages.spec.ts` (DM počítač + dva hráči na telefonech; telefon i počítač bez horizontálního scrollu).

### Fáze 8 – Mapy: HOTOVO
- **Model** (migrace 008): `maps` (obrázek v `api/storage/maps`, `width`/`height`, `visible`), `map_pins` (souřadnice v pixelech obrázku, `icon`, `visibility`), `map_pin_viewers`.
- **Mapy**: nahrává, přejmenovává, zveřejňuje a maže jen DM (hráč 403, cizinec 404). Obrázek se na serveru vždy přegeneruje na JPEG (nejvýš 4096 px na delší straně, poměr stran zůstane), velké soubory zmenší už prohlížeč (`shrink-image.ts`).
  Hráč vidí a stahuje jen zveřejněné mapy, skrytá je pro něj 404 (seznam, obrázek i body). Obrázek vydává jen API (`GET /maps/{id}/image`, ETag), smazání mapy i kampaně smaže i soubory. Nová mapa je zprvu skrytá.
- **Body** (`/maps/{id}/pins`, `/pins/{id}`): viditelnost `all` (všichni, kdo mapu vidí), `selected` (vybraní hráči a DM), `dm` (jen DM), `owner` (soukromá poznámka hráče, nevidí ji nikdo jiný, ani DM). DM zakládá `all`/`selected`/`dm`, hráč jen `owner` (jinak 403) a poznámku nejde zveřejnit.
  Upravit a smazat smí autor, DM jen body, které sám vidí (cizí soukromé poznámky mu připadají jako 404). Seznam vybraných hráčů vidí jen autor a DM. Souřadnice musí být uvnitř mapy, ikony jsou z pevného seznamu, nejvýš 300 bodů na mapu a 30 map na kampaň.
- **UI**: `/campaigns/:id/maps` (seznam, nahrání, zveřejnit/skrýt, smazat) a `/campaigns/:id/maps/:mapId` (Leaflet `CRS.Simple`, načítá se líně až při otevření mapy). Režim „Přidat bod“ (klepnutí do mapy), „Přesouvat body“ (tah značky), seznam bodů pod mapou,
  popis vybraného bodu, formulář s ikonou a viditelností. Značky jsou `divIcon` s emoji (žádné obrázky značek Leafletu). Mapa je v `isolate`, aby její z-index nepřekryl sticky hlavičku.
- Testy: 15 API testů (`maps.test.ts`, mutation check provedený) a E2E `maps.spec.ts` (DM počítač + hráč telefon: nahrání, zveřejnění, body, soukromá poznámka, skrytí; přesouvání, hlavička nad mapou, bez horizontálního scrollu).

### Fáze 9 – Kostky: HOTOVO
- **Hody se losují na serveru** (`Dice::roll`, `random_int`), takže je z prohlížeče nejde zfalšovat. Výraz je součet a rozdíl členů `NdM` a celých čísel (`2d6+3`, `d8`, `1d20+7-1`), omezený: nejvýš 100 znaků, 100 kostek na člen, 200 kostek celkem, 2 až 1000 stěn, konstanty do 10 000, aspoň jedna kostka; jinak 422. Uložený výraz je v ustáleném tvaru (`1d20+7`).
  Výhoda a nevýhoda (`mode`) hodí celý výraz dvakrát a vezmou vyšší/nižší součet (oba hody se uloží a ukážou). `crit` zdvojí počty kostek (konstanty ne). U jednoho k20 se vrací `natural` (zvýraznění 20 a 1).
- **API** (migrace 009, `dice_rolls`): `POST /campaigns/{id}/rolls` `{expression, label?, mode?, crit?, hidden?, characterId?}` (60 hodů za minutu na uživatele, 429), `GET /campaigns/{id}/rolls[?after=]` (posledních 50 viditelných, s `after` jen novější).
  Soukromí: log vidí členové kampaně (cizinec 404, anonym 401), **skrytý hod vidí jen ten, kdo hodil, a DM**, skrytý hod DM jen DM. Hod za postavu (`characterId`) smí jen její majitel nebo DM (jinak 403), postava musí být z kampaně (422).
- **UI** (`src/features/dice/`): tlačítko Kostky v horní liště (`DiceDock`): rychlé kostky d4 až d100, volný hod, přepínač Normálně/Výhoda/Nevýhoda a Skrytý hod (`RollSettingsProvider` v `AppLayout`, společné pro celý web) a sdílený log kampaně.
  Na sheetu u majitele a DM jsou u hodnot tlačítka s kostkou (`RollButton`): zkoušky vlastností, záchranné hody, dovednosti, iniciativa, útok zbraní a kouzlem, zranění a „Krit“ (zranění se bonusem a doplňkovými zraněními, např. `1d8+4+1d4`). Vlastní hod otevře **okno s animovanou kostkou** (`RollOverlay`, bez externí knihovny): hned po kliknutí se roztočí kostky z výrazu (SVG tvary d4, d6, d8, d10, d12, d20, kolečko pro ostatní; čísla na nich blikají), nejméně ~1 s, a po odpovědi serveru dosednou na hozená čísla.
  Pak se ukáže součet (dopočítá se animací) a rozpis; výhoda a nevýhoda ukážou oba hody (zahozený je zešedlý), kritický zásah zdvojené kostky, přirozená 20 zeleně se zářením a přirozená 1 červeně s otřesem. Tlačítka „Hodit znovu“ a „Zavřít“ (Esc nebo klepnutí vedle také zavře).
  Respektuje `prefers-reduced-motion` (bez animací), a11y: dialog s popiskem „Hod kostkou“, výsledek se oznámí čtečkám. Hody ostatních se dál ukazují jako toast i při zavřeném panelu a všechny jsou v logu. Útok a zranění se na úzkém displeji zalomí pod sebe (dřív by stránka jezdila do stran).
- Testy: 14 API testů (`dice.test.ts`: parser a limity, součty, výhoda/nevýhoda, krit, soukromí skrytých hodů, postavy, rate limit; mutation check proveden), 5 unit testů formátování, E2E `dice.spec.ts` (hráč na telefonu hází ze sheetu, DM na počítači a druhý hráč čtou log, skrytý hod, výhoda, krit, volný hod).

### Bezpečnostní pojistky testů a databáze (po incidentu)
- Jednou se omylem smazala ostrá databáze: v shellu zůstala `DND_CONFIG` na ostrou konfiguraci a API testy pustily `migrate --fresh`. Proto: **`DND_CONFIG` nikdy neexportovat do shellu** (nastavovat jen před jedním příkazem),
  `Migrator::dropAll` odmítne cokoli jiného než lokální DB (`127.0.0.1`/`localhost`) a `api-tests/global-setup.ts` ignoruje `DND_CONFIG` z prostředí (vždy `api/config.test.php`, jiná jen přes `DND_TEST_CONFIG`). Hlídá to `api-tests/safety.test.ts`.
- `Db::transaction` při deadlocku (MySQL 1213) transakci až 3× zopakuje (paralelní seedy v testech).
- Ostrá DB nemá zálohy (Endora je nemá zapnuté). Než se na ostré DB spustí cokoli, co zapisuje, nejdřív `--check` / čtení. Postavu Hajoš do kampaně Mirabilis na ostré DB zakládá `seed-hajos.php` s `DND_CONFIG=<ostrá>` jen pro ten jeden příkaz.

### Fáze 10 – Leštění: HOTOVO
- **Výkon**: těžší stránky (sheet, level up, panel DM, mapy s Leafletem, pravidla, zprávy, oznámení) se načítají líně (`React.lazy` v `App.tsx`, `Suspense` v `AppLayout`); hlavní balíček má ~330 kB (99 kB gzip) místo 640 kB, varování o velikosti zmizelo. Assety mají hash a dlouhou cache (`public/.htaccess`).
- **Přístupnost** (`e2e/a11y.spec.ts`, axe, WCAG 2.1 A a AA): všechny hlavní stránky, záložky sheetu a panel kostek ve světlém i tmavém režimu, na počítači i na telefonu, bez porušení. Opraveno: kontrast tlačítka „destructive“ a popisků v seznamu pravidel, chybějící `h1` na profilu.
  Při měření se vypínají přechody barev (axe by je změřil v půli animace).
- **Rozložení** (`e2e/layout-sweep.spec.ts`): všechny stránky na počítači i telefonu bez horizontálního scrollu a s dotykovými prvky aspoň 44 px (checkboxy se měří včetně popisku). Opraveno: seznam bodů na mapě, inventář s dlouhým názvem a tlačítka velikosti `sm`.
  Zásada pro grid na telefonu: jednosloupcový grid má mít `grid-cols-[minmax(0,1fr)]`, jinak ho dlouhý obsah roztáhne.
- **Bezpečnost** (závěrečná kontrola): všechny SQL dotazy jsou prepared statements (dynamické části jen z pevných seznamů nebo `?` placeholdery), tajemství nejsou v gitu, deploy odmítne ladicí a testovací příznaky v ostré konfiguraci.
  `api-tests/route-audit.test.ts` prochází **celou tabulku tras z `App.php`**: bez přihlášení všude 401, cizinec dostane u cizích věcí 404 a žádná trasa nespadne na 500 ani na nesmyslném vstupu (nová trasa se do auditu dostane sama).
  **Content Security Policy** v `public/.htaccess` (skripty jen vlastní + otisk jediného vloženého skriptu pro tmavý režim, žádné cizí domény, žádné rámce); `src/test/csp.test.ts` hlídá, že otisk sedí s `index.html`, a `npm run test:csp` ověří produkční build pod CSP bez jediného porušení.
  API navíc posílá `Content-Security-Policy: default-src 'none'` a `Cross-Origin-Resource-Policy: same-origin`.
- **Odolnost**: `ErrorBoundary` kolem celé aplikace (místo prázdné stránky srozumitelná hláška a tlačítko Obnovit).
- **Správa**: `api/bin/set-password.php` (reset zapomenutého hesla, odhlásí i relace uživatele; test v `safety.test.ts`). Návod pro hráče a DM je v `docs/NAVOD.md`, README odkazuje na všechno.

### Navigace, deník a vzhled (po fázi 10)
- **Aktivní kampaň** (`features/campaigns/active-campaign.ts`): hraje se hlavně jedna kampaň, takže se nevolí ručně. Pamatuje se v `localStorage` při otevření jakékoli stránky kampaně (a sheetu postavy), jinak se bere první; kdo má jednu kampaň, ji má vždy.
  `/` (`HomeRoute`) rovnou přesměruje do aktivní kampaně (bez kampaně ukáže zakládání a připojení), seznam všech kampaní je na `/campaigns` a přepíná se v **Profilu → Moje kampaně**. Při odchodu z kampaně se nejdřív obnoví seznam kampaní (jinak by úvod poslal zpět).
- **Dolní lišta** (`components/BottomNav.tsx`, stále viditelná, 5 položek): Domů, Postava (vlastní postava v aktivní kampani, jinak „Nová postava“; DM má místo ní Panel DM), Deník, Mapy, Zprávy; odznaky nepřečtených u Deníku (`unread-journal-badge`) a Zpráv (`unread-messages-badge`).
  Horní lišta má jen logo s názvem kampaně, Pravidla, Oznámení a Profil (v Profilu je i motiv Podle systému / Světlý / Tmavý a odhlášení). Tlačítko **Kostky** je v horní liště (`DiceDock` se přes `DiceSlotContext` vykreslí portálem do hlavičky), ne plovoucí, ať nepřekrývá obsah. Odkaz „O aplikaci a licence SRD“ je jen v Profilu a na přihlašovacích stránkách, ne v patičce každé stránky.
  Svislé posuvníky: `html { scrollbar-gutter: stable }`, tenké posuvníky všude a utilita `scroll-area` (`index.css`) pro vnitřní scrollery (dialogy, seznamy v panelech) s vyhrazeným místem a `pr-2`, aby posuvník nepřekrýval obsah. Layout sweep hlídá i obsah, který přetéká z karty.
- **Domů** (`CampaignPage`): moje postava (HP, AC, rychlost, stavy; líně načtená, protože počítá enginem), náhled deníku, družina a pod nadpisem „Správa kampaně“ členové, pozvánky a nastavení. **Odejít z kampaně (hráč) a smazat ji (DM) je až v Profilu** (karta „Nebezpečná zóna“, `CampaignDangerRow`), ne na hlavní stránce kampaně.
- **Deník** (migrace 010, `JournalController`, `/campaigns/:id/journal`): zápisy podle témat s hledáním a filtrem témat, připnutí (jen DM), formátování bez HTML (`RichText`: `**tučně**`, `*kurzíva*`, `# nadpis`, odrážky, odkazy http(s)). Viditelnost jako u bodů na mapě: `all`, `selected`, `dm` (DM zakládá), `owner` (soukromý zápisek hráče, nevidí ho ani DM).
  Nové zápisy se počítají od posledního otevření deníku (od vstupu do kampaně), po otevření se označí jako přečtené, ale ve stránce zůstanou označené „nové“. API testy `journal.test.ts` (21), E2E `journal.spec.ts`.
- **Peníze v panelu DM** (`DmController::giveCurrency`, `Money::splitCoins/fromCp`, `CurrencyForm`): `mode` `give` nebo `take` (odebrání platí `Money::pay`, takže se vrací drobné; vše nebo nic, když někdo nemá na svůj díl, nikomu se nic neodebere), `split: true` rozdělí částku rovným dílem (mince po druzích, zbylé přes mědáky, `leftoverCp` zůstane DM, na moc málo peněz 422) a volitelný `reason` (do 120 znaků) jde do oznámení. Dialog ukazuje náhled částky pro každého stejným výpočtem jako server (`splitCoins` v `money.ts`). API testy v `dm.test.ts`, E2E v `dm.spec.ts`.
- **NPC a nepřátelé** (migrace 012, `characters.kind`, `EnemyController`, `features/enemies/`): DM nemá vlastní postavu, hraje za NPC a nepřátele.
  **NPC** je plnohodnotná postava (celý sheet, taktiky) s `kind = 'npc'` a `owner_id = NULL`: nepatří nikomu (ani DM), DM jich může mít víc, zakládá je `POST /campaigns/{id}/characters` s `kind: 'npc'` (jen DM; hráč 403, s `ownerId` 422; UI `…/characters/new?npc=1`, tlačítko „Nové NPC“ na stránce kampaně a v Panelu DM). Změnit majitele NPC nejde (422). Hráči vidí NPC jako veřejný náhled (jako cizí postavy, sekce „NPC“ na stránce kampaně; DM může u NPC nastavit `visibility` full) a **můžou mu předávat peníze a itemy** (`transfer` bere kteroukoli postavu v kampani, příjemce v nabídce má „(NPC)“). `Notifications::push` s `NULL` majitelem nic nezapíše. NPC se nepočítá v `Languages::byPlayer` (jen hráči). `MyCharacterCard` nenabízí DM „Vytvořit postavu“, „Nová postava“ v Družině mají jen hráči; v Panelu DM mají NPC štítek a „Vybrat všechny hráče“ vybere jen hráčské postavy.
  **Nepřátelé** jsou jednoduché záznamy, **ne postavy** (tabulka `enemies`: jméno, `hp_max`, `hp_current`, AC, `attacks` JSON `[{name, toHit, damage}]`, poznámka, pořadí): celé API je jen pro DM (`GET/POST /campaigns/{id}/enemies`, `PATCH/DELETE /enemies/{id}`, `POST /enemies/{id}/hp` s `delta`, `POST /enemies/{id}/duplicate` = plné zdraví a jméno „Goblin 2“); hráč 403, cizinec 404, nic nejde předat (nejsou v seznamu postav). Výraz zranění se validuje přes `Dice::parse`, max 100 nepřátel a 12 útoků. UI `/campaigns/:id/enemies` (odkaz „Nepřátelé“ v Panelu DM): karty s HP (±1/±5 a vlastní hodnota, na nule „Padl“), AC, útoky s hody (`useRoller` s `hidden`, výchozí **skryté** před hráči, přepínač nahoře) a při přidání jde zadat víc kusů najednou. Testy `npc-enemies.test.ts`, `e2e/npc-enemies.spec.ts`.
- **DM navíc**: dočasná HP (`POST /dm/temp-hp`, platí nová hodnota, nula ruší) a zrušení stavu jedním klepnutím na štítek na kartě postavy. Debuffy: stavy (nastavit i zrušit), záporné bonusy (např. −2 AC) s trváním a zdrojem, zranění, dočasná HP.
  **Nemodelováno**: automatický dopad stavů (např. Poisoned = nevýhoda), trvání po kolech a úrovně Exhaustion; stavy jsou štítky a DM je případně doplní záporným bonusem.
- **Vzhled**: teplá „pergamenová“ paleta s indigovým akcentem a tmavý režim (`index.css`), nadpisy fontem Cinzel (`@fontsource-variable/cinzel`, bundlovaný kvůli CSP), jemná záře pozadí, zaoblené karty. Kontrast ověřují axe testy (WCAG AA ve světlém i tmavém režimu).
  Odznaky nepřečtených mají pevně `bg-red-600`, ne `bg-destructive` (v tmavém režimu by bílý text neměl dost kontrastu).

### Další možná práce (mimo původní zadání)
- Data SRD 5.2 (2024) a filtrování pravidel podle sady kampaně (dnes engine zná rozdíly 2014/2024 a prohlížeč pravidel na to upozorňuje).
- Reset hesla přímo v aplikaci (dnes přes `set-password.php`), zálohy ostré DB (Endora je nemá zapnuté, viz sekce o pojistkách).

Po každé fázi: aplikace jde spustit, testy projdou, commit, zastavit se a ukázat výsledek.

## Zadání (shrnutí)

- Role: DM nebo hráč v kampani (per kampaň). Hráč vidí/upravuje jen své postavy, cizí jen veřejný náhled. DM vidí a upravuje vše ve své kampani. Vše vynucené na serveru a testované.
- Engine počítá proficiency, mody, savy, skilly, AC (Unarmored Defense), útoky, spell DC, sloty (multiclass tabulka, pact magic zvlášť), třídní zdroje. **Každá dopočtená hodnota jde ručně přepsat (override)** s viditelnou značkou a návratem k výpočtu.
- Zdroje a resty jako obecný model (max číslo/vzorec, aktuální, kdy se obnovuje).
- Homebrew obsah (item, kouzlo, featura, subclass) pro DM i hráče. Datový model musí umožnit české názvy/popisy a druhý ruleset (SRD 5.2) a později iniciativní tracker.
- Mimo rozsah: tokeny a pohyb po mapě, fog of war, iniciativní tracker, hlas/video, monster statbloky, prodej/sdílení obsahu.
