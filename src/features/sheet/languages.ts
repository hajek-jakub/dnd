/**
 * Číselník jazyků (stejný jako `Languages::CATALOG` na serveru). Jazyk postavy je v `extraProficiencies` jako `Language: <název>`
 * a vybírá se jen z číselníku, takže se hráči v chatu spolehlivě shodnou (žádná diakritika ani překlepy navíc).
 */
const PREFIX = /^\s*language\s*:\s*(.+?)\s*$/i

export const LANGUAGE_CATALOG: { name: string; label: string }[] = [
  { name: 'Common', label: 'Obecná (Common)' },
  { name: 'Dwarvish', label: 'Trpasličí (Dwarvish)' },
  { name: 'Elvish', label: 'Elfí (Elvish)' },
  { name: 'Giant', label: 'Obří (Giant)' },
  { name: 'Gnomish', label: 'Gnómí (Gnomish)' },
  { name: 'Goblin', label: 'Goblinština (Goblin)' },
  { name: 'Halfling', label: 'Půlčičí (Halfling)' },
  { name: 'Orc', label: 'Skřetí (Orc)' },
  { name: 'Abyssal', label: 'Propastná (Abyssal)' },
  { name: 'Celestial', label: 'Nebeská (Celestial)' },
  { name: 'Draconic', label: 'Dračí (Draconic)' },
  { name: 'Deep Speech', label: 'Hlubinná řeč (Deep Speech)' },
  { name: 'Infernal', label: 'Pekelná (Infernal)' },
  { name: 'Primordial', label: 'Prvotní (Primordial)' },
  { name: 'Sylvan', label: 'Sylvánská (Sylvan)' },
  { name: 'Undercommon', label: 'Podzemní (Undercommon)' },
  { name: "Thieves' Cant", label: "Zlodějská hantýrka (Thieves' Cant)" },
  { name: 'Druidic', label: 'Druidská (Druidic)' },
]

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

/** Český popisek jazyka z číselníku; neznámý (starší) zápis zůstane, jak je. */
export function languageLabel(name: string): string {
  return LANGUAGE_CATALOG.find((l) => same(l.name, name))?.label ?? name
}

export function languagesOf(extraProficiencies: string[]): string[] {
  return extraProficiencies.flatMap((e) => {
    const m = PREFIX.exec(e)
    return m?.[1] ? [m[1]] : []
  })
}

/** Přidá jazyk z číselníku (bez duplicit); cokoli mimo číselník nebo už přidaný jazyk vrátí beze změny. */
export function withLanguage(extraProficiencies: string[], name: string): string[] {
  const entry = LANGUAGE_CATALOG.find((l) => same(l.name, name))
  if (!entry || languagesOf(extraProficiencies).some((l) => same(l, entry.name))) return extraProficiencies
  return [...extraProficiencies, `Language: ${entry.name}`]
}

export function withoutLanguage(extraProficiencies: string[], name: string): string[] {
  return extraProficiencies.filter((e) => {
    const m = PREFIX.exec(e)
    return !(m?.[1] && same(m[1], name))
  })
}
