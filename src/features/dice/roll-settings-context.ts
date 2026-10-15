import { createContext, useContext } from 'react'
import type { RollMode } from './api'

export interface RollSettings {
  mode: RollMode
  setMode: (m: RollMode) => void
  hidden: boolean
  setHidden: (h: boolean) => void
}

export const RollSettingsContext = createContext<RollSettings | null>(null)

export function useRollSettings(): RollSettings {
  const ctx = useContext(RollSettingsContext)
  if (!ctx) throw new Error('useRollSettings musí být uvnitř RollSettingsProvider')
  return ctx
}
