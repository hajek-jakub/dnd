import { describe, expect, it } from 'vitest'
import type { CharacterItem } from '@/features/sheet/types'
import { planRun } from './run'
import type { Tactic } from './types'

const base = { characterId: 'c', position: 0 }
const spear = {
  ...base,
  id: 'spear',
  kind: 'attack',
  title: 'Kopí',
  data: { actionType: 'action', toHit: 'd20+8', damage: '1d8+5 + 1d4 fire', roll: '1d8+5+1d4', range: '', usage: '', note: '', cost: 'free', hex: true, count: 2, ammo: '' },
} as Tactic
const flurry = {
  ...base,
  id: 'flurry',
  kind: 'ki',
  title: 'Flurry',
  data: { actionType: 'bonus', cost: 'ki:1', description: '', toHit: 'd20+7', damage: '1d6+4', roll: '1d6+4', count: 2, hex: true },
} as Tactic
const hex = {
  ...base,
  id: 'hex',
  kind: 'spell',
  title: 'Hex',
  data: { level: 1, actionType: 'bonus', range: '', duration: '', concentration: true, save: '', effect: '', roll: '', cost: 'slot:1', toHit: '', count: 1 },
} as Tactic
const crossbow = {
  ...base,
  id: 'xbow',
  kind: 'attack',
  title: 'Kuše',
  data: { actionType: 'action', toHit: 'd20+7', damage: '1d8+4', roll: '1d8+4', range: '', usage: '', note: '', cost: 'free', hex: true, count: 2, ammo: 'bolts' },
} as Tactic
const combo = (uses: { id: string; count: number }[]) =>
  ({ ...base, id: 'combo', kind: 'combo', title: 'Burst', data: { steps: [], expectedDamage: '', cost: 'free', highlight: true, description: '', uses } }) as Tactic
const bolts = (quantity: number) => ({ id: 'bolts', name: 'Crossbow bolt', quantity }) as CharacterItem
const all = [spear, flurry, hex, crossbow]

describe('planRun', () => {
  it('útok s count 2 hodí dvakrát zásah i zranění', () => {
    const plan = planRun(spear, all, [], null)
    expect(plan.attacks).toEqual([
      { label: 'Kopí #1', toHit: '1d20+8', damage: '1d8+5+1d4' },
      { label: 'Kopí #2', toHit: '1d20+8', damage: '1d8+5+1d4' },
    ])
    expect(plan.costs).toEqual([])
  })

  it('kombo: 2× kopí a Flurry = 4 útoky, cena Flurry jednou, Hex se přidá ke zranění', () => {
    const plan = planRun(combo([{ id: 'spear', count: 2 }, { id: 'flurry', count: 2 }]), all, [], { name: 'Hex', dice: '1d6', type: 'Necrotic' })
    expect(plan.attacks).toHaveLength(4)
    expect(plan.attacks.map((a) => a.damage)).toEqual(['1d8+5+1d4+1d6', '1d8+5+1d4+1d6', '1d6+4+1d6', '1d6+4+1d6'])
    expect(plan.costs).toEqual([{ type: 'ki', n: 1 }])
  })

  it('seslání Hexu v kombu nastaví soustředění a bonus platí hned', () => {
    const plan = planRun(combo([{ id: 'hex', count: 1 }, { id: 'spear', count: 2 }]), all, [], null)
    expect(plan.concentration).toBe('Hex')
    expect(plan.costs).toEqual([{ type: 'slot', n: 1 }])
    expect(plan.attacks.map((a) => a.damage)).toEqual(['1d8+5+1d4+1d6', '1d8+5+1d4+1d6'])
  })

  it('munice se odečítá za každý útok a když nestačí, útoků je méně', () => {
    expect(planRun(crossbow, all, [bolts(10)], null).ammo).toEqual([{ itemId: 'bolts', name: 'Crossbow bolt', shots: 2 }])
    const short = planRun(crossbow, all, [bolts(1)], null)
    expect(short.attacks).toHaveLength(1)
    expect(short.warnings[0]).toContain('munice stačí jen na 1')
    const none = planRun(crossbow, all, [bolts(0)], null)
    expect(none.attacks).toHaveLength(0)
    expect(none.blocked).toContain('došla munice')
    expect(planRun(crossbow, all, [], null).blocked).toContain('chybí munice')
  })

  it('kouzlo bez hodů jen zaplatí cenu', () => {
    const plan = planRun(hex, all, [], null)
    expect(plan.attacks).toEqual([])
    expect(plan.costs).toEqual([{ type: 'slot', n: 1 }])
  })
})
