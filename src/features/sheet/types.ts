import type { AbilityKey, CustomResource, Recharge, SkillKey } from '@/engine'

export interface CharacterState {
  /** null = ještě nikdy neupraveno, bere se plné HP. */
  hpCurrent: number | null
  hpTemp: number
  deathSuccesses: number
  deathFailures: number
  hitDiceUsed: Record<string, number>
  slotsUsed: Record<string, number>
  pactSlotsUsed: number
  resources: Record<string, number>
  conditions: string[]
}

export interface CharacterPreview {
  id: string
  campaignId: string
  ownerId: string
  name: string
  race: string
  classSummary: string
  level: number
  photoVersion: string | null
  access: 'public'
}

export interface CharacterFull extends Omit<CharacterPreview, 'access'> {
  access: 'full'
  subrace: string
  background: string
  alignment: string
  xp: number
  inspiration: boolean
  description: string
  personality: { traits: string; ideals: string; bonds: string; flaws: string }
  notes: string
  visibility: 'public_only' | 'full'
  abilityScores: Record<AbilityKey, number>
  baseSpeed: number
  levels: { classIndex: string; hpRoll: number | null; choices: Record<string, unknown> }[]
  subclasses: Record<string, string>
  skillProficiencies: Partial<Record<SkillKey, 0 | 1 | 2>>
  extraSaveProficiencies: AbilityKey[]
  extraProficiencies: string[]
  overrides: Record<string, number>
  customResources: { key: string; name: string; max: number; recharge: Recharge }[]
  currency: { cp: number; sp: number; ep: number; gp: number; pp: number }
  state: CharacterState
  rev: number
  createdAt: string
  updatedAt: string
}

export type CharacterListItem = CharacterPreview | CharacterFull

export type AdjustOp =
  | { op: 'hp'; delta: number; max: number }
  | { op: 'tempHp'; set: number }
  | { op: 'slot'; level: number; delta: number; max: number }
  | { op: 'pact'; delta: number; max: number }
  | { op: 'hitDie'; die: string; delta: number; max: number }
  | { op: 'resource'; key: string; delta: number; max: number }
  | { op: 'deathSave'; kind: 'success' | 'failure'; delta: number }
  | { op: 'inspiration'; set: boolean }
  | { op: 'xp'; delta: number }
  | { op: 'condition'; name: string; set: boolean }

export type { CustomResource }
