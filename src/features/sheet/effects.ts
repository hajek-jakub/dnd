import { ABILITIES, SKILLS } from '@/engine'
import { ABILITY_LABELS, SKILL_LABELS } from './labels'
import type { CharacterEffect } from './types'

/** Cíle efektů (bonusů) s českými popisy; stejné hodnoty akceptuje server i engine. */
export const EFFECT_TARGETS: { value: string; label: string }[] = [
  { value: 'ac', label: 'AC' },
  { value: 'speed', label: 'Rychlost (ft)' },
  { value: 'initiative', label: 'Iniciativa' },
  { value: 'hp.max', label: 'Maximální HP' },
  { value: 'hp.perLevel', label: 'HP za každý level' },
  { value: 'proficiency', label: 'Proficiency bonus' },
  { value: 'passive.perception', label: 'Pasivní vnímání' },
  { value: 'attack.all', label: 'Bonus k útoku (všechny)' },
  { value: 'attack.melee', label: 'Bonus k útoku (na blízko)' },
  { value: 'attack.ranged', label: 'Bonus k útoku (na dálku)' },
  { value: 'damage.all', label: 'Bonus ke zranění' },
  { value: 'spell.dc', label: 'Spell save DC' },
  { value: 'spell.attack', label: 'Bonus k útoku kouzlem' },
  { value: 'save.all', label: 'Záchranné hody (všechny)' },
  ...ABILITIES.map((a) => ({ value: `save.${a}`, label: `Záchranný hod: ${ABILITY_LABELS[a]}` })),
  ...ABILITIES.map((a) => ({ value: `ability.${a}`, label: `Vlastnost: ${ABILITY_LABELS[a]}` })),
  { value: 'skill.all', label: 'Dovednosti (všechny)' },
  ...SKILLS.map((s) => ({ value: `skill.${s.key}`, label: `Dovednost: ${SKILL_LABELS[s.key]}` })),
]

export function effectLabel(target: string): string {
  return EFFECT_TARGETS.find((t) => t.value === target)?.label ?? target
}

export const DURATION_LABELS: Record<CharacterEffect['duration'], string> = {
  permanent: 'trvalý',
  long_rest: 'do long restu',
  manual: 'dokud ho DM nezruší',
}

export const formatBonus = (value: number) => `${value >= 0 ? '+' : '−'}${Math.abs(value)}`
