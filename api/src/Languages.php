<?php

declare(strict_types=1);

namespace Dnd;

/**
 * Jazyky hráčů v kampani. Jazyk je položka `Language: <název>` v `extra_proficiencies` postavy (stejně jako v seedu).
 * Hráč zná jazyk, když ho zná kterákoli jeho postava v kampani. DM se nepočítá (jazykové zprávy jsou jen mezi hráči).
 * Z názvu vzniká `slug` (malá písmena, čísla, pomlčky), podle kterého se jazyk porovnává a který je v názvu vlákna `lang:<slug>`.
 */
final class Languages
{
    public const MAX_SLUG = 40;
    private const PREFIX = '/^\s*language\s*:\s*(.+?)\s*$/iu';

    public static function slug(string $name): string
    {
        $s = mb_strtolower(trim($name));
        $s = trim((string) preg_replace('/[^\p{L}\p{N}]+/u', '-', $s), '-');
        return mb_substr($s, 0, self::MAX_SLUG);
    }

    /**
     * Jazyky všech hráčů kampaně: userId => [slug => název].
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
                    $slug = self::slug($m[1]);
                    if ($slug !== '') {
                        $out[(string) $r['owner_id']][$slug] ??= trim($m[1]);
                    }
                }
            }
        }
        return $out;
    }
}
