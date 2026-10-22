// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { computeSheet, longRest, riderApplies, shortRest } from './index'
import { item, levelsOf, loadBundle, makeInput } from './test-helpers'

const bundle = loadBundle()

const greataxe = item({
  id: 'axe',
  name: 'Greataxe',
  kind: 'weapon',
  weapon: { damageDice: '1d12', damageType: 'Slashing', category: 'martial', range: 'melee', properties: ['heavy', 'two-handed'] },
})
const rapier = item({
  id: 'rapier',
  name: 'Rapier',
  kind: 'weapon',
  weapon: { damageDice: '1d8', damageType: 'Piercing', category: 'martial', range: 'melee', properties: ['finesse'] },
})
const shortbow = item({
  id: 'bow',
  name: 'Shortbow',
  kind: 'weapon',
  weapon: { damageDice: '1d6', damageType: 'Piercing', category: 'simple', range: 'ranged', properties: ['two-handed'] },
})

function barbarian(level: number, conditions: string[] = [], items = [greataxe]) {
  const base = makeInput({ scores: { str: 16, con: 14 }, levels: levelsOf(['barbarian', level]), items })
  return { ...base, state: { ...base.state, conditions } }
}

describe('Rage', () => {
  it('bez Rage se bonus ke zranění nepřidá', () => {
    const sheet = computeSheet(barbarian(5), bundle)
    expect(sheet.attacks.find((a) => a.id === 'axe')?.damageBonus.value).toBe(3)
    expect(sheet.rage).toMatchObject({ active: false, damageBonus: 2, resourceKey: 'barbarian.rage', usesLeft: 3, usesMax: 3 })
  })

  it('při Rage přidá +2 (level 1 až 8) ke zranění zbraní zblízka na STR a ukáže zdroj', () => {
    const sheet = computeSheet(barbarian(5, ['Raging']), bundle)
    const axe = sheet.attacks.find((a) => a.id === 'axe')!
    expect(axe.damageBonus.value).toBe(3 + 2)
    expect(axe.damageBonus.sources).toContainEqual({ label: 'Rage', value: '+2' })
    expect(sheet.rage?.active).toBe(true)
    // Unarmed Strike na STR také
    expect(sheet.attacks.find((a) => a.id === 'unarmed')?.damageBonus.value).toBe(3 + 2)
  })

  it('bonus roste s levelem barbara (+3 od 9., +4 od 16.)', () => {
    expect(computeSheet(barbarian(9, ['Raging']), bundle).attacks.find((a) => a.id === 'axe')?.damageBonus.value).toBe(3 + 3)
    expect(computeSheet(barbarian(16, ['Raging']), bundle).attacks.find((a) => a.id === 'axe')?.damageBonus.value).toBe(3 + 4)
  })

  it('nepřidá se k dálkové zbrani ani ke zbrani, u které vychází lépe DEX (Finesse)', () => {
    const base = makeInput({ scores: { str: 10, dex: 16 }, levels: levelsOf(['barbarian', 5]), items: [rapier, shortbow] })
    const input = { ...base, state: { ...base.state, conditions: ['Raging'] } }
    const sheet = computeSheet(input, bundle)
    expect(sheet.attacks.find((a) => a.id === 'rapier')).toMatchObject({ ability: 'dex' })
    expect(sheet.attacks.find((a) => a.id === 'rapier')?.damageBonus.value).toBe(3)
    expect(sheet.attacks.find((a) => a.id === 'bow')?.damageBonus.value).toBe(3)
  })

  it('Rage nemá význam bez třídy barbar (stav jen jako štítek)', () => {
    const base = makeInput({ scores: { str: 16 }, levels: levelsOf(['fighter', 5]), items: [greataxe] })
    const input = { ...base, state: { ...base.state, conditions: ['Raging'] } }
    const sheet = computeSheet(input, bundle)
    expect(sheet.rage).toBeNull()
    expect(sheet.attacks.find((a) => a.id === 'axe')?.damageBonus.value).toBe(3)
  })

  it('ruční přepis zranění Rage přebije', () => {
    const input = { ...barbarian(5, ['Raging']), overrides: { 'attack.axe.damage': 9 } }
    expect(computeSheet(input, bundle).attacks.find((a) => a.id === 'axe')?.damageBonus.value).toBe(9)
  })

  it('Rage dává výhodu na záchranný hod STR a popis dopadu', () => {
    const sheet = computeSheet(barbarian(5, ['Raging']), bundle)
    expect(sheet.conditions.saves.str).toMatchObject({ mode: 'advantage', sources: ['Raging'] })
    expect(sheet.conditions.saves.dex.mode).toBe('normal')
    expect(sheet.conditions.impacts.some((i) => i.condition === 'Raging')).toBe(true)
  })

  it('short i long rest Rage ukončí', () => {
    const input = barbarian(5, ['Raging', 'Poisoned'])
    const sheet = computeSheet(input, bundle)
    expect(shortRest(input.state, sheet).conditions).toEqual(['Poisoned'])
    expect(longRest(input.state, sheet).conditions).toEqual(['Poisoned'])
  })
})

