import { createContext, useContext, useEffect } from 'react'

/** Prvek v horní liště, kam se vykreslí tlačítko kostek (DiceDock). */
export const DiceSlotContext = createContext<HTMLElement | null>(null)

export function useDiceSlot(): HTMLElement | null {
  return useContext(DiceSlotContext)
}

/** Za koho a v jaké kampani hází panel kostek; bez nastavení aktivní kampaň a hráč sám za sebe. */
export interface DiceTarget {
  campaignId: string
  characterId?: string
}

export const DiceTargetContext = createContext<(target: DiceTarget | null) => void>(() => {})

/** Stránka postavy: volné hody z panelu kostek jdou za tuto postavu (a do její kampaně). */
export function useDiceTarget(campaignId: string | undefined, characterId?: string) {
  const set = useContext(DiceTargetContext)
  useEffect(() => {
    if (!campaignId) return
    set({ campaignId, characterId })
    return () => set(null)
  }, [set, campaignId, characterId])
}
