export type ActionType = 'action' | 'bonus' | 'reaction' | 'free' | 'none'

export const ACTION_LABELS: Record<ActionType, string> = {
  action: 'Akce',
  bonus: 'Bonusová akce',
  reaction: 'Reakce',
  free: 'Zdarma',
  none: 'Bez akce',
}

export interface AttackData {
  actionType: ActionType
  toHit: string
  damage: string
  roll: string
  range: string
  usage: string
  note: string
  cost: string
  hex: boolean
  /** kolik útoků provede jedno použití (Extra Attack = 2) */
  count: number
  /** id itemu postavy, kterým se střílí (každý útok ubere 1 kus); '' = nic */
  ammo: string
}
export interface SpellData {
  level: number
  actionType: ActionType
  range: string
  duration: string
  concentration: boolean
  save: string
  effect: string
  roll: string
  cost: string
  /** kouzelný útok, např. d20+6 (Eldritch Blast) */
  toHit: string
  count: number
}
export interface KiData {
  actionType: ActionType
  cost: string
  description: string
  toHit: string
  damage: string
  roll: string
  count: number
  hex: boolean
}
export interface PassiveData {
  type: 'passive' | 'reaction'
  description: string
  cost: string
}
export interface ComboData {
  steps: string[]
  expectedDamage: string
  cost: string
  highlight: boolean
  description: string
  /** co kombo provede: taktiky téže postavy a kolikrát */
  uses: { id: string; count: number }[]
}
export interface RuleData {
  text: string
}

interface Base {
  id: string
  characterId: string
  position: number
  title: string
}
export type Tactic =
  | (Base & { kind: 'attack'; data: AttackData })
  | (Base & { kind: 'spell'; data: SpellData })
  | (Base & { kind: 'ki'; data: KiData })
  | (Base & { kind: 'passive'; data: PassiveData })
  | (Base & { kind: 'combo'; data: ComboData })
  | (Base & { kind: 'rule'; data: RuleData })

export type TacticKind = Tactic['kind']

/** Co se posílá na server: název a pole podle druhu (viz Tactics::normalize). */
export type TacticInput = { title: string } & Record<string, unknown>

export const KIND_LABELS: Record<TacticKind, string> = {
  attack: 'Útok',
  spell: 'Kouzlo',
  ki: 'Ki schopnost',
  passive: 'Pasivka nebo reakce',
  combo: 'Kombo',
  rule: 'Pravidlo',
}
