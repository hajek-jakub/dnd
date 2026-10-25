import type { DiceRoll, RollAttempt, RollTerm } from './api'

const MODE_LABELS = { normal: '', advantage: 'výhoda', disadvantage: 'nevýhoda' } as const

export const modeLabel = (mode: DiceRoll['mode']) => MODE_LABELS[mode]

const sum = (rolls: number[]) => rolls.reduce((a, b) => a + b, 0)
const diceName = (t: RollTerm) => `${t.count === 1 ? '' : t.count}d${t.sides}`

/** Jeden člen hodu srozumitelně: "d8: 5", "2d6: 3 + 4 = 7", "bonus +4", "krit: plná d8 = 8". */
export function termText(t: RollTerm): string {
  if (!t.rolls) return `${t.sign < 0 ? 'postih −' : 'bonus +'}${t.constant}`
  const minus = t.sign < 0 ? '−' : ''
  const value = t.rolls.length > 1 ? `${t.rolls.join(' + ')} = ${minus}${sum(t.rolls)}` : `${minus}${t.rolls[0]}`
  if (t.crit === 'max') return `krit: plná ${diceName(t)} = ${minus}${sum(t.rolls)}`
  if (t.crit === 'double') return `krit ${diceName(t)}: ${value}`
  if (t.crit === 'extra') return `krit navíc ${diceName(t)}: ${value}`
  return `${minus}${diceName(t)}: ${value}`
}

/** Co přesně padlo, člen po členu: "d20: 12 · bonus +7". */
export function breakdown(attempt: RollAttempt): string {
  return attempt.terms.map(termText).join(' · ')
}

/** Jednořádkový popis hodu pro toast a log: "1d8+4 · KRIT = 17 · d8: 5 · bonus +4 · krit: plná d8 = 8", u výhody i zahozený hod. */
export function describeRoll(r: DiceRoll): string {
  const chosen = r.attempts[r.chosen]
  const parts = chosen ? ` · ${breakdown(chosen)}` : ''
  const dropped = r.attempts.filter((_, i) => i !== r.chosen).map((a) => a.total)
  const both = dropped.length > 0 ? ` · ${modeLabel(r.mode)}, zahozeno ${dropped.join(', ')}` : ''
  return `${r.expression}${r.crit ? ' · KRIT' : ''} = ${r.total}${parts}${both}`
}

export function naturalNote(r: DiceRoll): 'crit' | 'fail' | null {
  return r.natural === 20 ? 'crit' : r.natural === 1 ? 'fail' : null
}

/** Výraz k20 s modifikátorem: d20(7) -> "1d20+7", d20(-1) -> "1d20-1", d20(0) -> "1d20". */
export function d20(modifier: number): string {
  return `1d20${modifier > 0 ? `+${modifier}` : modifier < 0 ? `${modifier}` : ''}`
}

/** Výraz zranění: kostka + bonus + doplňková zranění, např. "1d6+5+1d4". */
export function damageExpression(dice: string, bonus: number, extra: { dice: string }[] = []): string | null {
  // Bez kostky (nezbraňový útok se základním zraněním 1) se hází jen tehdy, když je co přidat (např. Hex).
  if (!/d/.test(dice) && extra.length === 0) return null
  return `${dice}${bonus > 0 ? `+${bonus}` : bonus < 0 ? `${bonus}` : ''}${extra.map((e) => `+${e.dice}`).join('')}`
}

/** Má výraz zranění aspoň jednu kostku? Pevné zranění („1“ u sovy) se nehází, jen se vypíše. */
export const hasDice = (expression: string): boolean => /d\d/i.test(expression)
