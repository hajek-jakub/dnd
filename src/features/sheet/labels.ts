import type { AbilityKey, SkillKey } from '@/engine'

export const ABILITY_LABELS: Record<AbilityKey, string> = {
  str: 'Síla',
  dex: 'Obratnost',
  con: 'Odolnost',
  int: 'Inteligence',
  wis: 'Moudrost',
  cha: 'Charisma',
}

export const SKILL_LABELS: Record<SkillKey, string> = {
  acrobatics: 'Akrobacie',
  'animal-handling': 'Zacházení se zvířaty',
  arcana: 'Arkána',
  athletics: 'Atletika',
  deception: 'Klamání',
  history: 'Historie',
  insight: 'Vhled',
  intimidation: 'Zastrašování',
  investigation: 'Vyšetřování',
  medicine: 'Medicína',
  nature: 'Příroda',
  perception: 'Vnímání',
  performance: 'Vystupování',
  persuasion: 'Přesvědčování',
  religion: 'Náboženství',
  'sleight-of-hand': 'Šikovné prsty',
  stealth: 'Nenápadnost',
  survival: 'Přežití',
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
