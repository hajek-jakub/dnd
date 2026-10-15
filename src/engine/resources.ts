import type { AbilityKey } from './abilities'
import type { RulesBundle } from './rules-bundle'
import type { Recharge, Ruleset } from './types'

export interface ResourceDef {
  key: string
  name: string
  max: number
  recharge: Recharge
  source: string
}

const num = (v: unknown): number => (typeof v === 'number' ? v : 0)

/** Třídní zdroje (ki, rage, bardic inspiration, channel divinity, sorcery points, ...) podle levelu třídy. */
export function classResources(
  bundle: RulesBundle,
  classIndex: string,
  level: number,
  mod: (ability: AbilityKey) => number,
  ruleset: Ruleset = '2014',
): ResourceDef[] {
  const cls = bundle.classes[classIndex]
  const spec = cls?.levels[level]?.classSpecific ?? {}
  const out: ResourceDef[] = []
  const add = (key: string, name: string, max: number, recharge: Recharge) => {
    if (max > 0) out.push({ key: `${classIndex}.${key}`, name, max, recharge, source: cls?.name ?? classIndex })
  }

  switch (classIndex) {
    case 'barbarian':
      add('rage', 'Rage', num(spec.rage_count), 'long')
      break
    case 'bard':
      add('bardic-inspiration', 'Bardic Inspiration', Math.max(1, mod('cha')), level >= 5 ? 'short' : 'long')
      break
    case 'cleric':
      add('channel-divinity', 'Channel Divinity', num(spec.channel_divinity_charges), 'short')
      break
    case 'druid':
      add('wild-shape', 'Wild Shape', level >= 2 ? 2 : 0, 'short')
      break
    case 'fighter':
      add('second-wind', 'Second Wind', 1, 'short')
      add('action-surge', 'Action Surge', num(spec.action_surges), 'short')
      add('indomitable', 'Indomitable', num(spec.indomitable_uses), 'long')
      break
    case 'monk':
      // v pravidlech 2024 se ki jmenuje Focus Points (klíč zdroje zůstává monk.ki, aby se uložené hodnoty nerozbily)
      add('ki', ruleset === '2024' ? 'Focus Points' : 'Ki', num(spec.ki_points), 'short')
      break
    case 'paladin':
      add('lay-on-hands', 'Lay on Hands', level * 5, 'long')
      add('divine-sense', 'Divine Sense', 1 + Math.max(0, mod('cha')), 'long')
      add('channel-divinity', 'Channel Divinity', level >= 3 ? 1 : 0, 'short')
      break
    case 'sorcerer':
      add('sorcery-points', 'Sorcery Points', num(spec.sorcery_points), 'long')
      break
    case 'wizard':
      add('arcane-recovery', 'Arcane Recovery', 1, 'long')
      break
  }
  return out
}
