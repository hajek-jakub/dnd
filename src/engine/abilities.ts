export const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const
export type AbilityKey = (typeof ABILITIES)[number]

export function abilityModifier(score: number): number {
  return Math.floor((score - 10) / 2)
}

export function isAbilityKey(value: string): value is AbilityKey {
  return (ABILITIES as readonly string[]).includes(value)
}

export const SKILLS = [
  { key: 'acrobatics', ability: 'dex' },
  { key: 'animal-handling', ability: 'wis' },
  { key: 'arcana', ability: 'int' },
  { key: 'athletics', ability: 'str' },
  { key: 'deception', ability: 'cha' },
  { key: 'history', ability: 'int' },
  { key: 'insight', ability: 'wis' },
  { key: 'intimidation', ability: 'cha' },
  { key: 'investigation', ability: 'int' },
  { key: 'medicine', ability: 'wis' },
  { key: 'nature', ability: 'int' },
  { key: 'perception', ability: 'wis' },
  { key: 'performance', ability: 'cha' },
  { key: 'persuasion', ability: 'cha' },
  { key: 'religion', ability: 'int' },
  { key: 'sleight-of-hand', ability: 'dex' },
  { key: 'stealth', ability: 'dex' },
  { key: 'survival', ability: 'wis' },
] as const satisfies readonly { key: string; ability: AbilityKey }[]

export type SkillKey = (typeof SKILLS)[number]['key']

export function formatModifier(value: number): string {
  return value >= 0 ? `+${value}` : `−${Math.abs(value)}`
}
