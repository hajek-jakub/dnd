import type { CasterType, RulesBundle } from './rules-bundle'
import { THIRD_CASTER_SUBCLASSES } from './rules-bundle'

/** Tabulka spell slotů pro multiclass sesilatele (PHB): index = caster level, hodnoty = sloty 1. až 9. úrovně. */
export const MULTICLASS_SLOTS: Record<number, number[]> = {
  1: [2],
  2: [3],
  3: [4, 2],
  4: [4, 3],
  5: [4, 3, 2],
  6: [4, 3, 3],
  7: [4, 3, 3, 1],
  8: [4, 3, 3, 2],
  9: [4, 3, 3, 3, 1],
  10: [4, 3, 3, 3, 2],
  11: [4, 3, 3, 3, 2, 1],
  12: [4, 3, 3, 3, 2, 1],
  13: [4, 3, 3, 3, 2, 1, 1],
  14: [4, 3, 3, 3, 2, 1, 1],
  15: [4, 3, 3, 3, 2, 1, 1, 1],
  16: [4, 3, 3, 3, 2, 1, 1, 1],
  17: [4, 3, 3, 3, 2, 1, 1, 1, 1],
  18: [4, 3, 3, 3, 3, 1, 1, 1, 1],
  19: [4, 3, 3, 3, 3, 2, 1, 1, 1],
  20: [4, 3, 3, 3, 3, 2, 2, 1, 1],
}

export interface ClassLevels {
  classIndex: string
  level: number
  subclassIndex?: string | null
}

/** Typ sesílání třídy včetně podtříd třetinových sesilatelů. */
export function casterTypeOf(bundle: RulesBundle, c: ClassLevels): CasterType {
  const base = bundle.classes[c.classIndex]?.casterType ?? 'none'
  if (base !== 'none') return base
  const sub = c.subclassIndex ? THIRD_CASTER_SUBCLASSES[c.subclassIndex] : undefined
  return sub && sub.classIndex === c.classIndex ? 'third' : 'none'
}

/**
 * Caster level pro tabulku slotů.
 * Jedna sesilatelská třída: half = nahoru (od 2. levelu), third = nahoru (od 3. levelu), tím vyjdou slotové tabulky třídy.
 * Více tříd: plné levely + polovina (dolů) + třetina (dolů).
 */
export function casterLevel(bundle: RulesBundle, classes: ClassLevels[]): number {
  const casters = classes.filter((c) => ['full', 'half', 'third'].includes(casterTypeOf(bundle, c)))
  if (casters.length === 0) return 0
  if (casters.length === 1) {
    const c = casters[0]!
    switch (casterTypeOf(bundle, c)) {
      case 'full':
        return c.level
      case 'half':
        return c.level >= 2 ? Math.ceil(c.level / 2) : 0
      default:
        return c.level >= 3 ? Math.ceil(c.level / 3) : 0
    }
  }
  return casters.reduce((sum, c) => {
    switch (casterTypeOf(bundle, c)) {
      case 'full':
        return sum + c.level
      case 'half':
        return sum + Math.floor(c.level / 2)
      default:
        return sum + Math.floor(c.level / 3)
    }
  }, 0)
}

/** Maximální sloty podle úrovně slotu (1 až 9). Warlock se do toho nepočítá (pact magic je zvlášť). */
export function spellSlots(bundle: RulesBundle, classes: ClassLevels[]): number[] {
  const level = casterLevel(bundle, classes)
  const row = MULTICLASS_SLOTS[Math.min(level, 20)] ?? []
  return Array.from({ length: 9 }, (_, i) => row[i] ?? 0)
}

/** Pact magic warlocka: počet slotů a jejich úroveň (všechny sloty mají stejnou úroveň), obnovují se na short rest. */
export function pactSlots(bundle: RulesBundle, classes: ClassLevels[]): { count: number; level: number } | null {
  const warlock = classes.find((c) => bundle.classes[c.classIndex]?.casterType === 'pact')
  if (!warlock) return null
  const table = bundle.classes[warlock.classIndex]?.levels[warlock.level]?.spellcasting
  if (!table) return null
  for (let level = 1; level <= 9; level++) {
    const count = table[`spell_slots_level_${level}`] ?? 0
    if (count > 0) return { count, level }
  }
  return null
}
