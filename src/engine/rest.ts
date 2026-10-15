import type { CharacterState, ComputedSheet } from './types'

/** Výchozí stav nové postavy: plné HP, žádné utracené zdroje. */
export function initialState(maxHp: number): CharacterState {
  return {
    hpCurrent: maxHp,
    hpTemp: 0,
    deathSuccesses: 0,
    deathFailures: 0,
    hitDiceUsed: {},
    slotsUsed: {},
    pactSlotsUsed: 0,
    resources: {},
    conditions: [],
  }
}

/** Utratí jednu hit die při short restu: vyléčí hozenou hodnotu + modifikátor CON (aspoň 0), nejvýše do maxima. */
export function spendHitDie(state: CharacterState, sheet: ComputedSheet, die: string, roll: number): CharacterState {
  const pool = sheet.hitDice.find((d) => d.die === die)
  if (!pool || pool.remaining <= 0) throw new Error(`Nemáš žádnou volnou kostku ${die}`)
  const heal = Math.max(0, roll + sheet.abilities.con.modifier)
  return {
    ...state,
    hpCurrent: Math.min(sheet.hp.max.value, state.hpCurrent + heal),
    hitDiceUsed: { ...state.hitDiceUsed, [die]: (state.hitDiceUsed[die] ?? 0) + 1 },
  }
}

/** Short rest: obnoví zdroje s obnovou "short" a pact magic sloty. */
export function shortRest(state: CharacterState, sheet: ComputedSheet): CharacterState {
  const resources = { ...state.resources }
  for (const r of sheet.resources) {
    if (r.recharge === 'short') resources[r.key] = r.max.value
  }
  return { ...state, resources, pactSlotsUsed: 0 }
}

/** Long rest: plné HP, všechny sloty a zdroje (kromě ručních), polovina hit dice (aspoň 1), reset death saves. */
export function longRest(state: CharacterState, sheet: ComputedSheet): CharacterState {
  const resources = { ...state.resources }
  for (const r of sheet.resources) {
    if (r.recharge !== 'manual') resources[r.key] = r.max.value
  }
  let regain = Math.max(1, Math.floor(sheet.hitDice.reduce((n, d) => n + d.total, 0) / 2))
  const hitDiceUsed = { ...state.hitDiceUsed }
  // Nejdřív se vrací největší kostky.
  for (const d of sheet.hitDice) {
    const back = Math.min(regain, hitDiceUsed[d.die] ?? 0)
    if (back > 0) hitDiceUsed[d.die] = (hitDiceUsed[d.die] ?? 0) - back
    regain -= back
  }
  return {
    ...state,
    hpCurrent: sheet.hp.max.value,
    hpTemp: 0,
    deathSuccesses: 0,
    deathFailures: 0,
    hitDiceUsed,
    slotsUsed: {},
    pactSlotsUsed: 0,
    resources,
  }
}

/** Úsvit: obnoví jen zdroje s obnovou "dawn" (např. některé magické předměty). */
export function dawn(state: CharacterState, sheet: ComputedSheet): CharacterState {
  const resources = { ...state.resources }
  for (const r of sheet.resources) {
    if (r.recharge === 'dawn') resources[r.key] = r.max.value
  }
  return { ...state, resources }
}
