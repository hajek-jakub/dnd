import type { ComputedSheet } from '@/engine'
import type { AdjustOp } from '@/features/sheet/types'

/** Cena položky: "free", "ki:N" nebo "slot:N" (stejný formát hlídá server). */
export type Cost = { type: 'free' } | { type: 'ki'; n: number } | { type: 'slot'; n: number }

export function parseCost(raw: string | undefined | null): Cost {
  const m = /^(ki|slot):([1-9][0-9]?)$/.exec(raw ?? '')
  if (!m) return { type: 'free' }
  return { type: m[1] as 'ki' | 'slot', n: Number(m[2]) }
}

export function formatCost(raw: string): string {
  const c = parseCost(raw)
  if (c.type === 'ki') return `${c.n} ki`
  if (c.type === 'slot') return `slot ${c.n}${c.n < 9 ? '+' : ''}`
  return 'zdarma'
}

const KI_KEY = 'monk.ki'

export function kiState(sheet: ComputedSheet): { current: number; max: number } | null {
  const r = sheet.resources.find((x) => x.key === KI_KEY)
  return r ? { current: r.current, max: r.max.value } : null
}

/** Zbývající sloty úrovně `n` a výš: pact sloty (pokud jsou dost vysoké) a běžné sloty dohromady. */
export function slotsLeft(sheet: ComputedSheet, n: number): number {
  const { pact, slots } = sheet.spellcasting
  const fromPact = pact && pact.level >= n ? Math.max(0, pact.count - pact.used) : 0
  return fromPact + slots.filter((s) => s.level >= n).reduce((sum, s) => sum + Math.max(0, s.max - s.used), 0)
}

export interface Availability {
  ok: boolean
  /** Krátký popis stavu pro čtečky a tooltip, např. "zbývá 2 ki" nebo "není ki". */
  detail: string
}

export function availability(cost: Cost, sheet: ComputedSheet): Availability {
  if (cost.type === 'free') return { ok: true, detail: 'bez ceny' }
  if (cost.type === 'ki') {
    const ki = kiState(sheet)
    const left = ki?.current ?? 0
    return left >= cost.n ? { ok: true, detail: `zbývá ${left} ki` } : { ok: false, detail: left === 0 ? 'nemáš ki' : `málo ki (zbývá ${left})` }
  }
  const left = slotsLeft(sheet, cost.n)
  return left > 0 ? { ok: true, detail: `zbývá ${left} ${left === 1 ? 'slot' : left < 5 ? 'sloty' : 'slotů'}` } : { ok: false, detail: `nemáš slot ${cost.n}. úrovně` }
}

/** Úprava stavu, která cenu zaplatí. Slot bere z pact slotů (obnova na short rest), jinak z nejnižšího dost vysokého běžného slotu. */
export function spendOps(cost: Cost, sheet: ComputedSheet): AdjustOp[] | null {
  if (cost.type === 'free' || !availability(cost, sheet).ok) return null
  if (cost.type === 'ki') {
    const ki = kiState(sheet)
    return ki ? [{ op: 'resource', key: KI_KEY, delta: -cost.n, max: ki.max }] : null
  }
  const { pact, slots } = sheet.spellcasting
  if (pact && pact.level >= cost.n && pact.used < pact.count) return [{ op: 'pact', delta: 1, max: pact.count }]
  const slot = slots.filter((s) => s.level >= cost.n && s.used < s.max).sort((a, b) => a.level - b.level)[0]
  return slot ? [{ op: 'slot', level: slot.level, delta: 1, max: slot.max }] : null
}

export interface SpendPlan {
  ok: boolean
  /** proč to nejde (nebo co zbude), pro tooltip a čtečky */
  detail: string
  ops: AdjustOp[]
}

/**
 * Zaplatí víc cen najednou (kombo: Flurry za ki + Hex za slot). Ki se sčítá, sloty se platí jeden po druhém:
 * největší nároky první, nejdřív z pact slotů (obnova na short rest), jinak z nejnižšího dost vysokého běžného slotu.
 * Nezaplatí se nic, když nestačí cokoli z toho.
 */
export function planSpend(costs: Cost[], sheet: ComputedSheet): SpendPlan {
  const ki = costs.reduce((n, c) => (c.type === 'ki' ? n + c.n : n), 0)
  const kiHave = kiState(sheet)
  if (ki > 0 && (kiHave?.current ?? 0) < ki) return { ok: false, detail: (kiHave?.current ?? 0) === 0 ? 'nemáš ki' : `málo ki (potřeba ${ki}, zbývá ${kiHave?.current ?? 0})`, ops: [] }

  const { pact, slots } = sheet.spellcasting
  let pactLeft = pact ? pact.count - pact.used : 0
  const regularLeft = new Map(slots.map((s) => [s.level, s.max - s.used]))
  let pactUsed = 0
  const regularUsed = new Map<number, number>()
  const slotCosts = costs.flatMap((c) => (c.type === 'slot' ? [c.n] : [])).sort((a, b) => b - a)
  for (const n of slotCosts) {
    if (pact && pact.level >= n && pactLeft > 0) {
      pactLeft--
      pactUsed++
      continue
    }
    const level = [...regularLeft.keys()].filter((l) => l >= n && (regularLeft.get(l) ?? 0) > 0).sort((a, b) => a - b)[0]
    if (level === undefined) return { ok: false, detail: `nemáš slot ${n}. úrovně`, ops: [] }
    regularLeft.set(level, (regularLeft.get(level) ?? 0) - 1)
    regularUsed.set(level, (regularUsed.get(level) ?? 0) + 1)
  }

  const ops: AdjustOp[] = []
  if (ki > 0 && kiHave) ops.push({ op: 'resource', key: KI_KEY, delta: -ki, max: kiHave.max })
  if (pactUsed > 0 && pact) ops.push({ op: 'pact', delta: pactUsed, max: pact.count })
  for (const [level, n] of regularUsed) {
    const slot = slots.find((x) => x.level === level)
    if (slot) ops.push({ op: 'slot', level, delta: n, max: slot.max })
  }
  return { ok: true, detail: ops.length === 0 ? 'bez ceny' : 'cena je k dispozici', ops }
}

export function stringifyCost(c: Cost): string {
  return c.type === 'free' ? 'free' : `${c.type}:${c.n}`
}
