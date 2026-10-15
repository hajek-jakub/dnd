<?php

declare(strict_types=1);

namespace Dnd\Controllers;

use Dnd\Db;
use Dnd\HttpError;
use Dnd\Ids;
use Dnd\Input;
use Dnd\Request;
use Dnd\Response;
use Dnd\Sheets;

/**
 * Level up: každý nový level se zapíše jako řádek v character_levels včetně voleb (subclass, ASI/feat, kouzla, poznámka)
 * a údajů pro vrácení. Vrátit jde vždy jen poslední level (tím je historie vždy konzistentní).
 */
final class LevelUpController
{
    /** Levely, na kterých se zvyšují vlastnosti (ASI), pokud to data tříd neřeknou jinak. */
    private const DEFAULT_ASI = [4, 8, 12, 16, 19];

    /** @param array{id:string} $user */
    public static function levelUp(Request $req, array $params, array $user): Response
    {
        $char = Sheets::loadMutable($params['id'], $user);
        $in = $req->json();

        $classIndex = $in['classIndex'] ?? null;
        $class = is_string($classIndex) ? Db::one("SELECT idx, name, data FROM rules_entries WHERE kind = 'class' AND idx = ? AND scope = ''", [$classIndex]) : null;
        if ($class === null) {
            throw HttpError::validation('Neznámá třída.', 'classIndex');
        }
        $classData = Sheets::json($class['data'], []);
        $hitDie = (int) (is_array($classData) ? ($classData['hit_die'] ?? 8) : 8);

        $hpRoll = $in['hpRoll'] ?? null;
        if ($hpRoll !== null && (!is_int($hpRoll) || $hpRoll < 1 || $hpRoll > $hitDie)) {
            throw HttpError::validation("Hozená hodnota musí být 1 až $hitDie.", 'hpRoll');
        }
        $hpGain = $in['hpGain'] ?? 0;
        if (!is_int($hpGain) || $hpGain < 0 || $hpGain > 100) {
            throw HttpError::validation('Neplatný přírůstek HP.', 'hpGain');
        }
        $note = Input::optionalString($in, 'note', 5000, 'Poznámka') ?? '';

        $result = Db::transaction(static function () use ($params, $char, $class, $classIndex, $hpRoll, $hpGain, $in, $note): array {
            $row = Db::one('SELECT * FROM characters WHERE id = ? FOR UPDATE', [$params['id']]) ?? throw HttpError::notFound();
            $levels = Db::all('SELECT class_idx FROM character_levels WHERE character_id = ? ORDER BY seq', [$params['id']]);
            $total = count($levels);
            if ($total >= Sheets::MAX_LEVEL) {
                throw HttpError::validation('Postava už má maximální level 20.', 'classIndex');
            }
            $classLevel = 1 + count(array_filter($levels, static fn (array $l): bool => $l['class_idx'] === $classIndex));
            $undo = ['hpGain' => $hpGain];
            $choices = [];

            // Subclass
            $subclasses = Sheets::json($row['subclasses'], []);
            $subclasses = is_array($subclasses) ? $subclasses : [];
            if (isset($in['subclass']) && $in['subclass'] !== '') {
                $sub = is_string($in['subclass']) ? $in['subclass'] : '';
                $minLevel = Sheets::SUBCLASS_LEVEL[$classIndex] ?? 3;
                if ($classLevel < $minLevel) {
                    throw HttpError::validation("Subclass lze vybrat až od $minLevel. levelu třídy.", 'subclass');
                }
                $ok = Db::value(
                    "SELECT 1 FROM rules_entries WHERE kind = 'subclass' AND idx = ? AND (scope = '' OR scope = ?) AND tags LIKE ?",
                    [$sub, $char['campaign_id'], '%|' . $class['name'] . '|%'],
                );
                if ($ok === null) {
                    throw HttpError::validation('Tento subclass nepatří k dané třídě.', 'subclass');
                }
                $undo['subclass'] = ['classIdx' => $classIndex, 'previous' => $subclasses[$classIndex] ?? null];
                $subclasses[$classIndex] = $sub;
                $choices['subclass'] = $sub;
            }

            // ASI nebo feat (jen na levelech, které je dávají)
            $abilities = ['str' => (int) $row['abil_str'], 'dex' => (int) $row['abil_dex'], 'con' => (int) $row['abil_con'], 'int' => (int) $row['abil_int'], 'wis' => (int) $row['abil_wis'], 'cha' => (int) $row['abil_cha']];
            $asiAllowed = self::asiAtLevel((string) $classIndex, $classLevel);
            if (isset($in['asi'])) {
                if (!$asiAllowed) {
                    throw HttpError::validation("Na $classLevel. levelu této třídy se vlastnosti nezvyšují.", 'asi');
                }
                $inc = is_array($in['asi']) ? ($in['asi']['increases'] ?? null) : null;
                if (!is_array($inc)) {
                    throw HttpError::validation('Zvýšení vlastností má neplatný tvar.', 'asi');
                }
                $sum = 0;
                $clean = [];
                foreach ($inc as $a => $n) {
                    if (!in_array($a, Sheets::ABILITIES, true) || !is_int($n) || $n < 1 || $n > 2) {
                        throw HttpError::validation('Neplatné zvýšení vlastnosti.', 'asi');
                    }
                    if ($abilities[$a] + $n > 20) {
                        throw HttpError::validation('Vlastnost nejde zvýšit nad 20.', 'asi');
                    }
                    $clean[$a] = $n;
                    $sum += $n;
                }
                if ($sum !== 2) {
                    throw HttpError::validation('Zvýšení vlastností musí být celkem +2.', 'asi');
                }
                $undo['abilityScores'] = $abilities;
                foreach ($clean as $a => $n) {
                    $abilities[$a] += $n;
                }
                $choices['asi'] = $clean;
            }
            if (isset($in['feat'])) {
                if (!$asiAllowed) {
                    throw HttpError::validation("Na $classLevel. levelu této třídy se nevybírá feat.", 'feat');
                }
                if (isset($in['asi'])) {
                    throw HttpError::validation('Na jednom levelu lze vybrat buď zvýšení vlastností, nebo feat.', 'feat');
                }
                $feat = $in['feat'];
                if (!is_array($feat)) {
                    throw HttpError::validation('Feat má neplatný tvar.', 'feat');
                }
                $choices['feat'] = [
                    'name' => Input::string($feat, 'name', 1, 100, 'Název featu'),
                    'description' => Input::optionalString($feat, 'description', 5000, 'Popis featu') ?? '',
                    'ruleId' => isset($feat['ruleId']) && is_string($feat['ruleId']) && Ids::isUuid($feat['ruleId']) ? $feat['ruleId'] : null,
                ];
            }

            // Kouzla: přidání a odebrání
            $added = [];
            $removed = [];
            $spells = $in['spells'] ?? null;
            if ($spells !== null) {
                if (!is_array($spells)) {
                    throw HttpError::validation('Kouzla mají neplatný tvar.', 'spells');
                }
                foreach (($spells['remove'] ?? []) as $spellId) {
                    $sp = is_string($spellId) && Ids::isUuid($spellId)
                        ? Db::one('SELECT id, rule_id, class_idx, prepared, always_prepared, source FROM character_spells WHERE id = ? AND character_id = ?', [$spellId, $params['id']])
                        : null;
                    if ($sp === null) {
                        throw HttpError::validation('Odebírané kouzlo postava nemá.', 'spells');
                    }
                    $removed[] = ['rule_id' => $sp['rule_id'], 'class_idx' => $sp['class_idx'], 'prepared' => (int) $sp['prepared'], 'always_prepared' => (int) $sp['always_prepared'], 'source' => $sp['source']];
                    Db::exec('DELETE FROM character_spells WHERE id = ?', [$sp['id']]);
                }
                foreach (($spells['add'] ?? []) as $a) {
                    $ruleId = is_array($a) && is_string($a['ruleId'] ?? null) ? $a['ruleId'] : '';
                    $spellClass = is_array($a) && is_string($a['classIdx'] ?? null) ? $a['classIdx'] : '';
                    $rule = Ids::isUuid($ruleId) ? Db::one("SELECT id, kind, campaign_id FROM rules_entries WHERE id = ?", [$ruleId]) : null;
                    if ($rule === null || $rule['kind'] !== 'spell' || ($rule['campaign_id'] !== null && $rule['campaign_id'] !== $char['campaign_id'])) {
                        throw HttpError::validation('Neplatné kouzlo.', 'spells');
                    }
                    $hasClass = $spellClass === $classIndex || Db::value('SELECT 1 FROM character_levels WHERE character_id = ? AND class_idx = ? LIMIT 1', [$params['id'], $spellClass]) !== null;
                    if ($spellClass !== '' && !$hasClass) {
                        throw HttpError::validation('Postava nemá třídu kouzla.', 'spells');
                    }
                    $id = Ids::uuid();
                    $inserted = Db::exec(
                        "INSERT IGNORE INTO character_spells (id, character_id, rule_id, class_idx, prepared, always_prepared, source, created_at)
                         VALUES (?, ?, ?, ?, ?, 0, ?, UTC_TIMESTAMP())",
                        [$id, $params['id'], $ruleId, $spellClass, ($a['prepared'] ?? false) === true ? 1 : 0, $spellClass === '' ? 'other' : 'class'],
                    );
                    if ($inserted > 0) {
                        $added[] = $id;
                    }
                }
                $undo['spellsAdded'] = $added;
                $undo['spellsRemoved'] = $removed;
                $choices['spellsAdded'] = count($added);
                $choices['spellsRemoved'] = count($removed);
            }
            if ($note !== '') {
                $choices['note'] = $note;
            }

            $choices['hpGain'] = $hpGain;
            $choices['classLevel'] = $classLevel;
            $choices['undo'] = $undo;
            Db::exec(
                'INSERT INTO character_levels (id, character_id, seq, class_idx, hp_roll, choices, created_at) VALUES (?, ?, ?, ?, ?, ?, UTC_TIMESTAMP())',
                [Ids::uuid(), $params['id'], $total + 1, $classIndex, $hpRoll, Sheets::enc($choices)],
            );
            Db::exec(
                'UPDATE characters SET abil_str = ?, abil_dex = ?, abil_con = ?, abil_int = ?, abil_wis = ?, abil_cha = ?, subclasses = ?,
                    hp_current = CASE WHEN hp_current IS NULL THEN NULL ELSE hp_current + ? END, rev = rev + 1 WHERE id = ?',
                [$abilities['str'], $abilities['dex'], $abilities['con'], $abilities['int'], $abilities['wis'], $abilities['cha'], Sheets::enc($subclasses), $hpGain, $params['id']],
            );
            Sheets::syncDerived($params['id']);
            return ['level' => $total + 1];
        });

        return Response::json(['character' => self::sheet($params['id']), 'level' => $result['level']], 201);
    }

