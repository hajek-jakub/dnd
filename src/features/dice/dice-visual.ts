/** Tvary kostek (viewBox 0 0 100 100) a pomocné funkce pro animaci hodu. */

export const DIE_SHAPES: Record<number, string> = {
  4: '50,6 95,88 5,88',
  8: '50,3 93,50 50,97 7,50',
  10: '50,4 92,40 76,94 24,94 8,40',
  12: '50,4 95,37 78,92 22,92 5,37',
  20: '50,3 91,26 91,74 50,97 9,74 9,26',
}

/** Vnitřní hrany, ať kostka vypadá jako mnohostěn (jen pro d20 a d12). */
export const DIE_EDGES: Record<number, string> = {
  20: '50,26 76,70 24,70',
  12: '50,30 70,45 62,70 38,70 30,45',
}

/** Kolik kostek se kreslí najednou; víc se jen spočítá ("+ 80 dalších"). */
export const MAX_VISIBLE_DICE = 18

export interface PlaceholderDie {
  sides: number
  sign: 1 | -1
}

/** Kostky z výrazu ještě před odpovědí serveru, aby se mohly hned točit ("2d6+3" → dvě šestistěnky). */
export function placeholderDice(expression: string, crit = false, limit = 8): { dice: PlaceholderDie[]; more: number } {
  const dice: PlaceholderDie[] = []
  let more = 0
  for (const m of expression.toLowerCase().replace(/\s+/g, '').matchAll(/([+-]?)(\d*)d(\d+)/g)) {
    const count = (m[2] === '' ? 1 : Number(m[2])) * (crit ? 2 : 1)
    for (let i = 0; i < count; i++) {
      if (dice.length < limit) dice.push({ sides: Number(m[3]), sign: m[1] === '-' ? -1 : 1 })
      else more++
    }
  }
  return { dice, more }
}

export function randomFace(sides: number): number {
  return 1 + Math.floor(Math.random() * Math.max(2, sides))
}

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
}
