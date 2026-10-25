import type { AbilityKey, SkillKey } from '@/engine'

export const ABILITY_LABELS: Record<AbilityKey, string> = {
  str: 'Strength',
  dex: 'Dexterity',
  con: 'Constitution',
  int: 'Intelligence',
  wis: 'Wisdom',
  cha: 'Charisma',
}

export const SKILL_LABELS: Record<SkillKey, string> = {
  acrobatics: 'Acrobatics',
  'animal-handling': 'Animal Handling',
  arcana: 'Arcana',
  athletics: 'Athletics',
  deception: 'Deception',
  history: 'History',
  insight: 'Insight',
  intimidation: 'Intimidation',
  investigation: 'Investigation',
  medicine: 'Medicine',
  nature: 'Nature',
  perception: 'Perception',
  performance: 'Performance',
  persuasion: 'Persuasion',
  religion: 'Religion',
  'sleight-of-hand': 'Sleight of Hand',
  stealth: 'Stealth',
  survival: 'Survival',
}

export const RECHARGE_LABELS = { short: 'short rest', long: 'long rest', dawn: 'úsvit', manual: 'ručně' } as const

export const ALIGNMENTS = [
  'Lawful Good',
  'Neutral Good',
  'Chaotic Good',
  'Lawful Neutral',
  'True Neutral',
  'Chaotic Neutral',
  'Lawful Evil',
  'Neutral Evil',
  'Chaotic Evil',
]

/** Druhy itemů (stejné jako `Items::KINDS` na serveru). Engine zná jen weapon, armor a shield, ostatní jsou pro přehlednost. */
export const ITEM_KINDS = [
  { value: 'wondrous', label: 'Wondrous item (kouzelný předmět)' },
  { value: 'weapon', label: 'Zbraň (weapon)' },
  { value: 'armor', label: 'Zbroj (armor)' },
  { value: 'shield', label: 'Štít (shield)' },
  { value: 'staff', label: 'Hůl (staff)' },
  { value: 'wand', label: 'Hůlka (wand)' },
  { value: 'rod', label: 'Žezlo (rod)' },
  { value: 'scroll', label: 'Svitek (scroll)' },
  { value: 'potion', label: 'Lektvar (potion)' },
  { value: 'other', label: 'Ostatní (other)' },
] as const

export type ItemKind = (typeof ITEM_KINDS)[number]['value']

/** Krátký český název druhu pro seznamy. */
export const ITEM_KIND_SHORT: Record<ItemKind, string> = {
  wondrous: 'Wondrous item',
  weapon: 'Zbraň',
  armor: 'Zbroj',
  shield: 'Štít',
  staff: 'Staff',
  wand: 'Wand',
  rod: 'Rod',
  scroll: 'Scroll',
  potion: 'Potion',
  other: 'Ostatní',
}
