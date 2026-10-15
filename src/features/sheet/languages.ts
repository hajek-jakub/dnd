/** Jazyky postavy jsou v `extraProficiencies` jako `Language: <název>` (stejně jako je zapisuje seed a čte server). */
const PREFIX = /^\s*language\s*:\s*(.+?)\s*$/i

export const MAX_LANGUAGE_LENGTH = 40

/** Jazyky z PHB a SRD, jako nápověda při přidávání. */
export const COMMON_LANGUAGES = [
  'Common', 'Dwarvish', 'Elvish', 'Giant', 'Gnomish', 'Goblin', 'Halfling', 'Orc',
  'Abyssal', 'Celestial', 'Draconic', 'Deep Speech', 'Infernal', 'Primordial', 'Sylvan', 'Undercommon', "Thieves' Cant", 'Druidic',
]

export function languagesOf(extraProficiencies: string[]): string[] {
  return extraProficiencies.flatMap((e) => {
    const m = PREFIX.exec(e)
    return m?.[1] ? [m[1]] : []
  })
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

/** Přidá jazyk (bez duplicit bez ohledu na velikost písmen); prázdný nebo příliš dlouhý název vrátí beze změny. */
export function withLanguage(extraProficiencies: string[], name: string): string[] {
  const n = name.trim()
  if (n === '' || n.length > MAX_LANGUAGE_LENGTH || languagesOf(extraProficiencies).some((l) => same(l, n))) return extraProficiencies
  return [...extraProficiencies, `Language: ${n}`]
}

export function withoutLanguage(extraProficiencies: string[], name: string): string[] {
  return extraProficiencies.filter((e) => {
    const m = PREFIX.exec(e)
    return !(m?.[1] && same(m[1], name))
  })
}
