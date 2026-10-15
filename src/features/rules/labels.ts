import type { HomebrewKind, RuleKind, RuleSummary } from '@/lib/types'

export interface RuleGroup {
  id: string
  label: string
  kinds: RuleKind[]
  /** Druh, který se v této skupině dá vytvořit jako homebrew. */
  homebrewKind?: HomebrewKind
}

export const GROUPS: RuleGroup[] = [
  { id: 'spells', label: 'Kouzla', kinds: ['spell'], homebrewKind: 'spell' },
  { id: 'items', label: 'Magické itemy', kinds: ['magic_item'], homebrewKind: 'magic_item' },
  { id: 'gear', label: 'Vybavení', kinds: ['equipment', 'weapon', 'armor'] },
  { id: 'features', label: 'Featury', kinds: ['feature', 'feat'], homebrewKind: 'feature' },
  { id: 'classes', label: 'Třídy', kinds: ['class', 'subclass'], homebrewKind: 'subclass' },
  { id: 'races', label: 'Rasy', kinds: ['race', 'subrace', 'trait'] },
  { id: 'other', label: 'Ostatní', kinds: ['condition', 'background', 'skill', 'language', 'weapon_property', 'ability'] },
]

export const KIND_LABELS: Record<RuleKind, string> = {
  spell: 'Kouzlo',
  magic_item: 'Magický item',
  equipment: 'Vybavení',
  weapon: 'Zbraň',
  armor: 'Zbroj',
  feature: 'Featura',
  feat: 'Feat',
  class: 'Třída',
  subclass: 'Subclass',
  race: 'Rasa',
  subrace: 'Subrasa',
  trait: 'Rasový rys',
  condition: 'Stav',
  background: 'Background',
  skill: 'Dovednost',
  language: 'Jazyk',
  weapon_property: 'Vlastnost zbraně',
  ability: 'Vlastnost',
}

export const HOMEBREW_KIND_LABELS: Record<HomebrewKind, string> = {
  spell: 'kouzlo',
  magic_item: 'item',
  feature: 'featuru',
  subclass: 'subclassu',
}

export const RARITIES = ['common', 'uncommon', 'rare', 'very rare', 'legendary', 'artifact', 'varies'] as const

export function groupById(id: string | null): RuleGroup {
  return GROUPS.find((g) => g.id === id) ?? GROUPS[0]!
}

export function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

export function spellLevelLabel(level: number): string {
  return level === 0 ? 'Cantrip' : `Level ${level}`
}

/** Cena v gp s mezerou jako oddělovačem tisíců, např. "1 000 gp". */
export function formatPrice(priceGp: number | null, note: string | null): string | null {
  if (priceGp === null && !note) return null
  const base = priceGp === null ? null : `${new Intl.NumberFormat('cs-CZ').format(priceGp)} gp`
  if (note && base && !note.startsWith(base.replace(/\s/g, ' '))) {
    // poznámka obsahuje celý popis ceny, např. "1,000 gp + 2 x armor cost"
    return /gp \+/.test(note) ? note : `${base} (${note})`
  }
  return base ?? note
}

/** Krátký řádek pod názvem v seznamu. */
export function metaLine(entry: RuleSummary): string {
  const parts: string[] = []
  switch (entry.kind) {
    case 'spell':
      parts.push(spellLevelLabel(entry.level ?? 0))
      if (entry.category) parts.push(entry.category)
      break
    case 'magic_item':
      if (entry.category) parts.push(entry.category)
      if (entry.rarity) parts.push(capitalize(entry.rarity))
      if (entry.attunement) parts.push('attunement')
      break
    case 'feature':
      if (entry.category) parts.push(entry.category)
      if (entry.level) parts.push(`level ${entry.level}`)
      break
    default:
      parts.push(KIND_LABELS[entry.kind])
      if (entry.category) parts.push(entry.category)
  }
  const price = formatPrice(entry.priceGp, null)
  if (price && (entry.kind === 'magic_item' || entry.kind === 'weapon' || entry.kind === 'armor' || entry.kind === 'equipment'))
    parts.push(price)
  return parts.join(' · ')
}
