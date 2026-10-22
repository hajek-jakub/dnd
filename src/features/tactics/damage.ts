/** Kostka nebo číslo: "1d8", "d6", "5". */
const TERM = /^(\d*d\d+|\d+)/

/**
 * Převede popis zranění z taktiky na výraz pro server. "1d8+5 + 1d4 fire" -> "1d8+5+1d4": zůstanou kostky a čísla, slova
 * (typ zranění) se zahodí. Vrací null, když v textu žádná kostka není.
 */
export function damageRoll(text: string): string | null {
  const terms: string[] = []
  for (const part of text.split(/(?=[+-])|\+/)) {
    const m = TERM.exec(part.replace(/\s+/g, '').replace(/^\+/, '').replace(/^-/, ''))
    if (!m) continue
    const neg = part.trim().startsWith('-')
    const term = m[1] ?? ''
    terms.push(`${neg && terms.length > 0 ? '-' : ''}${term.startsWith('d') ? `1${term}` : term}`)
  }
  const joined = terms.join('+').replace(/\+-/g, '-')
  return /d/.test(joined) ? joined : null
}

/** Výraz pro hod zranění: pole `roll`, jinak odvozené z `damage`. */
export function rollFor(item: { roll: string; damage?: string }): string | null {
  const explicit = item.roll.replace(/\s+/g, '')
  if (explicit) return explicit.replace(/(^|[+-])d(\d)/g, '$11d$2')
  return item.damage ? damageRoll(item.damage) : null
}

/** "d20+8" -> "1d20+8", "+8" -> "1d20+8", "d20-1" -> "1d20-1". */
export function toHitRoll(text: string): string | null {
  const t = text.replace(/\s+/g, '')
  if (!t) return null
  const m = /^(?:1?d20)?([+-]\d+)?$/.exec(t)
  if (m) return `1d20${m[1] ?? ''}`
  return null
}

/** Přídavky od tříd k zranění útoku: bonus z Rage (číslo) a kostky Sneak Attack, když jsou zapnuté. */
export interface ClassBonus {
  rage: number
  sneak: string | null
}

export const NO_CLASS_BONUS: ClassBonus = { rage: 0, sneak: null }

/** Zranění útoku s přídavky podle příznaků `rage` a `sneak` u položky taktik (např. "1d12+3" + Rage 2 -> "1d12+3+2"). */
export function withClassBonus(base: string, flags: { rage?: boolean; sneak?: boolean }, bonus: ClassBonus): string {
  return `${base}${flags.rage && bonus.rage > 0 ? `+${bonus.rage}` : ''}${flags.sneak && bonus.sneak ? `+${bonus.sneak}` : ''}`
}