    /** Vrátí poslední level (včetně změn vlastností, subclassu, kouzel a HP). @param array{id:string} $user */
    public static function revert(Request $req, array $params, array $user): array
    {
        Sheets::loadMutable($params['id'], $user);

        Db::transaction(static function () use ($params): void {
            $row = Db::one('SELECT * FROM characters WHERE id = ? FOR UPDATE', [$params['id']]) ?? throw HttpError::notFound();
            $last = Db::one('SELECT id, seq, choices FROM character_levels WHERE character_id = ? ORDER BY seq DESC LIMIT 1', [$params['id']]);
            if ($last === null || (int) $last['seq'] <= 1) {
                throw HttpError::validation('První level nejde vrátit.', 'level');
            }
            $choices = Sheets::json($last['choices'], []);
            $undo = is_array($choices) && is_array($choices['undo'] ?? null) ? $choices['undo'] : [];

            $sets = [];
            $values = [];
            if (isset($undo['abilityScores']) && is_array($undo['abilityScores'])) {
                foreach (Sheets::ABILITIES as $a) {
                    $sets[] = "abil_$a = ?";
                    $values[] = (int) ($undo['abilityScores'][$a] ?? 10);
                }
            }
            if (isset($undo['subclass']) && is_array($undo['subclass'])) {
                $subclasses = Sheets::json($row['subclasses'], []);
                $subclasses = is_array($subclasses) ? $subclasses : [];
                $classIdx = (string) $undo['subclass']['classIdx'];
                if ($undo['subclass']['previous'] === null) {
                    unset($subclasses[$classIdx]);
                } else {
                    $subclasses[$classIdx] = $undo['subclass']['previous'];
                }
                $sets[] = 'subclasses = ?';
                $values[] = Sheets::enc($subclasses);
            }
            foreach (($undo['spellsAdded'] ?? []) as $spellId) {
                Db::exec('DELETE FROM character_spells WHERE id = ? AND character_id = ?', [$spellId, $params['id']]);
            }
            foreach (($undo['spellsRemoved'] ?? []) as $s) {
                Db::exec(
                    'INSERT IGNORE INTO character_spells (id, character_id, rule_id, class_idx, prepared, always_prepared, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP())',
                    [Ids::uuid(), $params['id'], $s['rule_id'], $s['class_idx'], $s['prepared'], $s['always_prepared'], $s['source']],
                );
            }
            $hpGain = (int) ($undo['hpGain'] ?? 0);
            if ($hpGain > 0 && $row['hp_current'] !== null) {
                $sets[] = 'hp_current = GREATEST(1, hp_current - ?)';
                $values[] = $hpGain;
            }
            $sets[] = 'rev = rev + 1';
            $values[] = $params['id'];
            Db::exec('DELETE FROM character_levels WHERE id = ?', [$last['id']]);
            Db::exec('UPDATE characters SET ' . implode(', ', $sets) . ' WHERE id = ?', $values);
            Sheets::syncDerived($params['id']);
        });

        return ['character' => self::sheet($params['id'])];
    }

