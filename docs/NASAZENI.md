# Nasazení na Endoru (dnd.hajekjakub.cz)

Všechno běží na Endoře: statický frontend, PHP API a MySQL databáze. Žádné další služby ani účty nejsou potřeba.

Zbývá čtyři věci: subdoména, PHP 8, databáze a HTTPS, a potom samotné nahrání.

**Důležité o FTP účtech Endory.** Hlavní FTP účet domény (login `hajekjakub.cz`) vidí celý prostor domény `/home/html/hajekjakub.cz`,
kde je i speciální složka `/_sub` pro automatické subdomény. Účet `jakubhajek` (ten ze stafety, a ten používá deploy)
je ale zamčený do podsložky `public_html`. Složka `/_sub/dnd`, kterou deploy vytvoří přes tento účet, je proto ve skutečnosti
`public_html/_sub/dnd` a automatická subdoména ji nenajde. Proto se subdoména nastavuje **ručně** (krok 0).

Názvy menu v administraci Endory se mohou lišit podle tarifu. Když něco nenajdeš nebo vypadá jinak,
napiš mi, co přesně vidíš, a postup upravíme.

## 0. Subdoména `dnd` (automatická) a FTP účet

1. V administraci Endory nech zapnuté **Automaticky vytvářené subdomény**. Pak stačí, aby existovala složka `_sub/dnd` v kořeni domény
   (vedle `public_html`). Vytvoří se sama, když pro ni uděláš FTP účet (krok 2).
2. **Přidat FTP účet**: login např. `dnd`, silné heslo, směrování (adresář) na `/_sub/dnd` (v kořeni domény, ne v `public_html`).
   Když složka `dnd` v `_sub` ještě neexistuje, vytvoř ji ve správci souborů.
3. Do `.env.deploy` dej login a heslo toho účtu a `FTP_JAILED=true` (viz krok 4). Účet vidí jen složku aplikace.
4. Certifikát Let's Encrypt pro `dnd.hajekjakub.cz` už je objednaný a funguje.

Kontrola po nasazení: `https://dnd.hajekjakub.cz/api/health` ukáže `{"ok":true}`. Změna subdomén v Endoře může trvat až hodinu.

## 1. Zkontroluj verzi PHP (musí být 8.0 nebo novější)

1. V administraci Endory najdi nastavení PHP (verze PHP pro doménu nebo web).
2. Nastav **PHP 8.1 nebo novější** (nejméně 8.0). Bez toho API vrátí hlášku, že vyžaduje novější PHP.

Rychlá kontrola po nasazení: otevři `https://dnd.hajekjakub.cz/api/health`. Správně se zobrazí `{"ok":true}`.

## 2. Vytvoř MySQL databázi

1. V administraci Endory otevři sekci **Databáze** (MySQL) a vytvoř novou databázi.
2. Poznamenej si čtyři údaje: **adresa serveru** (host), **název databáze**, **uživatel** a **heslo**.
   Pozor: adresa serveru nemusí být `localhost`. Opiš ji přesně z administrace.
3. Kdyby tvůj tarif povoloval jen jednu databázi, je to v pořádku. Aplikace používá jednu a tabulky si zakládá sama.

## 3. Připrav konfiguraci API

1. V projektu zkopíruj soubor `api/config.example.php` jako `api/config.production.php`.
   (Tento soubor je v `.gitignore`, nikdy se nenahraje do gitu.)
2. Otevři `api/config.production.php` a změň:
   - `db`: host, port (obvykle 3306), name, user, password podle údajů z kroku 2.
   - `registration_key`: tajné heslo, kterým si **ty jako DM** založíš účet. Vymysli dlouhé, nebo ho vygeneruj v terminálu:
     `openssl rand -hex 12`
   - `migrate_key`: dlouhý náhodný klíč, kterým deploy spouští aktualizaci databáze. Vygeneruj ho:
     `openssl rand -hex 24`
   - `debug`: nastav na `false`.
   - Nic dalšího neměň. Pokud zůstane dev hodnota, deploy se odmítne spustit a řekne ti proč.
3. Heslo k databázi a oba klíče nikomu neposílej. Ulož je do správce hesel.

## 4. Připrav FTP údaje

1. Zkopíruj `.env.deploy.example` jako `.env.deploy` (taky je v `.gitignore`).
2. Vyplň:

   ```
   FTP_HOST=ftp.hajekjakub.cz
   FTP_USER=...                     # login FTP účtu z kroku 0
   FTP_PASSWORD=...
   FTP_JAILED=true                  # účet je zamčený ve složce aplikace
   SITE_URL=https://dnd.hajekjakub.cz
   FTP_SECURE=true                  # když se nepřipojí, zkus false
   ```

   Skript maže soubory, které v nové verzi nejsou. Proto buď použij zamčený účet (`FTP_JAILED=true`), nebo nastav konkrétní
   složku v `FTP_REMOTE_DIR` (nikdy ne `/` na účtu, který vidí víc webů).

## 5. HTTPS (důležité kvůli heslům)

Heslo se posílá na server, takže musí jít přes HTTPS.

1. V administraci Endory zapni SSL certifikát (HTTPS) pro subdoménu `dnd.hajekjakub.cz`, pokud to tvůj tarif umožňuje.
   Aktivace může trvat od minut po několik hodin.
