import { createContext, useContext } from 'react'
import type { DiceRoll, RollMode } from './api'

export interface RollOverlayRequest {
  label: string
  expression: string
  mode: RollMode
  crit: boolean
  hidden: boolean
  /** "Hodit znovu" ze stejných údajů. */
  again: () => void
}

export interface RollOverlayApi {
  /** Otevře okno s točícími se kostkami hned po kliknutí (ještě před odpovědí serveru). Vrací číslo hodu. */
  begin: (request: RollOverlayRequest) => number
  /** Výsledek ze serveru: kostky dosednou na hozená čísla. */
  finish: (token: number, roll: DiceRoll) => void
  /** Hod se nepodařil: okno se zavře (chybu ukáže volající). */
  fail: (token: number) => void
}

export const RollOverlayContext = createContext<RollOverlayApi | null>(null)

export function useRollOverlay(): RollOverlayApi {
  const ctx = useContext(RollOverlayContext)
  if (!ctx) throw new Error('useRollOverlay musí být uvnitř RollOverlayProvider')
  return ctx
}
