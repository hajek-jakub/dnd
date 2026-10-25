import type { JournalNpc } from './npc-api'

/** Pro řazení a písmena v seznamu: bez diakritiky a velikosti písmen („Čmuchal“ patří k C). */
export function fold(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

/** Písmeno, pod které NPC patří (bez diakritiky, velkými písmeny), ostatní znaky pod „#“. */
export function letterOf(name: string): string {
  const first = fold(name.trim()).charAt(0).toUpperCase()
  return /[A-Z]/.test(first) ? first : '#'
}

/** Abecední řazení podle češtiny (Č až za C, Ch až za H). */
export function sortNpcs<T extends { name: string }>(npcs: T[]): T[] {
  return [...npcs].sort((a, b) => a.name.localeCompare(b.name, 'cs', { sensitivity: 'base' }) || a.name.localeCompare(b.name, 'cs'))
}

export interface NpcGroup {
  letter: string
  npcs: JournalNpc[]
}

/** Abecední seznam rozdělený na písmena; „#“ (číslice, symboly) je vždy na konci. */
export function groupByLetter(npcs: JournalNpc[]): NpcGroup[] {
  const map = new Map<string, JournalNpc[]>()
  for (const n of sortNpcs(npcs)) {
    const letter = letterOf(n.name)
    map.set(letter, [...(map.get(letter) ?? []), n])
  }
  return [...map.entries()]
    .sort(([a], [b]) => (a === '#' ? 1 : b === '#' ? -1 : a.localeCompare(b)))
    .map(([letter, list]) => ({ letter, npcs: list }))
}

export type NpcFilter = 'all' | 'npc' | 'character'

/** Hledání ve jménu, rase a popisu (bez ohledu na diakritiku) a filtr podle původu (NPC / postavy hráčů). */
export function filterNpcs(npcs: JournalNpc[], query: string, filter: NpcFilter): JournalNpc[] {
  const q = fold(query.trim())
  return npcs.filter((n) => {
    if (filter === 'character' && n.characterKind !== 'pc') return false
    if (filter === 'npc' && n.characterKind === 'pc') return false
    return q === '' || fold(`${n.name} ${n.race} ${n.description}`).includes(q)
  })
}
