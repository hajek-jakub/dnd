# Nasazení na Endoru (dnd.hajekjakub.cz) a Supabase cloud

Tohle je postup krok za krokem. Do té doby, než ho uděláš, aplikace funguje lokálně
(`npm run db:start`, `npm run dev`). Názvy menu v administraci Endory se mohou trochu lišit,
dej vědět, co vidíš, a postup upřesníme.

## Část A: Supabase cloud (databáze a přihlášení)

1. Jdi na https://supabase.com, založ účet (stačí přihlášení přes GitHub nebo e-mail).
2. Vytvoř nový projekt: název `dnd`, region nejblíž (např. Frankfurt), vymysli a **ulož si databázové heslo** do správce hesel.
3. Počkej pár minut, než se projekt vytvoří.
4. V projektu otevři **Project Settings, API** a zkopíruj:
   - Project URL (např. `https://abcdxyz.supabase.co`)
   - Publishable key (nebo `anon` key). **Nikdy ne** `service_role` ani `secret` klíč.
5. V kořeni projektu vytvoř soubor `.env.production.local` s obsahem:

   ```
   VITE_SUPABASE_URL=https://abcdxyz.supabase.co
   VITE_SUPABASE_ANON_KEY=sem-vloz-publishable-key
   ```

6. Napoj lokální projekt na cloud a nahraj databázi (v terminálu ve složce `dnd`):

   ```
   npx supabase login
   npx supabase link --project-ref abcdxyz
   npx supabase db push
   ```

   `project-ref` je část URL před `.supabase.co`. Příkaz `db push` se zeptá na databázové heslo z kroku 2.

7. V Supabase otevři **Authentication, URL Configuration** a nastav:
   - **Site URL**: `https://dnd.hajekjakub.cz`
   - **Redirect URLs** (přidej): `https://dnd.hajekjakub.cz/**` a pro vývoj `http://localhost:5173/**`
8. **Authentication, Emails (SMTP)**: výchozí e-maily Supabase mají velmi nízký limit (pár e-mailů za hodinu) a hodí se jen na zkoušení.
   Pro skupinu hráčů si časem nastav vlastní SMTP (např. e-mail z Endory nebo služba typu Resend/Brevo). Řekni, až na to dojde, provedu tě tím.

## Část B: Subdoména na Endoře

1. Přihlas se do administrace Endory.
2. Otevři správu domén a subdomén pro `hajekjakub.cz`.
3. Přidej subdoménu `dnd`. Endora ji napojí na složku na hostingu. **Zapiš si přesný název složky** (např. `dnd.hajekjakub.cz` nebo `dnd`).
4. DNS:
   - Pokud je `hajekjakub.cz` zaregistrovaná u Endory nebo používá její DNS, záznam se vytvoří sám.
   - Pokud je doména jinde, přidej u svého registrátora DNS záznam pro `dnd` (typ A, nebo CNAME) podle pokynů, které ti Endora ukáže.
   - Šíření DNS může trvat od minut po několik hodin.
5. Zapni HTTPS (SSL certifikát) pro subdoménu, pokud ho Endora nabízí zvlášť. Bez HTTPS nebude fungovat přihlášení.
6. Zjisti FTP údaje (host, uživatel, heslo). Heslo nikomu neposílej, ani do chatu.

## Část C: Příprava nasazení

1. Zkopíruj `.env.deploy.example` do `.env.deploy` a vyplň:

   ```
   FTP_HOST=...            # adresa FTP serveru od Endory
   FTP_USER=...
   FTP_PASSWORD=...
   FTP_REMOTE_DIR=/dnd.hajekjakub.cz   # složka subdomény z části B, krok 3
   FTP_SECURE=true         # když se nepřipojí, zkus false
   ```

   `FTP_REMOTE_DIR` nesmí být kořen `/`. Skript totiž maže soubory, které v nové verzi nejsou, a smazal by tak i jiné weby.

2. Zkus suchý běh (nic nenahraje ani nesmaže, jen vypíše plán):

   ```
   npm run deploy:dry
   ```

3. Ostré nasazení:

   ```
   npm run deploy
   ```

   Spustí build s hodnotami z `.env.production.local` a nahraje obsah `dist/` na FTP.

4. Otevři `https://dnd.hajekjakub.cz`. Měla by se ukázat přihlašovací stránka.
   Zkontroluj ještě, že funguje přímý odkaz na podstránku (např. `https://dnd.hajekjakub.cz/profile` po obnovení stránky),
   to ověřuje `.htaccess`. Pokud to hlásí chybu 404, napiš mi, co přesně vidíš.

## Nasazení do podsložky (kdyby se hodilo)

Když aplikace poběží třeba na `hajekjakub.cz/dnd/`:

1. Do `.env.production.local` přidej `VITE_BASE_PATH=/dnd/`.
2. V `public/.htaccess` změň `RewriteBase /` na `RewriteBase /dnd/` a poslední pravidlo na `RewriteRule . /dnd/index.html [L]`.
3. V Supabase přidej odpovídající Redirect URL a nastav `FTP_REMOTE_DIR` na složku podsložky.

## Časté problémy

- **Přihlašovací e-mail nepřišel**: koukni do spamu, počkej minutu. Výchozí SMTP Supabase má nízký limit (viz Část A, krok 8).
- **Po kliknutí na odkaz z e-mailu se nic nestane / chyba redirectu**: Redirect URL v Supabase neodpovídá adrese webu (Část A, krok 7).
- **Bílá stránka po nasazení**: zkontroluj, že `.env.production.local` existuje a že ses build spouštěl až po jeho vytvoření.
- **Deploy hlásí chybu připojení**: zkus `FTP_SECURE=false`, zkontroluj host a heslo.
