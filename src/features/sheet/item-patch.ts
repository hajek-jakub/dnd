import type { ItemInput } from './api'
import type { CharacterItem } from './types'

/**
 * Optimistická změna itemu v cache: vstup API (kletba jako text + `curseRevealed`) převede na tvar itemu (`curse: {text, revealed}`),
 * jinak by UI na okamžik dostalo kletbu jako řetězec.
 */
export function applyItemPatch(item: CharacterItem, patch: ItemInput): CharacterItem {
  const { curse, curseRevealed, ...rest } = patch
  const next = { ...item, ...rest } as CharacterItem
  if (curse !== undefined) next.curse = curse ? { text: curse, revealed: curseRevealed ?? item.curse?.revealed ?? false } : null
  else if (curseRevealed !== undefined && item.curse) next.curse = { ...item.curse, revealed: curseRevealed }
  return next
}
