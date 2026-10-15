import type { DiceRoll, RollAttempt, RollTerm } from './api'

const MODE_LABELS = { normal: '', advantage: 'výhoda', disadvantage: 'nevýhoda' } as const

export const modeLabel = (mode: DiceRoll['mode']) => MODE_LABELS[mode]

/** "[12] + 7" nebo "[3, 5] + [2] − 1": co přesně na kostkách padlo. */
export function breakdown(attempt: RollAttempt): string {
  return attempt.terms
    .map((t: RollTerm, i) => {
      const body = t.rolls ? `[${t.rolls.join(', ')}]` : String(t.constant)
      const sign = t.sign < 0 ? '−' : '+'
      return i === 0 ? (t.sign < 0 ? `−${body}` : body) : `${sign} ${body}`
    })
    .join(' ')
}

/** Jednořádkový popis hodu pro toast a log: "1d20+7: 19 ([12] + 7)", u výhody oba hody. */
export function describeRoll(r: DiceRoll): string {
  const chosen = r.attempts[r.chosen]
  const parts = chosen ? breakdown(chosen) : ''
  const both = r.attempts.length > 1 ? ` · ${modeLabel(r.mode)}: ${r.attempts.map((a, i) => (i === r.chosen ? `${a.total}` : `(${a.total})`)).join(' / ')}` : ''
  return `${r.expression}${r.crit ? ' (kritický)' : ''} = ${r.total} (${parts})${both}`
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
  if (!/d/.test(dice)) return null
  return `${dice}${bonus > 0 ? `+${bonus}` : bonus < 0 ? `${bonus}` : ''}${extra.map((e) => `+${e.dice}`).join('')}`
}
