# D&D kampaňová aplikace

Webová aplikace pro D&D 5e skupinu (DM + 3–6 hráčů). Nahrazuje papírový character sheet, DM má vlastní panel.
Mobile-first, UI česky, herní obsah anglicky (SRD 5.1). Zadání a plán fází: viz konec souboru.

## Architektura

- **Frontend**: Vite + React 19 + React Router + TypeScript (strict), Tailwind v4 + shadcn/ui (styl base-nova, komponenty v `src/components/ui`). Čistě statická SPA, žádný vlastní server.
- **Backend**: Supabase (Auth magic link, Postgres + RLS, Storage, Realtime). Klient používá jen veřejný anon/publishable klíč. Service role klíč nesmí nikdy do klienta ani do buildu.
- **Citlivé operace** (rozdávání itemů a peněz, předávání, level up zápisy): Postgres funkce `SECURITY DEFINER` (RPC) nebo Edge Functions. Klient nemá přímý zápis tam, kde by mohl podvádět.
- **Hosting**: Endora (Apache, FTP), subdoména `dnd.hajekjakub.cz`, kořen subdomény. `npm run build` vyrobí `dist/`, `npm run deploy` ho nahraje přes FTP.
- **Stav dat v klientu**: TanStack Query, mutace s optimistickými aktualizacemi (rollback při chybě). Vzor: `src/features/campaigns/api.ts`, `src/features/profile/api.ts`.
- **Pravidlový engine** (od fáze 3): čisté TS funkce v `src/engine/`, bez UI a DB, pokryté Vitestem.

### Adresáře

```
src/components/        sdílené komponenty (AppLayout, ThemeToggle, ui/ = shadcn)
src/features/<modul>/  auth, campaigns, profile (další: sheet, spells, inventory, levelup, dm, messages, maps, dice)
src/lib/               supabase klient, utils, database.types.ts (GENEROVANÝ, needitovat)
src/engine/            (fáze 3) pravidla
supabase/migrations/   jediný zdroj pravdy o DB (jen přes migrace!)
supabase/tests/database/  pgTAP testy RLS (*.test.sql)
scripts/deploy.mjs     FTP nasazení
public/.htaccess       SPA routing + cache + hlavičky (kopíruje se do dist/)
docs/NASAZENI.md       postup nastavení Endory a Supabase cloudu
```

## Příkazy

| Příkaz | Co dělá |
| --- | --- |
| `npm run db:start` | spustí lokální Supabase (Docker musí běžet) |
| `npm run db:stop` | zastaví lokální Supabase |
| `npm run db:reset` | smaže lokální DB a znovu aplikuje všechny migrace + seed |
| `npm run db:types` | přegeneruje `src/lib/database.types.ts` z lokální DB (po každé migraci!) |
| `npm run dev` | dev server na http://localhost:5173 |
| `npm test` | Vitest (unit testy) |
| `npm run test:db` | pgTAP testy RLS proti lokální DB |
| `npm run test:e2e` | Playwright E2E v Chromiu (desktop + mobile Pixel 7); vyžaduje běžící `db:start`, dev server si spustí sám |
| `npm run test:e2e:report` | otevře HTML report posledního E2E běhu |
| `npm run typecheck` / `npm run lint` | kontrola typů / oxlint |
| `npm run build` | produkční build do `dist/` |
| `npm run deploy` (`deploy:dry`) | build + FTP nasazení (suchý běh = nic nemění) |

Nová migrace: `npx supabase migration new <nazev>`, napsat SQL, `npm run db:reset`, `npm run db:types`, `npm run test:db`.
Lokální e-maily (magic link) se zobrazují v Mailpitu: http://127.0.0.1:54324. Supabase Studio: http://127.0.0.1:54323.

## Proměnné prostředí