describe('přídavky ke zranění od tříd', () => {
  const rogue = (level: number) => computeSheet(makeInput({ scores: { dex: 16 }, levels: levelsOf(['rogue', level]), items: [rapier, shortbow, greataxe] }), bundle)

  it('Sneak Attack podle levelu rogue (1d6, 2d6 od 3., 5d6 od 9.)', () => {
    expect(rogue(1).damageRiders).toMatchObject([{ id: 'sneak-attack', dice: '1d6', mode: 'toggle' }])
    expect(rogue(3).damageRiders[0]?.dice).toBe('2d6')
    expect(rogue(9).damageRiders[0]?.dice).toBe('5d6')
    expect(rogue(20).damageRiders[0]?.dice).toBe('10d6')
  })

  it('Sneak Attack platí jen pro Finesse a dálkové zbraně, ne pro Unarmed Strike ani těžkou zbraň', () => {
    const sheet = rogue(5)
    const sneak = sheet.damageRiders[0]!
    const applies = (id: string) => riderApplies(sneak, sheet.attacks.find((a) => a.id === id)!)
    expect(applies('rapier')).toBe(true)
    expect(applies('bow')).toBe(true)
    expect(applies('axe')).toBe(false)
    expect(applies('unarmed')).toBe(false)
  })

  it('ostatní třídy nemají Sneak Attack a postava bez přídavků má prázdný seznam', () => {
    expect(computeSheet(makeInput({ levels: levelsOf(['fighter', 5]) }), bundle).damageRiders).toEqual([])
    expect(computeSheet(makeInput({ levels: levelsOf(['barbarian', 5]) }), bundle).damageRiders).toEqual([])
  })

  it('multiclass: rogue 3 / fighter 2 dá Sneak Attack podle levelu rogue', () => {
    const sheet = computeSheet(makeInput({ levels: levelsOf(['fighter', 2], ['rogue', 3]) }), bundle)
    expect(sheet.damageRiders[0]?.dice).toBe('2d6')
  })

  it('Improved Divine Smite od 11. levelu paladina: 1d8 radiant ke každému zásahu zblízka', () => {
    const paladin = (level: number) => computeSheet(makeInput({ scores: { str: 16 }, levels: levelsOf(['paladin', level]), items: [greataxe, shortbow] }), bundle)
    expect(paladin(10).damageRiders).toEqual([])
    const sheet = paladin(11)
    expect(sheet.damageRiders).toMatchObject([{ id: 'improved-divine-smite', dice: '1d8', type: 'Radiant', mode: 'always' }])
    const smite = sheet.damageRiders[0]!
    expect(riderApplies(smite, sheet.attacks.find((a) => a.id === 'axe')!)).toBe(true)
    expect(riderApplies(smite, sheet.attacks.find((a) => a.id === 'bow')!)).toBe(false)
    expect(riderApplies(smite, sheet.attacks.find((a) => a.id === 'unarmed')!)).toBe(false)
  })

  it('Colossus Slayer jen u Hunter rangera od 3. levelu', () => {
    const ranger = (subclasses: Record<string, string>, level: number) =>
      computeSheet(makeInput({ levels: levelsOf(['ranger', level]), subclasses }), bundle)
    expect(ranger({ ranger: 'hunter' }, 3).damageRiders).toMatchObject([{ id: 'colossus-slayer', dice: '1d8' }])
    expect(ranger({ ranger: 'hunter' }, 2).damageRiders).toEqual([])
    expect(ranger({}, 5).damageRiders).toEqual([])
  })
})
