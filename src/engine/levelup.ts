import type { AbilityKey } from './abilities'
import { abilityModifier } from './abilities'
import type { RulesBundle } from './rules-bundle'

/**
 * Prerekvizity multiclassu (PHB): vlastnost musí mít aspoň 13. Platí pro novou třídu i pro všechny třídy, které postava už má.
 * `all` = všechny vlastnosti, `any` = stačí jedna z nich.
 */
export const MULTICLASS_PREREQUISITES: Record<string, { all?: AbilityKey[]; any?: AbilityKey[] }> = {
  barbarian: { all: ['str'] },
  bard: { all: ['cha'] },
  cleric: { all: ['wis'] },
  druid: { all: ['wis'] },
  fighter: { any: ['str', 'dex'] },
  monk: { all: ['dex', 'wis'] },
  paladin: { all: ['str', 'cha'] },
  ranger: { all: ['dex', 'wis'] },
  rogue: { all: ['dex'] },
  sorcerer: { all: ['cha'] },
  warlock: { all: ['cha'] },
  wizard: { all: ['int'] },
}

export const MULTICLASS_MINIMUM = 13

/** Chybějící prerekvizity pro přidání nové třídy (prázdné pole = splněno). Neznámá třída (homebrew) žádné prerekvizity nemá. */
export function multiclassProblems(
  scores: Record<AbilityKey, number>,
  currentClasses: string[],
  newClass: string,
  className: (idx: string) => string = (idx) => idx,
): string[] {
  const problems: string[] = []
  for (const cls of new Set([...currentClasses, newClass])) {
    const req = MULTICLASS_PREREQUISITES[cls]
    if (!req) continue
    for (const a of req.all ?? []) {
      if (scores[a] < MULTICLASS_MINIMUM) problems.push(`${className(cls)}: ${a.toUpperCase()} ${MULTICLASS_MINIMUM}+ (máš ${scores[a]})`)
    }
    if (req.any && !req.any.some((a) => scores[a] >= MULTICLASS_MINIMUM)) {
      problems.push(`${className(cls)}: ${req.any.map((a) => a.toUpperCase()).join(' nebo ')} ${MULTICLASS_MINIMUM}+`)
    }
  }
  return problems
}

/** Přírůstek HP za level: hozená hodnota (nebo průměr kostky) + modifikátor CON, nejméně 1. */
export function hpGainForLevel(hitDie: number, conScore: number, roll: number | null): number {
  const base = roll ?? Math.floor(hitDie / 2) + 1
  return Math.max(1, base + abilityModifier(conScore))
}

/** Průměr kostky podle pravidel (např. d8 = 5). */
export function averageRoll(hitDie: number): number {
  return Math.floor(hitDie / 2) + 1
}

/** Dává třída na daném levelu zvýšení vlastností (ASI nebo feat)? */
export function hasAbilityScoreImprovement(bundle: RulesBundle, classIndex: string, classLevel: number): boolean {
  const levels = bundle.classes[classIndex]?.levels
  if (!levels?.[classLevel]) return [4, 8, 12, 16, 19].includes(classLevel)
  const before = levels[classLevel - 1]?.abilityScoreBonuses ?? 0
  return levels[classLevel].abilityScoreBonuses > before
}

/** Nejvyšší úroveň kouzla, kterou třída na daném levelu zvládne (pro warlocka úroveň pact slotů). */
export function maxSpellLevel(bundle: RulesBundle, classIndex: string, classLevel: number): number {
  const table = bundle.classes[classIndex]?.levels[classLevel]?.spellcasting
  if (!table) return 0
  let max = 0
  for (let l = 1; l <= 9; l++) if ((table[`spell_slots_level_${l}`] ?? 0) > 0) max = l
  return max
}

export interface NewSpellAllowance {
  /** Kolik nových cantripů třída tímto levelem získává. */
  cantrips: number
  /** Kolik nových známých kouzel (jen třídy se seznamem známých kouzel: bard, sorcerer, warlock, ranger). */
  spells: number
  /** Čarodějova kniha: 2 nová kouzla za level. */
  spellbook: number
  maxSpellLevel: number
}

/** Kolik nových kouzel třída při tomto level upu získává podle tabulek SRD. */
export function newSpellAllowance(bundle: RulesBundle, classIndex: string, newClassLevel: number): NewSpellAllowance {
  const levels = bundle.classes[classIndex]?.levels
  const now = levels?.[newClassLevel]?.spellcasting
  const before = levels?.[newClassLevel - 1]?.spellcasting
  const diff = (key: string) => Math.max(0, (now?.[key] ?? 0) - (before?.[key] ?? 0))
  return {
    cantrips: diff('cantrips_known'),
    spells: diff('spells_known'),
    spellbook: classIndex === 'wizard' ? 2 : 0,
    maxSpellLevel: maxSpellLevel(bundle, classIndex, newClassLevel),
  }
}