- `.env.development.local` (lokální vývoj): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (hodnoty z `npx supabase status -o env`, použij `PUBLISHABLE_KEY`).
- `.env.production.local` (ostrý build): URL a klíč cloudového projektu.
- `.env.deploy` (FTP): viz `.env.deploy.example`. Nikdy se necommituje.
- `VITE_BASE_PATH` (výchozí `/`): cesta, pod kterou aplikace běží. Při změně uprav i `RewriteBase` v `public/.htaccess`.
- Všechny `.env*` kromě `*.example` jsou v `.gitignore`. Do buildu patří jen proměnné s prefixem `VITE_` a nic tajného.

## Konvence

- TypeScript strict, `noUncheckedIndexedAccess`. Importy přes alias `@/` (= `src/`).
- UI texty česky. Jména souborů a kódu anglicky. Komentáře k pravidlům a bezpečnosti česky.
- **Dvě zařízení**: DM hraje na počítači, hráči z telefonu. Každá stránka musí fungovat na obou: telefon = jeden sloupec, `lg:` (≥1024 px) = víc sloupců a širší kontejner (`max-w-6xl`). Nová stránka dostane layout test v `e2e/layout.spec.ts` (žádný horizontální scroll, dotykové cíle ≥ 44 px, správné rozložení podle šířky).
- Mobile-first: tlačítka a inputy min. 44 px (výchozí velikosti v `ui/button` a `ui/input` jsou upravené). Podporovat tmavý režim (třída `dark`, `next-themes`).
- Nadpisy karet jsou skutečné `h2` (`CardTitle`), E2E testy se na ně dotazují přes `getByRole('heading')`.
- Přístupnost: každé ikonové tlačítko má `aria-label`, chyby `role="alert"`, stavy `role="status"`.
- Bezpečnost má přednost před rychlostí. Žádné „TODO: oprávnění“. Co se týká přístupu, vynucuje se v Postgresu (RLS), UI je jen pohodlí.
- Gen. typy (`database.types.ts`) a `components/ui/*` (shadcn) se needitují ručně, kromě úprav velikostí popsaných výše.

## Databáze a bezpečnostní model

- **RLS je zapnuté na všech tabulkách**, výchozí stav je zákaz. Role `anon` nemá k datům žádný přístup.
- Migrace `phase1_core` odebírá výchozí práva `anon`/`authenticated` v schématu `public` a **mění default privileges**: každá nová tabulka/funkce/sekvence potřebuje v migraci výslovné `grant` (jinak k ní klient nemá přístup). Pro RLS tabulky přidej `grant select/insert/... to authenticated` jen pro potřebné operace.
- Pomocné funkce pro politiky: `is_campaign_member(cid)`, `is_campaign_dm(cid)`, `is_user_in_campaign(cid, uid)`, `shares_campaign_with(uid)`. Všechny `SECURITY DEFINER` s `search_path = ''`.
- Role je **per kampaň** (`campaign_members.role`: `dm` nebo `player`). Role se klientem nedá měnit. Členové vznikají jen přes `create_campaign()` a `accept_invite()`.
- Pozvánky (`invites`): vidí a spravuje jen DM; kód má 10 znaků (abeceda bez 0/O/1/I/L), platnost, max. použití, zrušení.
- Cizí postavy: tabulka `characters` vidí majitel a DM (a ostatní jen při `visibility = 'full'`, což nastavuje jen DM). Ostatní členové vidí view `character_public` (jméno, fotka, rasa, třída, level). Trigger `characters_guard` hlídá změnu kampaně, majitele a viditelnosti.
- `dm_notes`: pouze DM.
- Každá nová tabulka s citlivými daty musí mít test v `supabase/tests/database/`. Pravidlo z fáze 7: soukromé zprávy musí mít test, že je hráč nepřečte ani nezmění.
- Testy pgTAP: každý soubor je jedna transakce s rollbackem; pomocné funkce `tests.become(uuid)` se definují na začátku souboru (viz `01_campaigns_rls.test.sql`).

## E2E testy (Playwright, Chromium)

