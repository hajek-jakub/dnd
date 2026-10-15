# Návod k používání

Aplikace je česky, na telefonu i na počítači. Hráči si většinou vystačí s telefonem, DM má pohodlnější počítač.
Přihlašuje se jménem a heslem (žádný e-mail). Nový hráč se zaregistruje přes **odkaz s pozvánkou** od DM.

## Dolní lišta a kampaň

Dole je pořád vidět lišta **Domů · Postava · Deník · Mapy · Zprávy** (DM má místo Postavy **Panel DM**). Míří vždy do tvé aktivní kampaně, takže ji nemusíš pokaždé vybírat: aplikace si pamatuje, kde jsi hrál naposledy.
Pravidla (SRD, homebrew), oznámení a profil jsou nahoře. **Přepnout kampaň, změnit vzhled (světlý/tmavý) nebo se odhlásit** můžeš v Profilu (ikona vpravo nahoře).

## Pro hráče

1. **Připojení**: otevři odkaz od DM, vymysli si jméno a heslo (aspoň 8 znaků). Rovnou se připojíš do kampaně.
2. **Postava**: na stránce kampaně „Nová postava“ → jméno, rasa, třída (i multiclass přes level up), vlastnosti, dovednosti. Hodnoty (modifikátory, záchranné hody, AC, sloty, ki…) se počítají samy.
   Cokoli, co si myslíš, že je jinak, půjde **přepsat klepnutím na číslo**. Přepsaná hodnota má značku „ručně“ a jde vrátit k výpočtu.
3. **Sheet** (záložky Přehled, Kouzla, Inventář, Featury, Postava): HP a dočasná HP, odpočinky (short a long rest), sloty a zdroje, útoky, kouzla (seslání ze slotu, koncentrace), inventář s nosností a attunementem, peníze, level up s historií.
4. **Kostky**: u dovedností, záchranných hodů, iniciativy, útoků a zranění je malá kostka. Hod losuje server a výsledek vidí celá družina v logu (plovoucí tlačítko s kostkou). Nahoře přepneš **Výhodu / Nevýhodu**, „Krit“ zdvojí kostky zranění.
   **Skrytý hod** vidíš jen ty a DM. Volný hod napíšeš třeba jako `2d6+3`.
5. **Zprávy**: Skupina (vidí všichni), soukromě s DM (nikdo jiný to nevidí) a Tajné zprávy od DM jen pro vybrané. Nepřečtené ukazuje odznak v horní liště a u vlákna.
6. **Mapy**: DM zveřejní mapu, ty na ní vidíš body, které ti DM ukázal. Vlastní **soukromé poznámky** na mapě (tlačítko „Přidat poznámku“) uvidíš jen ty, ani DM ne.
7. **Deník**: informace od DM podle témat (příběh, místa, postavy, frakce…). Nové zápisy ukazuje odznak v liště a štítek „nové“; důležité jsou připnuté nahoře. Můžeš hledat a filtrovat podle tématu a psát si **soukromé zápisky**, které uvidíš jen ty.
8. **Oznámení** (zvonek): když ti DM něco dá nebo změní (item, XP, bonus, zranění), ukáže se to hned.
9. **Fotka postavy** a změna hesla jsou v profilu a na záložce Postava.

## Pro DM

1. **Kampaň**: „Založit kampaň“, pak **Pozvánka** (odkaz nebo kód, platnost a počet použití nastavíš) a pošli ji hráčům. V nastavení kampaně vybereš **pravidla 2014 nebo 2024**
   (mění martial arts kostku mnicha, monk zbraně a pojmenování Ki / Focus Points) a zapneš sledování nosnosti.
2. **Panel DM**: karty všech postav (HP, AC, pasivní vnímání, stavy, sloty, bonusy). Zaškrtni jednu, víc nebo všechny postavy a použij akci: zranění a léčení, XP (celé, nebo rozdělené rovným dílem), peníze, item (z pravidel i jednorázový), stav, inspirace,
   **dočasná HP** (platí nová hodnota) a **bonus s trváním** („do long restu“, „dokud nezruším“, trvalý), který se promítne do výpočtů s viditelným zdrojem. Hráč dostane oznámení. Stav jde zrušit klepnutím na štítek přímo na kartě postavy. Záporné hodnoty bonusu fungují jako debuff (třeba −2 AC). Poznámky DM vidíš jen ty.
3. **Mapy**: nahraj obrázek (zmenší se na 4096 px), mapa je zprvu skrytá, „Zveřejnit“ ji ukáže hráčům. Na mapu přidáváš body s ikonou (hrad, město, nebezpečí, poklad…) a vybereš, kdo je uvidí:
   všichni, vybraní hráči, nebo jen ty. Body jdou tahem přesouvat.
4. **Zprávy**: soukromě jednomu hráči, tajně více hráčům najednou, nebo do skupiny. Hráči si mezi sebou soukromě psát nemohou, jen tobě.
5. **Deník**: zakládáš zápisy podle témat (příběh, místa, postavy, frakce, domácí pravidla…) pro všechny, vybrané hráče, nebo jen pro sebe, a důležité připneš nahoru. Formátování: `**tučně**`, `*kurzíva*`, `# nadpis`, odrážky `- položka`, odkazy.
6. **Pravidla**: SRD 5.1 (kouzla, itemy, třídy, rasy…) a katalog magických itemů (jen údaje s odkazem). **Homebrew** (kouzla, itemy, zbraně, featury, subclassy) vytvoříš v sekci Pravidla po výběru kampaně a vidí ho členové kampaně.
7. **Kostky**: stejné jako hráči, navíc vidíš skryté hody hráčů a můžeš hodit za kteroukoli postavu.

## Když něco nejde

- **Zapomenuté heslo**: v aplikaci není samoobslužný reset. Správce (ten, kdo aplikaci provozuje) ho nastaví příkazem `NEW_PASSWORD='nove-heslo' php api/bin/set-password.php <jméno>` (pro ostrou databázi s `DND_CONFIG=api/config.production.php` jen u toho jednoho příkazu). Hráč se pak přihlásí novým heslem a v profilu si ho změní.
- **Změna se nepromítla**: sheet se sám obnovuje každých pár sekund, zprávy a hody každé 4 až 5 sekund. Pomůže obnovit stránku.
- **Telefon**: aplikaci jde přidat na plochu (v prohlížeči „Přidat na plochu“), má vlastní ikonu.
