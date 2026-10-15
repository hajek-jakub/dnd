import { describe, expect, it } from 'vitest'
import type { ComputedSheet } from '@/engine'
import { availability, formatCost, parseCost, planSpend, slotsLeft, spendOps } from './cost'

function sheet(over: { ki?: number; pact?: { count: number; level: number; used: number } | null; slots?: { level: number; max: number; used: number }[] }): ComputedSheet {
  return {
    resources: [{ key: 'monk.ki', name: 'Ki', max: { value: 5 }, current: over.ki ?? 0 }],
    spellcasting: { pact: over.pact ?? null, slots: over.slots ?? [] },
  } as unknown as ComputedSheet
}

describe('parseCost', () => {
  it('rozpozná ki, slot a zdarma', () => {
    expect(parseCost('ki:2')).toEqual({ type: 'ki', n: 2 })
    expect(parseCost('slot:1')).toEqual({ type: 'slot', n: 1 })
    expect(parseCost('free')).toEqual({ type: 'free' })
    expect(parseCost('blbost')).toEqual({ type: 'free' })
    expect(parseCost(undefined)).toEqual({ type: 'free' })
  })
  it('popisky', () => {
    expect(formatCost('ki:1')).toBe('1 ki')
    expect(formatCost('slot:1')).toBe('slot 1+')
    expect(formatCost('free')).toBe('zdarma')
  })
})

describe('dostupnost ceny', () => {
  it('ki: stačí, nestačí, nic', () => {
    expect(availability({ type: 'ki', n: 2 }, sheet({ ki: 3 }))).toEqual({ ok: true, detail: 'zbývá 3 ki' })
    expect(availability({ type: 'ki', n: 2 }, sheet({ ki: 1 })).ok).toBe(false)
    expect(availability({ type: 'ki', n: 1 }, sheet({ ki: 0 })).detail).toBe('nemáš ki')
  })
  it('slot: pact + běžné sloty, jen dost vysoké', () => {
    const s = sheet({ pact: { count: 1, level: 1, used: 0 }, slots: [{ level: 1, max: 2, used: 1 }, { level: 2, max: 1, used: 0 }] })
    expect(slotsLeft(s, 1)).toBe(3)
    expect(slotsLeft(s, 2)).toBe(1) // pact slot je jen 1. úrovně
    expect(slotsLeft(s, 3)).toBe(0)
    expect(availability({ type: 'slot', n: 3 }, s).ok).toBe(false)
  })
  it('zdarma je vždy dostupné', () => {
    expect(availability({ type: 'free' }, sheet({})).ok).toBe(true)
  })
})

describe('spendOps', () => {
  it('ki odečte', () => {
    expect(spendOps({ type: 'ki', n: 1 }, sheet({ ki: 2 }))).toEqual([{ op: 'resource', key: 'monk.ki', delta: -1, max: 5 }])
    expect(spendOps({ type: 'ki', n: 1 }, sheet({ ki: 0 }))).toBeNull()
  })
  it('slot nejdřív z pactu, pak z nejnižšího běžného', () => {
    const both = sheet({ pact: { count: 2, level: 1, used: 0 }, slots: [{ level: 1, max: 2, used: 0 }] })
    expect(spendOps({ type: 'slot', n: 1 }, both)).toEqual([{ op: 'pact', delta: 1, max: 2 }])
    const empty = sheet({ pact: { count: 2, level: 1, used: 2 }, slots: [{ level: 1, max: 1, used: 1 }, { level: 2, max: 1, used: 0 }] })
    expect(spendOps({ type: 'slot', n: 1 }, empty)).toEqual([{ op: 'slot', level: 2, delta: 1, max: 1 }])
    expect(spendOps({ type: 'slot', n: 3 }, empty)).toBeNull()
  })
  it('zdarma nic neodečítá', () => {
    expect(spendOps({ type: 'free' }, sheet({ ki: 5 }))).toBeNull()
  })
})

describe('planSpend (víc cen najednou)', () => {
  it('ki se sčítá a sloty se platí jeden po druhém', () => {
    const s = sheet({ ki: 3, pact: { count: 1, level: 1, used: 0 }, slots: [{ level: 1, max: 1, used: 0 }] })
    const plan = planSpend([{ type: 'ki', n: 1 }, { type: 'ki', n: 1 }, { type: 'slot', n: 1 }, { type: 'slot', n: 1 }], s)
    expect(plan.ok).toBe(true)
    expect(plan.ops).toEqual([
      { op: 'resource', key: 'monk.ki', delta: -2, max: 5 },
      { op: 'pact', delta: 1, max: 1 },
      { op: 'slot', level: 1, delta: 1, max: 1 },
    ])
  })
  it('nezaplatí nic, když cokoli nestačí', () => {
    const s = sheet({ ki: 1, pact: { count: 1, level: 1, used: 0 } })
    expect(planSpend([{ type: 'ki', n: 2 }], s)).toMatchObject({ ok: false, ops: [] })
    expect(planSpend([{ type: 'slot', n: 1 }, { type: 'slot', n: 1 }], s)).toMatchObject({ ok: false, ops: [] })
    expect(planSpend([], s)).toEqual({ ok: true, detail: 'bez ceny', ops: [] })
  })
})
