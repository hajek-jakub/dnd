import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { AbilityKey } from './abilities'
import { buildRulesBundle, type RawClass, type RawLevel, type RulesBundle } from './rules-bundle'
import { initialState } from './rest'
import type { CharacterInput, InventoryItem } from './types'

const DATA = path.resolve(import.meta.dirname, '../../api/data/srd51')

function load<T>(name: string): T[] {
  return JSON.parse(readFileSync(path.join(DATA, `5e-SRD-${name}.json`), 'utf8')) as T[]
}

/** Pravidla z opravdových SRD dat (stejná, jaká API vrací enginu). */
export function loadBundle(): RulesBundle {
  const classes = load<{ index: string; name: string } & RawClass['data']>('Classes').map((c) => ({ idx: c.index, name: c.name, data: c }))
  const levels = load<{ index: string; level: number; class: { name: string } } & RawLevel['data']>('Levels').map((l) => ({
    idx: l.index,
    name: `${l.class.name} ${l.level}`,
    level: l.level,
    category: l.class.name,
    data: l,
  }))
  return buildRulesBundle(classes as RawClass[], levels as RawLevel[])
}

export function levelsOf(...parts: [string, number][]): CharacterInput['levels'] {
  return parts.flatMap(([classIndex, n]) => Array.from({ length: n }, () => ({ classIndex, hpRoll: null })))
}

export function makeInput(partial: Partial<CharacterInput> & { scores?: Partial<Record<AbilityKey, number>> } = {}): CharacterInput {
  const { scores, ...rest } = partial
  const abilityScores = { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10, ...scores }
  return {
    abilityScores,
    levels: levelsOf(['fighter', 1]),
    subclasses: {},
    baseSpeed: 30,
    skillProficiencies: {},
    extraSaveProficiencies: [],
    extraProficiencies: [],
    items: [],
    effects: [],
    overrides: {},
    customResources: [],
    state: initialState(10),
    ...rest,
  }
}

export function item(partial: Partial<InventoryItem> & Pick<InventoryItem, 'id' | 'name' | 'kind'>): InventoryItem {
  return {
    quantity: 1,
    weight: 1,
    equipped: true,
    attuned: false,
    requiresAttunement: false,
    effects: [],
    ...partial,
  }
}
