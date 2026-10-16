import { formatCoins, splitCoins } from '@/features/sheet/money'
import type { Currency } from '@/features/sheet/types'
import type { LootAssignment, LootEntry } from './api'

/** Přiřazení lootu před rozdáním: id položky → id postav (bez duplicit, v pořadí přiřazení). */
export type Assignments = Record<string, string[]>

/** Přidá postavy k položkám (přetažení na ikonu nebo klepnutí na ni se zaškrtnutými položkami). */
export function assign(current: Assignments, entryIds: string[], characterIds: string[]): Assignments {
  const next = { ...current }
  for (const id of entryIds) next[id] = [...new Set([...(next[id] ?? []), ...characterIds])]
  return next
}

/** Odebere postavu z přiřazení položky; bez postavy (nebo když nikdo nezbyde) zruší přiřazení celé položky. */
export function unassign(current: Assignments, entryId: string, characterId?: string): Assignments {
  const next = { ...current }
  const rest = characterId === undefined ? [] : (next[entryId] ?? []).filter((c) => c !== characterId)
  if (rest.length > 0) next[entryId] = rest
  else delete next[entryId]
  return next
}

/** Kolik přiřazených položek dostane postava. */
export function countFor(current: Assignments, characterId: string): number {
  return Object.values(current).filter((ids) => ids.includes(characterId)).length
}

/**
 * Požadavek na rozdání: jedno přiřazení na položku (dvě přiřazení téhož zlata by každé zaplatilo celou částku), zlato pro víc postav
 * se dělí rovným dílem, item dostane každá postava. Položky, které mezitím zmizely (smazané v jiném okně), vynechá.
 */
export function toRequest(current: Assignments, entries: LootEntry[]): LootAssignment[] {
  const byId = new Map(entries.map((e) => [e.id, e]))
  return Object.entries(current).flatMap(([entryId, characterIds]) => {
    const entry = byId.get(entryId)
    if (!entry || characterIds.length === 0) return []
    return [{ entryId, characterIds, ...(entry.kind === 'gold' && characterIds.length > 1 ? { split: true } : {}) }]
  })
}

/** Díl zlata pro každého stejným výpočtem jako server (mince po druzích, zbytek v měďácích zůstane DM). */
export function goldShare(currency: Partial<Currency>, recipients: number): { each: string; leftoverCp: number; tooSmall: boolean } {
  const r = splitCoins(currency, Math.max(1, recipients))
  return { each: formatCoins(r.share), leftoverCp: r.leftoverCp, tooSmall: r.eachCp < 1 }
}
