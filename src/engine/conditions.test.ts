// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { combineMode, computeSheet, conditionEffects, exhaustionLevel, parseCondition } from './index'
import { levelsOf, loadBundle, makeInput } from './test-helpers'

const bundle = loadBundle()

function withConditions(conditions: string[], ruleset?: '2014' | '2024') {
  const base = makeInput({
    scores: { str: 14, dex: 14, con: 14 },
    levels: levelsOf(['fighter', 5]),
    skillProficiencies: { perception: 1 },
    ...(ruleset ? { rules: { ruleset } } : {}),
  })
  return { ...base, state: { ...base.state, conditions } }
}

describe('stavy: rozbor názvu', () => {
  it('rozpozná úroveň vyčerpání', () => {
    expect(parseCondition('Exhaustion 3')).toEqual({ key: 'exhaustion', level: 3 })
    expect(parseCondition(' exhaustion ')).toEqual({ key: 'exhaustion', level: 1 })
    expect(parseCondition('Exhaustion 9').level).toBe(6)
    expect(parseCondition('Poisoned')).toEqual({ key: 'poisoned', level: null })
    expect(exhaustionLevel(['Poisoned'])).toBe(0)
    expect(exhaustionLevel(['Poisoned', 'Exhaustion 4'])).toBe(4)
  })
})

describe('stavy: výhoda a nevýhoda', () => {
  it('bez stavů je vše normální', () => {
    const c = conditionEffects([])
    expect(c.attack.mode).toBe('normal')
    expect(c.check.mode).toBe('normal')
    expect(c.impacts).toEqual([])
  })

  it('Poisoned: nevýhoda na útoky a zkoušky, ne na záchranné hody', () => {
    const c = conditionEffects(['Poisoned'])
    expect(c.attack).toEqual({ mode: 'disadvantage', sources: ['Poisoned'] })
    expect(c.check.mode).toBe('disadvantage')
    expect(c.saves.con.mode).toBe('normal')
    expect(c.impacts).toHaveLength(1)
  })

  it('Restrained: nevýhoda na DEX save, rychlost 0', () => {
    const c = conditionEffects(['Restrained'])
    expect(c.saves.dex.mode).toBe('disadvantage')
    expect(c.saves.str.mode).toBe('normal')
    expect(c.speedZero).toEqual(['Restrained'])
  })

  it('Paralyzed: automatický neúspěch STR a DEX, neschopnost jednat', () => {
    const c = conditionEffects(['Paralyzed'])
    expect(c.saves.str.autoFail).toEqual(['Paralyzed'])
    expect(c.saves.dex.autoFail).toEqual(['Paralyzed'])
    expect(c.saves.wis.autoFail).toEqual([])
    expect(c.incapacitated).toEqual(['Paralyzed'])
  })

  it('Invisible dá výhodu na útoky a s Poisoned se ruší', () => {
    expect(conditionEffects(['Invisible']).attack.mode).toBe('advantage')
    const both = conditionEffects(['Invisible', 'Poisoned'])
    expect(both.attack.mode).toBe('normal')
    expect(both.check.mode).toBe('disadvantage')
  })

  it('dva stejné zdroje nevýhody nejsou „dvojitá“ nevýhoda a duplicitní stav se počítá jednou', () => {
    const c = conditionEffects(['Poisoned', 'poisoned', 'Frightened'])
    expect(c.attack.mode).toBe('disadvantage')
    expect(c.impacts.map((i) => i.condition)).toEqual(['Poisoned', 'Frightened'])
  })

  it('neznámý vlastní stav nic nedělá', () => {
    const c = conditionEffects(['Hladový'])
    expect(c.impacts).toEqual([])
    expect(c.attack.mode).toBe('normal')
  })

  it('combineMode: výhoda a nevýhoda se ruší', () => {
    expect(combineMode('normal', 'disadvantage')).toBe('disadvantage')
    expect(combineMode('advantage', 'disadvantage')).toBe('normal')
    expect(combineMode('disadvantage', 'disadvantage')).toBe('disadvantage')
    expect(combineMode('advantage', 'normal')).toBe('advantage')
  })
})

