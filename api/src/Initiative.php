<?php

declare(strict_types=1);

namespace Dnd;

/**
 * Pořadí iniciativy v kampani. Nový nebo změněný záznam se zařadí podle hodnoty (vyšší dřív, při shodě za stávající),
 * ostatní zůstávají tam, kde je DM nechal. Volající musí běžet v transakci (zamyká se řádek kampaně).
 */
final class Initiative
{
    public const KINDS = ['character', 'enemy'];

    /**
     * Nastaví hodnotu (nebo záznam jen přidá na konec, když je `$value` null a ještě neexistuje) a zařadí ho do pořadí.
     */
    public static function set(string $campaignId, string $kind, string $subjectId, ?int $value): void
    {
        Db::one('SELECT id FROM campaigns WHERE id = ? FOR UPDATE', [$campaignId]);
        $rows = self::rows($campaignId);
        $existing = null;
        $others = [];
        foreach ($rows as $r) {
            if ($r['kind'] === $kind && $r['id'] === $subjectId) {
                $existing = $r;
            } else {
                $others[] = $r;
            }
        }
        $entry = ['kind' => $kind, 'id' => $subjectId, 'value' => $value ?? ($existing['value'] ?? null)];
        if ($value === null && $existing !== null) {
            return; // beze změny
        }
        $index = count($others);
        if ($value !== null) {
            foreach ($others as $i => $o) {
                if ($o['value'] === null || $o['value'] < $value) {
                    $index = $i;
                    break;
                }
            }
        }
        array_splice($others, $index, 0, [$entry]);
        self::write($campaignId, $others);
    }

    /**
     * Pořadí podle klientem poslaných klíčů "kind:id". Musí obsahovat přesně ty záznamy, které v kampani jsou.
     * @param list<string> $keys
     */
    public static function reorder(string $campaignId, array $keys): void
    {
        Db::one('SELECT id FROM campaigns WHERE id = ? FOR UPDATE', [$campaignId]);
        $rows = self::rows($campaignId);
        $byKey = [];
        foreach ($rows as $r) {
            $byKey[$r['kind'] . ':' . $r['id']] = $r;
        }
        if (count($keys) !== count($byKey) || count(array_unique($keys)) !== count($keys) || array_diff($keys, array_keys($byKey)) !== []) {
            throw HttpError::validation('Pořadí musí obsahovat přesně všechny záznamy iniciativy.', 'keys');
        }
        self::write($campaignId, array_map(static fn (string $k): array => $byKey[$k], $keys));
    }

    /** Odebere záznam; je-li na tahu, tah zůstane bez označení. */
    public static function remove(string $campaignId, string $kind, string $subjectId): void
    {
        Db::exec('DELETE FROM initiative_entries WHERE campaign_id = ? AND subject_kind = ? AND subject_id = ?', [$campaignId, $kind, $subjectId]);
        Db::exec('UPDATE initiative_state SET active_kind = NULL, active_id = NULL WHERE campaign_id = ? AND active_kind = ? AND active_id = ?', [$campaignId, $kind, $subjectId]);
        self::compact($campaignId);
    }

    public static function clear(string $campaignId): void
    {
        Db::exec('DELETE FROM initiative_entries WHERE campaign_id = ?', [$campaignId]);
        Db::exec('DELETE FROM initiative_state WHERE campaign_id = ?', [$campaignId]);
    }

