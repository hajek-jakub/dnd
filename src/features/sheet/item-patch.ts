import type { ItemInput } from './api'
import type { CharacterItem } from './types'

/**
 * Optimistická změna itemu v cache: vstup API (kletba jako text + `curseRevealed`) převede na tvar itemu (`curse: {text, revealed}`),
 * jinak by UI na okamžik dostalo kletbu jako řetězec. Náboje ze vstupu (maximum, obnova) si ponechají spotřebované, oříznuté na nové maximum.
 */
export function applyItemPatch(item: CharacterItem, patch: ItemInput): CharacterItem {
  const { curse, curseRevealed, charges, ...rest } = patch
  const next = { ...item, ...rest } as CharacterItem
  if (charges !== undefined) next.charges = charges ? { ...charges, used: Math.min(item.charges?.used ?? 0, charges.max) } : null
  if (curse !== undefined) next.curse = curse ? { text: curse, revealed: curseRevealed ?? item.curse?.revealed ?? false } : null
  else if (curseRevealed !== undefined && item.curse) next.curse = { ...item.curse, revealed: curseRevealed }
  return next
}
