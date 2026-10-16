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
  /** Kouzlo, na které se postava právě soustředí. */
  concentration: string | null
}

export interface CharacterPreview {
  id: string
  campaignId: string
  /** null = NPC (postava DM bez majitele) */
  ownerId: string | null
  kind: 'pc' | 'npc'
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
  currency: Currency
  effects: CharacterEffect[]
  items: CharacterItem[]
  spells: CharacterSpell[]
  state: CharacterState
  rev: number
  createdAt: string
  updatedAt: string
}

export interface ItemEffect {
  target: string
  value: number
  source: string
}

export interface CharacterEffect {
  id: string
  target: string
  value: number
  source: string
  duration: 'permanent' | 'long_rest' | 'manual'
}

export interface CharacterItem {
  id: string
  ruleId: string | null
  name: string
  description: string
  kind: 'armor' | 'shield' | 'weapon' | 'item'
  quantity: number
  equipped: boolean
  attuned: boolean
  requiresAttunement: boolean
  /** spotřebuje se používáním (šípy, lektvary): tlačítko Použít ubere kus */
  consumable: boolean
  rarity: string | null
  armor: {
    base: number
    dexBonus: boolean
    maxDexBonus: number | null
    magicBonus?: number
    stealthDisadvantage?: boolean
    strMinimum?: number
  } | null
  weapon: {
    damageDice: string
    damageType: string
    category: 'simple' | 'martial'
    range: 'melee' | 'ranged'
    properties: string[]
    magicBonus?: number
    extraDamage?: { dice: string; type: string }[]
  } | null
  effects: ItemEffect[]
  notes: string
}

export interface CharacterSpell {
  id: string
  ruleId: string
  classIdx: string
  prepared: boolean
  alwaysPrepared: boolean
  source: string
  name: string
  level: number
  school: string
  castingTime: string
  range: string
  components: string
  duration: string
  concentration: boolean
  ritual: boolean
}

export type Currency = { cp: number; sp: number; ep: number; gp: number; pp: number }

export type CharacterListItem = CharacterPreview | CharacterFull

export type AdjustOp =
  | { op: 'hp'; delta: number; max: number }
  | { op: 'tempHp'; set: number }
  | { op: 'slot'; level: number; delta: number; max: number }
  | { op: 'pact'; delta: number; max: number }
  | { op: 'hitDie'; die: string; delta: number; max: number }
  | { op: 'resource'; key: string; delta: number; max: number }
  | { op: 'deathSave'; kind: 'success' | 'failure'; delta: number }
  | { op: 'item'; itemId: string; delta: number }
  | { op: 'inspiration'; set: boolean }
  | { op: 'condition'; name: string; set: boolean }
  | { op: 'concentration'; set: string | null }

export type { CustomResource }
