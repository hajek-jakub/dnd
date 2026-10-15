import { createContext, useContext } from 'react'

/** Prvek v horní liště, kam stránky (DiceDock) vykreslí tlačítko kostek. */
export const DiceSlotContext = createContext<HTMLElement | null>(null)

export function useDiceSlot(): HTMLElement | null {
  return useContext(DiceSlotContext)
}