- Konfigurace `playwright.config.ts`: projekt `desktop` (1440x900) a `mobile` (emulace Pixel 7). Scénář `e2e/flow.spec.ts` simuluje reálnou situaci: DM na počítači, hráč v druhé relaci jako telefon.
- Přihlášení v testech: `e2e/helpers.ts` (`login`) pošle magic link na unikátní e-mail a vytáhne odkaz z lokálního Mailpitu. Testy tedy potřebují běžící lokální Supabase.
- E2E ověřují i RLS přes REST API s tokenem hráče (hráč nesmí číst pozvánky, cizí kampaně ani volat `create_invite`).
- Motiv (světlý/tmavý/systém): vlastní `ThemeProvider` v `src/components/theme.tsx` (`next-themes` se nepoužívá, nefunguje čistě s Reactem 19). Inline skript v `index.html` nastaví `dark` před vykreslením.

## Přihlášení

- Magic link přes e-mail, `flowType: 'implicit'` (odkaz funguje i v jiném prohlížeči než ten, kde se přihlášení spustilo, což je u mobilů důležité).
- `emailRedirectTo` = origin + base + `next` (cesta se validuje funkcí `safeNextPath`, aby nešlo o open redirect). V Supabase musí být povolené Redirect URLs (lokálně v `supabase/config.toml`, v cloudu v dashboardu).
- Google přihlášení: zatím ne (volitelné, později).

## Stav projektu

### Fáze 1 – Kostra: HOTOVO
- Vite + React + TS strict + Tailwind + shadcn/ui + Router + Vitest + oxlint.
- Supabase lokálně (Docker), migrace `20261015170000_phase1_core.sql`: profily, kampaně, členství, pozvánky, minimální postavy + veřejný náhled, DM poznámky, RLS, RPC.
- pgTAP testy RLS: `01_campaigns_rls` (kampaně, role, pozvánky, anon), `02_characters_rls` (postavy, veřejný náhled, DM poznámky).
- UI: přihlášení magic linkem, seznam kampaní, založení, připojení kódem/odkazem, detail kampaně (členové, pozvánky pro DM, odchod, smazání), profil, tmavý režim.
- E2E v Chromiu (desktop + mobil): přihlášení, kampaň, pozvánka, hráč na telefonu, RLS přes API, layout, tmavý režim.
- Nasazení: `public/.htaccess`, `scripts/deploy.mjs` (basic-ftp), `docs/NASAZENI.md`.
- **Čeká na uživatele**: založení subdomény na Endoře, cloudový Supabase projekt, první ostré nasazení (postup v `docs/NASAZENI.md`).

### Další fáze (dle zadání)
2. Data: import SRD 5.1 (5e-bits/5e-database), model pro homebrew, prohlížeč kouzel/itemů/featur, stránka „O aplikaci“ s atribucí SRD 5.1 (CC-BY-4.0).
3. Sheet a engine (včetně povinného testu Monk 5 Open Hand / Warlock 1 Fiend).
4. Kouzla a inventář. 5. Level up. 6. DM panel. 7. Zprávy. 8. Mapy. 9. Kostky. 10. Leštění (rozšířit E2E o další scénáře; základ v Playwrightu už je hotový).

Po každé fázi: aplikace jde spustit, testy projdou, commit, zastavit se a ukázat výsledek.

## Zadání (shrnutí)

- Role: DM nebo hráč v kampani (per kampaň). Hráč vidí/upravuje jen své postavy, cizí jen veřejný náhled. DM vidí a upravuje vše ve své kampani. Vše vynucené přes RLS a testované.
- Engine počítá proficiency, mody, savy, skilly, AC (Unarmored Defense), útoky, spell DC, sloty (multiclass tabulka, pact magic zvlášť), třídní zdroje. **Každá dopočtená hodnota jde ručně přepsat (override)** s viditelnou značkou a návratem k výpočtu.
- Zdroje a resty jako obecný model (max číslo/vzorec, aktuální, kdy se obnovuje).
- Homebrew obsah (item, kouzlo, featura, subclass) pro DM i hráče. Datový model musí umožnit české názvy/popisy a druhý ruleset (SRD 5.2) a později iniciativní tracker.
- Mimo rozsah: tokeny a pohyb po mapě, fog of war, iniciativní tracker, hlas/video, monster statbloky, prodej/sdílení obsahu.
