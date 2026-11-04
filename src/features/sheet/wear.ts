/** Zbraň a zlodějské náčiní (Thieves' Tools) mají počítadlo nat 1: po jedničce se na k20 přehodí tohle číslo. */
export function tracksBreakage(item: { kind: string; name: string }): boolean {
  return item.kind === 'weapon' || isThievesTools(item.name)
}

/** „Thieves' Tools“, „Thieves Tools“ i bez apostrofu. */
export function isThievesTools(name: string): boolean {
  const n = name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/['’′]/g, '')
  return n.includes('thieves tool')
}

/** Co hráč u počítadla vidí: 0 je čerstvá věc (první kontrola je nad 1), pak se číslo zvedá. */
export function wearHint(nat1: number, broken: boolean): string {
  if (broken) return 'Rozbitá. Oprava ji spraví a počítadlo vynuluje.'
  if (nat1 <= 0) return 'Po nat 1 zvedni na 1 a hoď k20. Když padne 1, rozbij ji a příště zvedni dál.'
  return `Hoď k20. Když nepadne víc než ${nat1}, rozbij ji. Pak číslo zvedni.`
}

/** Zbraň, jejíž název sedí na taktiku (Shortsword u Robinn). */
export function weaponByTitle<T extends { kind: string; name: string }>(items: T[], title: string): T | undefined {
  const n = title.trim().toLowerCase()
  if (n === '') return undefined
  return items.find((i) => i.kind === 'weapon' && i.name.trim().toLowerCase() === n)
}
