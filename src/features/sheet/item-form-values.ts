import type { ItemInput } from './api'
import type { CharacterItem } from './types'

/** Výchozí hodnoty formuláře itemu: item postavy, nebo item připravený v lootu (viz `formValuesFromInput`). */
export type ItemFormValues = Partial<CharacterItem>

/** Vstup itemu (tvar, ve kterém ho ukládá loot) převede na výchozí hodnoty formuláře. */
export function formValuesFromInput(input: ItemInput): ItemFormValues {
  const { curse, curseRevealed, charges, ...rest } = input
  return {
    ...rest,
    ruleId: rest.ruleId ?? null,
    curse: curse ? { text: curse, revealed: curseRevealed ?? false } : null,
    charges: charges ? { ...charges, used: 0 } : null,
  }
}
