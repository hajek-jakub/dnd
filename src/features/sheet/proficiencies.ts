import { isLanguageEntry } from './languages'

export type ProficiencyGroup = 'armor' | 'weapon' | 'tool' | 'other'

export const PROFICIENCY_GROUPS: { key: ProficiencyGroup; label: string; prefix: string | null }[] = [
  { key: 'weapon', label: 'Zbraně', prefix: 'Weapon' },
  { key: 'armor', label: 'Zbroj a štíty', prefix: 'Armor' },
  { key: 'tool', label: 'Nástroje a vozidla', prefix: 'Tool' },
  { key: 'other', label: 'Ostatní', prefix: null },
]

export interface ProficiencyEntry {
  /** Přesný zápis v seznamu (u vlastních se podle něj maže). */
  raw: string
  name: string
  group: ProficiencyGroup
  /** Z třídy (nejde odebrat), nebo zapsaná ručně, seedem či z rasy. */
  fromClass: boolean
}

const PREFIX = /^(weapons?|armou?r|tools?)\s*:\s*/i

/** Skupina podle předpony („Tool: Navigator's Tools“), u proficiencies z třídy podle názvu („Light Armor“, „Thieves' Tools“). */
export function groupOf(entry: string): ProficiencyGroup {
  const m = PREFIX.exec(entry)
  const p = m?.[1]?.toLowerCase()
  if (p) return p.startsWith('weapon') ? 'weapon' : p.startsWith('arm') ? 'armor' : 'tool'
  if (/armou?r|shields?$/i.test(entry)) return 'armor'
  if (/tools?|kit|supplies|utensils|instrument|vehicles?/i.test(entry)) return 'tool'
  if (/weapons?$|swords?$|bows?$|crossbows?$|axes?$|hammers?$|spears?$|daggers?$|darts?$|slings?$|clubs?$|maces?$|staffs?$|javelins?$|scimitars?$|sickles?$|rapiers?$|tridents?$|whips?$|nets?$|lances?$|pikes?$|glaives?$|halberds?$|flails?$|picks?$|morningstars?$|blowguns?$|firearms?/i.test(entry))
    return 'weapon'
  return 'other'
}

export const nameOf = (entry: string) => entry.replace(PREFIX, '').trim()

/** Všechny proficiencies postavy bez jazyků (ty mají vlastní kartu) a bez savů a dovedností. */
export function proficiencyEntries(all: string[], extra: string[]): ProficiencyEntry[] {
  const own = new Set(extra)
  return all
    .filter((p) => !isLanguageEntry(p))
    .map((raw) => ({ raw, name: nameOf(raw), group: groupOf(raw), fromClass: !own.has(raw) }))
}

/** Zápis nové proficiency: se skupinou jako předponou, aby ji engine poznal (Weapon: Longbow → útok s proficiency). */
export function withProficiency(extra: string[], group: ProficiencyGroup, name: string): string[] {
  const clean = name.trim().replace(/\s+/g, ' ')
  if (clean === '') return extra
  const prefix = PROFICIENCY_GROUPS.find((g) => g.key === group)?.prefix
  const entry = prefix ? `${prefix}: ${clean}` : clean
  const key = (s: string) => nameOf(s).toLowerCase()
  if (extra.some((e) => !isLanguageEntry(e) && key(e) === clean.toLowerCase() && groupOf(e) === group)) return extra
  return [...extra, entry]
}

export const withoutProficiency = (extra: string[], raw: string) => extra.filter((e) => e !== raw)
