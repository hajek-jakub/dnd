import type { AbilityKey, SkillKey } from './abilities'

/** Hodnota z enginu: výsledek výpočtu, případně ručně přepsaná, vždy s původem (z čeho se skládá). */
export interface Computed<T = number> {
  value: T
  /** Hodnota podle pravidel (bez přepsání). */
  base: T
  overridden: boolean
  /** Rozpis, ze kterých částí se hodnota skládá (viditelné hráči). */
  sources: { label: string; value: number | string }[]
}

/** Bonus nebo malus od DM, z itemu nebo z featury. */
export interface Effect {
  /**
   * Cíl: 'ac', 'speed', 'initiative', 'hp.max', 'hp.perLevel', 'proficiency', 'passive.perception',
   * 'ability.str', 'save.all', 'save.dex', 'skill.all', 'skill.stealth', 'attack.all', 'attack.melee', 'attack.ranged',
   * 'damage.all', 'spell.dc', 'spell.attack'.
   */
  target: string
  value: number
  source: string
}

export interface ArmorStats {
  /** Základní AC (např. 11 pro Leather, 18 pro Plate); u štítu bonus (+2). */
  base: number
  dexBonus: boolean
  maxDexBonus: number | null
  /** Magický bonus (+1 zbroj). */
  magicBonus?: number
  stealthDisadvantage?: boolean
  strMinimum?: number
}

export interface WeaponStats {
  damageDice: string
  damageType: string
  category: 'simple' | 'martial'
  range: 'melee' | 'ranged'
  properties: string[]
  magicBonus?: number
}

export interface InventoryItem {
  id: string
  name: string
  kind: 'armor' | 'shield' | 'weapon' | 'item'
  quantity: number
  weight: number
  equipped: boolean
  attuned: boolean
  requiresAttunement: boolean
  armor?: ArmorStats
  weapon?: WeaponStats
  effects: Effect[]
}

export interface LevelEntry {
  classIndex: string
  /** Hozený hit die při tomto levelu; null = průměr. První level vždy plný die. */
  hpRoll: number | null
}

export interface CharacterState {
  hpCurrent: number
  hpTemp: number
  deathSuccesses: number
  deathFailures: number
  /** Utracené hit dice podle velikosti kostky: { d8: 2 }. */
  hitDiceUsed: Record<string, number>
  /** Utracené sloty podle úrovně slotu. */
  slotsUsed: Record<string, number>
  pactSlotsUsed: number
  /** Aktuální hodnoty zdrojů (ki, rage, ...) podle klíče. Chybějící klíč = plný zdroj. */
  resources: Record<string, number>
  conditions: string[]
}

export interface CharacterInput {
  abilityScores: Record<AbilityKey, number>
  /** Každý získaný level v pořadí (první záznam = výchozí třída). */
  levels: LevelEntry[]
  subclasses: Record<string, string>
  baseSpeed: number
  skillProficiencies: Partial<Record<SkillKey, 0 | 1 | 2>>
  extraSaveProficiencies: AbilityKey[]
  /** Jména proficiencies navíc (např. z rasy nebo backgroundu): 'Light Armor', 'Longswords', ... */
  extraProficiencies: string[]
  items: InventoryItem[]
  effects: Effect[]
  /** Ruční přepisy: klíč -> hodnota (viz Computed). */
  overrides: Record<string, number>
  /** Vlastní zdroje hráče (ne z třídy). */
  customResources: CustomResource[]
  state: CharacterState
}

export type Recharge = 'short' | 'long' | 'dawn' | 'manual'

export interface CustomResource {
  key: string
  name: string
  max: number
  recharge: Recharge
}

export interface ResourceInfo {
  key: string
  name: string
  max: Computed
  current: number
  recharge: Recharge
  source: string
  custom: boolean
}

export interface SpellcastingClassInfo {
  classIndex: string
  className: string
  ability: AbilityKey
  saveDc: Computed
  attackBonus: Computed
  cantripsKnown: number | null
  spellsKnown: number | null
  /** Maximální počet připravených kouzel (cleric, druid, paladin, wizard), jinak null. */
  preparedMax: number | null
}

export interface SlotInfo {
  level: number
  max: number
  used: number
}

export interface AttackInfo {
  id: string
  name: string
  toHit: Computed
  damageDice: string
  damageBonus: Computed
  damageType: string
  ability: AbilityKey
  proficient: boolean
  notes: string[]
}

export interface ComputedSheet {
  totalLevel: number
  classSummary: string
  proficiencyBonus: Computed
  abilities: Record<AbilityKey, { score: Computed; modifier: number }>
  saves: Record<AbilityKey, Computed & { proficient: boolean }>
  skills: Record<SkillKey, Computed & { proficiency: 0 | 1 | 2; ability: AbilityKey }>
  passivePerception: Computed
  initiative: Computed
  speed: Computed
  ac: Computed
  hp: { max: Computed; current: number; temp: number }
  hitDice: { die: string; total: number; used: number; remaining: number }[]
  attacks: AttackInfo[]
  attacksPerAction: number
  spellcasting: {
    classes: SpellcastingClassInfo[]
    casterLevel: number
    slots: SlotInfo[]
    pact: { count: number; level: number; used: number } | null
  }
  resources: ResourceInfo[]
  features: { name: string; className: string; level: number; source: 'class' | 'subclass' }[]
  martialArtsDie: string | null
  attunement: { used: number; max: number }
  carryingCapacity: number
  weightCarried: number
  proficiencies: string[]
}
