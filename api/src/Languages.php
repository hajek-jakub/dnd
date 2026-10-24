<?php

declare(strict_types=1);

namespace Dnd;

/**
 * Jazyky hráčů v kampani. Jazyk je položka `Language: <název>` v `extra_proficiencies` postavy (stejně jako v seedu).
 * Hráč zná jazyk, když ho zná kterákoli jeho postava v kampani. DM se nepočítá (v jazyce píšou jen hráči, DM zprávy jen čte).
 * Z názvu vzniká `slug` (malá písmena, čísla, pomlčky), podle kterého se jazyk porovnává a který je v názvu vlákna `lang:<slug>`.
 */
final class Languages
{
    public const MAX_SLUG = 40;
    private const PREFIX = '/^\s*language\s*:\s*(.+?)\s*$/iu';

    /** Číselník jazyků (PHB). Hráč si vybírá z něj, takže se jazyky v chatu spolehlivě shodují (žádné překlepy ani diakritika navíc). */
    public const CATALOG = [
        'Common', 'Dwarvish', 'Elvish', 'Giant', 'Gnomish', 'Goblin', 'Halfling', 'Orc',
        'Abyssal', 'Celestial', 'Draconic', 'Deep Speech', 'Infernal', 'Primordial', 'Sylvan', 'Undercommon', "Thieves' Cant", 'Druidic',
    ];

    /** Další zápisy téhož jazyka (česky, s diakritikou i bez), po `fold()`. Název z číselníku se přidává sám. */
    private const ALIASES = [
        'Common' => ['obecna', 'spolecna', 'obecna rec'],
        'Dwarvish' => ['dwarf', 'trpaslici', 'trplasictina', 'trpasliky', 'trpaslicti', 'trpasli', 'trpasličtina'],
        'Elvish' => ['elf', 'elfstina', 'elfi', 'elfsky'],
        'Giant' => ['obri', 'obri rec', 'obrovska'],
        'Gnomish' => ['gnome', 'gnomstina', 'gnomsky', 'skritci'],
        'Goblin' => ['goblinstina', 'goblini', 'goblinsky'],
        'Halfling' => ['pulcik', 'pulcici', 'pulcictina', 'pulcicky'],
        'Orc' => ['orcish', 'skreti', 'skretstina', 'skretsky'],
        'Abyssal' => ['propasti', 'propastna', 'abyss'],
        'Celestial' => ['nebeska', 'nebestina', 'nebesky'],
        'Draconic' => ['draci', 'draci rec', 'drakonstina', 'draci jazyk'],
        'Deep Speech' => ['hlubinna rec', 'hlubinna', 'hluboka rec'],
        'Infernal' => ['pekelna', 'pekelstina', 'pekelny'],
        'Primordial' => ['prvotni', 'prvotni rec', 'prvotstina'],
        'Sylvan' => ['sylvan', 'sylvanstina', 'lesni'],
        'Undercommon' => ['podzemni', 'podzemni rec'],
        "Thieves' Cant" => ['thieves cant', 'zlodejska hantyrka', 'hantyrka', 'zlodejsky argot'],
        'Druidic' => ['druidstina', 'druidska', 'druidsky'],
    ];

    /** Malá písmena bez diakritiky a bez interpunkce: „Skřetština!“ i „skretstina“ jsou po foldu stejné. */
    public static function fold(string $name): string
    {
        $s = strtr(mb_strtolower(trim($name)), [
            'á' => 'a', 'ä' => 'a', 'č' => 'c', 'ď' => 'd', 'é' => 'e', 'ě' => 'e', 'ë' => 'e', 'í' => 'i', 'ĺ' => 'l', 'ľ' => 'l', 'ň' => 'n',
            'ó' => 'o', 'ö' => 'o', 'ô' => 'o', 'ŕ' => 'r', 'ř' => 'r', 'š' => 's', 'ť' => 't', 'ú' => 'u', 'ů' => 'u', 'ü' => 'u', 'ý' => 'y', 'ž' => 'z',
        ]);
        return trim((string) preg_replace('/[^a-z0-9]+/', ' ', $s));
    }

    /** Název jazyka z číselníku pro libovolný zápis (anglicky, česky, s diakritikou i bez), jinak null. */
    public static function canonical(string $name): ?string
    {
        $key = self::fold($name);
        if ($key === '') {
            return null;
        }
        foreach (self::CATALOG as $lang) {
            if ($key === self::fold($lang) || in_array($key, array_map([self::class, 'fold'], self::ALIASES[$lang] ?? []), true)) {
                return $lang;
            }
        }
        return null;
    }

    public static function slug(string $name): string
    {
        return mb_substr(str_replace(' ', '-', self::fold($name)), 0, self::MAX_SLUG);
    }

    /**
     * Zápisy `Language: ...` v seznamu proficiencies převede na název z číselníku (a odstraní duplicity). Neznámý jazyk je chyba,
     * ostatní položky (zbraně, nástroje) se nemění.
     * @param list<string> $list
     * @return list<string>
     */
    public static function normalizeProficiencies(array $list): array
    {
        $out = [];
        foreach ($list as $entry) {
            if (preg_match(self::PREFIX, $entry, $m) === 1) {
                $canonical = self::canonical($m[1]);
                if ($canonical === null) {
                    throw HttpError::validation('Neznámý jazyk „' . trim($m[1]) . '“. Vyber jazyk ze seznamu.', 'extraProficiencies');
                }
                $entry = 'Language: ' . $canonical;
            }
            $out[] = $entry;
        }
        return array_values(array_unique($out));
    }

    /**
     * Jazyky všech hráčů kampaně: userId => [slug => název]. Zápisy se čtou přes číselník, takže se shodují i starší data.
     * @return array<string, array<string, string>>
     */
    public static function byPlayer(string $campaignId): array
    {
        $rows = Db::all(
            "SELECT c.owner_id, c.extra_proficiencies FROM characters c
             JOIN campaign_members m ON m.campaign_id = c.campaign_id AND m.user_id = c.owner_id AND m.role = 'player'
             WHERE c.campaign_id = ? ORDER BY c.created_at",
            [$campaignId],
        );
        $out = [];
        foreach ($rows as $r) {
            $list = json_decode((string) $r['extra_proficiencies'], true);
            foreach (is_array($list) ? $list : [] as $entry) {
                if (is_string($entry) && preg_match(self::PREFIX, $entry, $m) === 1) {
                    $name = self::canonical($m[1]) ?? trim($m[1]);
                    $slug = self::slug($name);
                    if ($slug !== '') {
                        $out[(string) $r['owner_id']][$slug] ??= $name;
                    }
                }
            }
        }
        return $out;
    }
}