describe('stavy: Exhaustion 2014 po úrovních', () => {
  it('úroveň 1: nevýhoda na zkoušky, nic jiného', () => {
    const c = conditionEffects(['Exhaustion 1'])
    expect(c.check.mode).toBe('disadvantage')
    expect(c.attack.mode).toBe('normal')
    expect(c.speedHalved).toEqual([])
  })

  it('úroveň 2: poloviční rychlost', () => {
    const base = computeSheet(withConditions([]), bundle).speed.value
    const sheet = computeSheet(withConditions(['Exhaustion 2']), bundle)
    expect(sheet.speed.value).toBe(Math.floor(base / 2))
    expect(sheet.speed.sources.some((s) => /poloviční/.test(s.label))).toBe(true)
  })

  it('úroveň 3: nevýhoda na útoky a všechny záchranné hody', () => {
    const c = conditionEffects(['Exhaustion 3'])
    expect(c.attack.mode).toBe('disadvantage')
    expect(c.saves.wis.mode).toBe('disadvantage')
    expect(c.saves.str.mode).toBe('disadvantage')
  })

  it('úroveň 4: poloviční maximum HP a aktuální HP se ořízne', () => {
    const full = computeSheet(withConditions([]), bundle)
    const input = withConditions(['Exhaustion 4'])
    const sheet = computeSheet({ ...input, state: { ...input.state, hpCurrent: full.hp.max.value } }, bundle)
    expect(sheet.hp.max.value).toBe(Math.floor(full.hp.max.value / 2))
    expect(sheet.hp.current).toBe(sheet.hp.max.value)
  })

  it('úroveň 5: rychlost 0', () => {
    expect(computeSheet(withConditions(['Exhaustion 5']), bundle).speed.value).toBe(0)
  })

  it('ruční přepis rychlosti stav přebije', () => {
    const input = { ...withConditions(['Grappled']), overrides: { speed: 25 } }
    expect(computeSheet(input, bundle).speed.value).toBe(25)
  })

  it('Grappled nastaví rychlost 0 a ukáže důvod', () => {
    const sheet = computeSheet(withConditions(['Grappled']), bundle)
    expect(sheet.speed.value).toBe(0)
    expect(sheet.speed.sources.at(-1)?.label).toMatch(/Grappled/)
    expect(sheet.conditions.impacts[0]?.condition).toBe('Grappled')
  })
})

describe('stavy: Exhaustion 2024', () => {
  it('−2 za úroveň na útok, dovednosti, záchranné hody, iniciativu a kouzla; −5 ft za úroveň', () => {
    const none = computeSheet(withConditions([], '2024'), bundle)
    const sheet = computeSheet(withConditions(['Exhaustion 3'], '2024'), bundle)
    expect(sheet.conditions.d20Penalty).toBe(6)
    expect(sheet.skills.athletics.value).toBe(none.skills.athletics.value - 6)
    expect(sheet.saves.con.value).toBe(none.saves.con.value - 6)
    expect(sheet.initiative.value).toBe(none.initiative.value - 6)
    expect(sheet.attacks[0]?.toHit.value).toBe((none.attacks[0]?.toHit.value ?? 0) - 6)
    expect(sheet.speed.value).toBe(none.speed.value - 15)
    // v 2024 žádná nevýhoda, jen číselný postih
    expect(sheet.conditions.attack.mode).toBe('normal')
    expect(sheet.hp.max.value).toBe(none.hp.max.value)
  })

  it('pasivní vnímání se neměnní (není to k20)', () => {
    const none = computeSheet(withConditions([], '2024'), bundle)
    const sheet = computeSheet(withConditions(['Exhaustion 2'], '2024'), bundle)
    expect(sheet.passivePerception.value).toBe(none.passivePerception.value)
  })

  it('rychlost nejde pod 0', () => {
    const input = { ...withConditions(['Exhaustion 6'], '2024'), baseSpeed: 10 }
    expect(computeSheet(input, bundle).speed.value).toBe(0)
  })
})
