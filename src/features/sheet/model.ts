import { computeSheet, type CharacterInput, type ComputedSheet, type InventoryItem, type RulesBundle } from '@/engine'
import type { AdjustOp, CharacterFull, CharacterItem, CharacterState } from './types'

function toInventoryItem(i: CharacterItem): InventoryItem {
  return {
    id: i.id,
    name: i.name,
    // Engine zná jen zbraně, zbroje a štíty; ostatní druhy (hole, lektvary…) jsou pro něj běžný item.
    kind: i.kind === 'weapon' || i.kind === 'armor' || i.kind === 'shield' ? i.kind : 'item',
    quantity: i.quantity,
    equipped: i.equipped,
    attuned: i.attuned,
    requiresAttunement: i.requiresAttunement,
    armor: i.armor ?? undefined,
    weapon: i.weapon ?? undefined,
    effects: i.effects,
  }
}

/** Převede sheet z API na vstup enginu. `rules` jsou pravidla kampaně (např. nosnost). */
export function toEngineInput(c: CharacterFull, rules?: CharacterInput['rules']): CharacterInput {
  return {
    abilityScores: c.abilityScores,
    levels: c.levels.map((l) => ({ classIndex: l.classIndex, hpRoll: l.hpRoll })),
    subclasses: c.subclasses,
    baseSpeed: c.baseSpeed,
    skillProficiencies: c.skillProficiencies,
    extraSaveProficiencies: c.extraSaveProficiencies,
    extraProficiencies: c.extraProficiencies,
    items: (c.items ?? []).map(toInventoryItem),
    effects: (c.effects ?? []).map((e) => ({ target: e.target, value: e.value, source: e.source })),
    overrides: c.overrides,
    customResources: c.customResources,
    state: { ...c.state, hpCurrent: c.state.hpCurrent ?? Number.MAX_SAFE_INTEGER },
    rules,
  }
}

export interface DerivedSheet {
  sheet: ComputedSheet
  /** Aktuální HP včetně výchozího "plné HP" u nové postavy. */
  hpCurrent: number
}

export function deriveSheet(c: CharacterFull, bundle: RulesBundle, rules?: CharacterInput['rules']): DerivedSheet {
  const sheet = computeSheet(toEngineInput(c, rules), bundle)
  const hpCurrent = Math.min(c.state.hpCurrent ?? sheet.hp.max.value, sheet.hp.max.value)
  return { sheet, hpCurrent }
}

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n))

/**
 * Lokální (optimistická) verze úprav stavu, stejná pravidla jako na serveru (CharacterController::adjust).
 * Díky tomu se klik na −1 HP projeví hned, bez čekání na server.
 */
export function applyOps(
  state: CharacterState,
  ops: AdjustOp[],
  extras: { inspiration: boolean },
): { state: CharacterState; inspiration: boolean } {
  let s: CharacterState = {
    ...state,
    hitDiceUsed: { ...state.hitDiceUsed },
    slotsUsed: { ...state.slotsUsed },
    resources: { ...state.resources },
    conditions: [...state.conditions],
  }
  let { inspiration } = extras
  for (const op of ops) {
    switch (op.op) {
      case 'hp': {
        let hp = s.hpCurrent ?? op.max
        let temp = s.hpTemp
        let delta = op.delta
        if (delta < 0) {
          const absorbed = Math.min(temp, -delta)
          temp -= absorbed
          delta += absorbed
        }
        hp = clamp(hp + delta, 0, op.max)
        s = { ...s, hpCurrent: hp, hpTemp: temp }
        break
      }
      case 'tempHp':
        s = { ...s, hpTemp: Math.max(0, op.set) }
        break
      case 'slot':
        s.slotsUsed[String(op.level)] = clamp((s.slotsUsed[String(op.level)] ?? 0) + op.delta, 0, op.max)
        break
      case 'pact':
        s = { ...s, pactSlotsUsed: clamp(s.pactSlotsUsed + op.delta, 0, op.max) }
        break
      case 'hitDie':
        s.hitDiceUsed[op.die] = clamp((s.hitDiceUsed[op.die] ?? 0) + op.delta, 0, op.max)
        break
      case 'resource':
        s.resources[op.key] = clamp((s.resources[op.key] ?? op.max) + op.delta, 0, op.max)
        break
      case 'deathSave':
        s =
          op.kind === 'success'
            ? { ...s, deathSuccesses: clamp(s.deathSuccesses + op.delta, 0, 3) }
            : { ...s, deathFailures: clamp(s.deathFailures + op.delta, 0, 3) }
        break
      case 'item':
        break // množství itemů se mění na serveru, klient po odpovědi načte postavu znovu
      case 'inspiration':
        inspiration = op.set
        break
      case 'condition':
        s = { ...s, conditions: s.conditions.filter((c) => c !== op.name) }
        if (op.set) s.conditions = [...s.conditions, op.name]
        break
      case 'concentration':
        s = { ...s, concentration: op.set === '' ? null : op.set }
        break
    }
  }
  return { state: s, inspiration }
}