2. Dokud HTTPS nefunguje, nenasazuj aplikaci pro ostatní hráče. Soubor `public/.htaccess` přesměrovává HTTP na HTTPS,
   takže bez certifikátu by web nešel otevřít.
3. Kdyby tvůj tarif HTTPS pro subdomény neměl vůbec, napiš mi. Probereme možnosti (např. nasazení na hlavní doménu s certifikátem).

## 6. Nasazení

```
npm run deploy:dry     # suchý běh: vypíše, co se nahraje a smaže, nic nemění
npm run deploy         # build, nahrání na FTP, aktualizace databáze
```

Co deploy udělá:
1. Zkontroluje `api/config.production.php` (že nejsou dev hodnoty a ladění).
2. Postaví frontend (`dist/`).
3. Nahraje frontend do `/_sub/dnd`, PHP API do `/_sub/dnd/api` a konfiguraci jako `api/config.php`.
4. Smaže na serveru soubory, které v nové verzi nejsou (jen uvnitř `FTP_REMOTE_DIR`).
5. Zavolá `https://dnd.hajekjakub.cz/api/admin/migrate`, které založí nebo aktualizuje tabulky v databázi,
   a `https://dnd.hajekjakub.cz/api/admin/seed`, které načte pravidla (SRD 5.1 a katalog itemů). Pokud se data nezměnila, přeskočí se.

Každá další verze se nasazuje stejným příkazem `npm run deploy`. Data v databázi se při tom nemažou.

## 7. První přihlášení

1. Otevři `https://dnd.hajekjakub.cz`, klepni na **Zaregistruj se**.
2. Do pole „Kód pozvánky nebo registrační heslo“ zadej `registration_key` z kroku 3, zvol si jméno a heslo.
3. Založ kampaň, vytvoř pozvánku a pošli hráčům odkaz. Hráč na odkaz klepne, zaregistruje se (kód se vyplní sám) a je v kampani.

## Připomínky session

Připomínku den předem posílá server sám, kdykoli má někdo aplikaci otevřenou. Aby přišla i tehdy, když ji večer nikdo neotevře,
nastav v administraci Endory **cron** (každých 15 minut). Dvě možnosti:

- příkaz: `php /cesta/k/_sub/dnd/api/bin/remind.php` (přesnou cestu najdeš v administraci Endory u cronu), nebo
- adresa (plánovač Endory umí jen zavolat URL): `https://dnd.hajekjakub.cz/api/cron/reminders?key=<migrate_key z api/config.production.php>`, typ „Crontab formát“, čas `*/15 * * * *`. Přidání úlohy volá adresu metodou HEAD, ta nic nedělá. Klíč je v adrese, proto ji nikam nesdílej;
- pro externí službu (např. cron-job.org) jde i `POST https://dnd.hajekjakub.cz/api/admin/reminders` s hlavičkou `X-Migrate-Key`.

Volání je bezpečné opakovat, připomínka se pošle jen jednou. Hodina připomínky je `session_reminder_hour` (výchozí 17) a časové pásmo `timezone` (výchozí Europe/Prague) v konfiguraci.

## Zálohy

Data jsou v MySQL na Endoře. V administraci Endory najdeš export databáze (často přes phpMyAdmin, volba „Exportovat“).
Doporučuji si před hraním občas stáhnout zálohu. Kdybys chtěl, přidáme později tlačítko nebo skript pro zálohu.

## Časté problémy

- **`/api/health` ukazuje 500 nebo hlášku o PHP**: v administraci Endory přepni verzi PHP na 8.1+ (krok 1).
- **`/api/health` funguje, ale registrace hlásí chybu serveru**: nejspíš špatné údaje k databázi v `api/config.production.php`
  (adresa serveru, název, uživatel nebo heslo). Oprav a nasaď znovu.
- **Deploy hlásí „Migrace selhaly“**: otevři `https://dnd.hajekjakub.cz/api/health`. Pokud nejde, je problém v PHP nebo v `.htaccess`
  (Endora musí mít zapnutý `mod_rewrite`, běžně je). Pokud jde, je problém v údajích k databázi.
- **Po obnovení podstránky (např. `/profile`) je 404**: nenahrál se `.htaccess` nebo je vypnutý `mod_rewrite`. Napiš mi.
- **Deploy hlásí chybu připojení k FTP**: zkus `FTP_SECURE=false`, zkontroluj host, uživatele a heslo.
- **Zapomenuté heslo hráče**: zatím nejde obnovit e-mailem (aplikace e-maily neposílá). Hráč si založí nový účet, nebo ti napíše a heslo se
  nastaví ručně v databázi. Pokud chceš reset hesla přes DM, přidáme ho.

## Nasazení do podsložky místo subdomény (kdyby se hodilo)

1. Při buildu nastav `VITE_BASE_PATH=/dnd/` (např. `VITE_BASE_PATH=/dnd/ npm run deploy`).
2. V `public/.htaccess` změň `RewriteBase /` na `RewriteBase /dnd/` a `RewriteRule . /index.html` na `RewriteRule . /dnd/index.html`.
3. Nastav `FTP_REMOTE_DIR` na složku podsložky a `SITE_URL` na adresu s podsložkou.