    /** Dává tato třída na daném levelu zvýšení vlastností (ASI)? Podle tabulek tříd ze SRD, jinak podle obecných levelů. */
    private static function asiAtLevel(string $classIdx, int $classLevel): bool
    {
        $bonus = static function (int $level) use ($classIdx): ?int {
            if ($level < 1) {
                return 0;
            }
            $data = Db::value("SELECT data FROM rules_entries WHERE kind = 'class_level' AND idx = ? AND scope = ''", [$classIdx . '-' . $level]);
            if ($data === null) {
                return null;
            }
            $d = json_decode((string) $data, true);
            return is_array($d) ? (int) ($d['ability_score_bonuses'] ?? 0) : null;
        };
        $now = $bonus($classLevel);
        $before = $bonus($classLevel - 1);
        if ($now === null || $before === null) {
            return in_array($classLevel, self::DEFAULT_ASI, true);
        }
        return $now > $before;
    }

    /** @return array<string, mixed> */
    private static function sheet(string $id): array
    {
        $row = Db::one('SELECT * FROM characters WHERE id = ?', [$id]) ?? throw HttpError::notFound();
        $sheet = Sheets::loadMany([$row])[$id];
        return [
            'id' => $row['id'],
            'campaignId' => $row['campaign_id'],
            'ownerId' => $row['owner_id'],
            'name' => $row['name'],
            'race' => $row['race'],
            'classSummary' => $row['class_summary'],
            'level' => (int) $row['level'],
            'photoVersion' => $sheet['photoVersion'],
            'access' => 'full',
        ] + $sheet;
    }
}