    /**
     * Posune tah na dalšího (nepřátelé na 0 HP se přeskakují). Po posledním začíná další kolo.
     * @return array{round: int, active: array{kind: string, id: string}|null}
     */
    public static function next(string $campaignId): array
    {
        Db::one('SELECT id FROM campaigns WHERE id = ? FOR UPDATE', [$campaignId]);
        $rows = self::rows($campaignId);
        $state = Db::one('SELECT * FROM initiative_state WHERE campaign_id = ?', [$campaignId]);
        $round = $state === null ? 1 : (int) $state['round'];
        if ($rows === []) {
            return ['round' => $round, 'active' => null];
        }
        $down = array_column(Db::all('SELECT id FROM enemies WHERE campaign_id = ? AND hp_current = 0', [$campaignId]), 'id');
        $current = -1;
        foreach ($rows as $i => $r) {
            if ($state !== null && $r['kind'] === $state['active_kind'] && $r['id'] === $state['active_id']) {
                $current = $i;
            }
        }
        $n = count($rows);
        $target = null;
        for ($step = 1; $step <= $n; $step++) {
            $i = ($current + $step) % $n;
            if ($rows[$i]['kind'] === 'enemy' && in_array($rows[$i]['id'], $down, true)) {
                continue;
            }
            $target = $i;
            if ($current >= 0 && $i <= $current) {
                $round++;
            }
            break;
        }
        $active = $target === null ? null : ['kind' => $rows[$target]['kind'], 'id' => $rows[$target]['id']];
        Db::exec(
            'INSERT INTO initiative_state (campaign_id, active_kind, active_id, round) VALUES (?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE active_kind = VALUES(active_kind), active_id = VALUES(active_id), round = VALUES(round)',
            [$campaignId, $active['kind'] ?? null, $active['id'] ?? null, $round],
        );
        return ['round' => $round, 'active' => $active];
    }

    /**
     * Pořadí pro klienta. Záznamy o smazaných postavách a nepřátelích se při čtení uklidí.
     * @return array{round: int, active: array{kind: string, id: string}|null, entries: list<array{kind: string, id: string, value: int|null}>}
     */
    public static function view(string $campaignId): array
    {
        Db::exec(
            "DELETE e FROM initiative_entries e LEFT JOIN characters c ON e.subject_kind = 'character' AND c.id = e.subject_id AND c.campaign_id = e.campaign_id
             WHERE e.campaign_id = ? AND e.subject_kind = 'character' AND c.id IS NULL",
            [$campaignId],
        );
        Db::exec(
            "DELETE e FROM initiative_entries e LEFT JOIN enemies n ON e.subject_kind = 'enemy' AND n.id = e.subject_id AND n.campaign_id = e.campaign_id
             WHERE e.campaign_id = ? AND e.subject_kind = 'enemy' AND n.id IS NULL",
            [$campaignId],
        );
        $state = Db::one('SELECT * FROM initiative_state WHERE campaign_id = ?', [$campaignId]);
        $rows = self::rows($campaignId);
        $active = null;
        if ($state !== null && $state['active_kind'] !== null) {
            foreach ($rows as $r) {
                if ($r['kind'] === $state['active_kind'] && $r['id'] === $state['active_id']) {
                    $active = ['kind' => $r['kind'], 'id' => $r['id']];
                }
            }
        }
        return ['round' => $state === null ? 1 : (int) $state['round'], 'active' => $active, 'entries' => $rows];
    }

    /** @return list<array{kind: string, id: string, value: int|null}> */
    private static function rows(string $campaignId): array
    {
        return array_map(
            static fn (array $r): array => ['kind' => (string) $r['subject_kind'], 'id' => (string) $r['subject_id'], 'value' => $r['value'] === null ? null : (int) $r['value']],
            Db::all('SELECT subject_kind, subject_id, value FROM initiative_entries WHERE campaign_id = ? ORDER BY position, subject_id', [$campaignId]),
        );
    }

    /** @param list<array{kind: string, id: string, value: int|null}> $ordered */
    private static function write(string $campaignId, array $ordered): void
    {
        foreach ($ordered as $position => $r) {
            Db::exec(
                'INSERT INTO initiative_entries (campaign_id, subject_kind, subject_id, value, position) VALUES (?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE value = VALUES(value), position = VALUES(position)',
                [$campaignId, $r['kind'], $r['id'], $r['value'], $position],
            );
        }
    }

    private static function compact(string $campaignId): void
    {
        self::write($campaignId, self::rows($campaignId));
    }
}
