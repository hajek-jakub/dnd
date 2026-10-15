import type { Currency } from './types'

export const COINS = ['pp', 'gp', 'ep', 'sp', 'cp'] as const
export type Coin = (typeof COINS)[number]

export const COIN_LABELS: Record<Coin, string> = {
  pp: 'Platinové (pp)',
  gp: 'Zlaté (gp)',
  ep: 'Electrum (ep)',
  sp: 'Stříbrné (sp)',
  cp: 'Měděné (cp)',
}

/** Hodnota mince v mědácích. */
export const COIN_VALUE: Record<Coin, number> = { cp: 1, sp: 10, ep: 50, gp: 100, pp: 1000 }

/**
 * Převede `amount` mincí typu `from` na typ `to`. Převádí se jen celé násobky: když z něco nezbyde na celou minci
 * cílového typu, zůstane to v původní minci (např. 25 sp -> 2 gp, 5 sp zůstane).
 * @returns nové peněženka a kolik mincí se opravdu přeměnilo, nebo null, pokud nejde nic převést
 */
export function convertCoins(wallet: Currency, from: Coin, to: Coin, amount: number): { wallet: Currency; spent: number; gained: number } | null {
  if (from === to || !Number.isInteger(amount) || amount <= 0 || amount > wallet[from]) return null
  const totalCp = amount * COIN_VALUE[from]
  const gained = Math.floor(totalCp / COIN_VALUE[to])
  if (gained <= 0) return null
  // Kolik mincí `from` je potřeba na `gained` mincí `to` (zaokrouhleno nahoru, ale nejvýš `amount`).
  const spent = Math.min(amount, Math.ceil((gained * COIN_VALUE[to]) / COIN_VALUE[from]))
  return { wallet: { ...wallet, [from]: wallet[from] - spent, [to]: wallet[to] + gained }, spent, gained }
}

/** Celková hodnota peněz ve zlatých (s desetinami). */
export function totalGold(wallet: Currency): number {
  const cp = COINS.reduce((n, c) => n + wallet[c] * COIN_VALUE[c], 0)
  return Math.round(cp) / 100
}
