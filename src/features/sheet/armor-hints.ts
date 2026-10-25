import type { ComputedSheet } from '@/engine'
import type { CharacterItem } from './types'

/**
 * Zbroje a štíty s hodnotami, které engine do AC nevzal: z inventáře se počítá jen kombinace s nejvyšším AC
 * (mnich se Unarmored Defense radši zbroj neobleče), ostatní kusy jen leží v batohu.
 */
export function unusedArmor(items: CharacterItem[], sheet: ComputedSheet): CharacterItem[] {
  const used = new Set(sheet.ac.sources.map((s) => s.label))
  return items.filter((i) => (i.kind === 'armor' || i.kind === 'shield') && i.armor && !used.has(i.name))
}
