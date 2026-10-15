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
- **Mapování na SRD**: itemy podle názvu (alias `Light Crossbow` → `Crossbow, light`), kouzla podle názvu. Co v SRD není, vznikne jako homebrew kampaně: Nunchaku a Demonic Spear (zbraně; Spear je základ Demonic Spear) a kouzlo Hex (jen fakta, bez popisu; Hex není v SRD 5.1).
  Zbraně s řádkem v sekci `attacks` se nosí v ruce (`equipped`), aby se jejich útoky ukázaly na sheetu.
- **Zastavení před zápisem** (`SeedStop`, exit 3): neznámá sekce nebo pole, neznámý item, kouzlo, zdroj nebo dovednost, nečitelné `extraDamage`, neexistující majitel nebo kampaň. Seed nejdřív celé ověří (`plan()`), teprve pak zapisuje. Když model něco neumí uložit, nejdřív se zeptat, schéma neměnit bez dohody.
- **null a TO_CONFIRM**: `null` zůstane prázdné (XP = NULL v DB, background a alignment prázdný text), UI to ukáže jako „nedoplněno“ (`MissingInfo` na sheetu, „XP nedoplněno“ v hlavičce). Texty začínající `TO_CONFIRM` se uloží do poznámek postavy a itemů tak, jak jsou,
  a UI je ukáže ve výpisu „Ke ověření“ a se štítkem „ke ověření“ u poznámek itemů (`unconfirmed.ts`, `NotesText`). `openQuestions` se na konci seedu vypíšou do konzole (do DB se neukládají).
- **Fixture pro engine**: `src/engine/hajos-sheet.test.ts` bere vstupy a `sheetValues` ze `seed/hajos.json`; engine vyjde stejně jako papír. Rozdíly jsou vědomě zdokumentované: martial arts d6 (engine 2014) proti d8 (papír 2024), spell save DC warlocka 14 proti papírovým 13
  (papírových 13 je nejspíš DC záchranného hodu ki: 8 + 3 + WIS 2; není v `discrepancies`), versatile 1d8 spearu se v útoku nemodeluje. Opravené hodnoty ze `discrepancies` (Stealth +7, STR save +3) engine dává přímo.
- API test `api-tests/seed-hajos.test.ts` (18 testů): spouští seed skript proti testovací DB, kontroluje uložená data, SRD vs. homebrew mapování, engine z uložených dat, idempotenci, `--force`, zastavení před zápisem a soukromí postavy. E2E `e2e/hajos.spec.ts` (počítač i telefon): sheet ze seedu a formulář homebrew zbraně.

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

### Bezpečnostní pojistky testů a databáze (po incidentu)
- Jednou se omylem smazala ostrá databáze: v shellu zůstala `DND_CONFIG` na ostrou konfiguraci a API testy pustily `migrate --fresh`. Proto: **`DND_CONFIG` nikdy neexportovat do shellu** (nastavovat jen před jedním příkazem),
  `Migrator::dropAll` odmítne cokoli jiného než lokální DB (`127.0.0.1`/`localhost`) a `api-tests/global-setup.ts` ignoruje `DND_CONFIG` z prostředí (vždy `api/config.test.php`, jiná jen přes `DND_TEST_CONFIG`). Hlídá to `api-tests/safety.test.ts`.
- Ostrá DB nemá zálohy (Endora je nemá zapnuté). Než se na ostré DB spustí cokoli, co zapisuje, nejdřív `--check` / čtení. Postavu Hajoš do kampaně Mirabilis na ostré DB zakládá `seed-hajos.php` s `DND_CONFIG=<ostrá>` jen pro ten jeden příkaz.

### Další fáze (dle zadání)
9. Kostky. 10. Leštění.

Po každé fázi: aplikace jde spustit, testy projdou, commit, zastavit se a ukázat výsledek.

## Zadání (shrnutí)

- Role: DM nebo hráč v kampani (per kampaň). Hráč vidí/upravuje jen své postavy, cizí jen veřejný náhled. DM vidí a upravuje vše ve své kampani. Vše vynucené na serveru a testované.
- Engine počítá proficiency, mody, savy, skilly, AC (Unarmored Defense), útoky, spell DC, sloty (multiclass tabulka, pact magic zvlášť), třídní zdroje. **Každá dopočtená hodnota jde ručně přepsat (override)** s viditelnou značkou a návratem k výpočtu.
- Zdroje a resty jako obecný model (max číslo/vzorec, aktuální, kdy se obnovuje).
- Homebrew obsah (item, kouzlo, featura, subclass) pro DM i hráče. Datový model musí umožnit české názvy/popisy a druhý ruleset (SRD 5.2) a později iniciativní tracker.
- Mimo rozsah: tokeny a pohyb po mapě, fog of war, iniciativní tracker, hlas/video, monster statbloky, prodej/sdílení obsahu.
