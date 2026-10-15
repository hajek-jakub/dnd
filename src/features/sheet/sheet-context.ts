import { createContext, useContext } from 'react'
import type { ComputedSheet, RulesBundle } from '@/engine'
import type { useUpdateCharacter } from './api'
import type { AdjustOp, CharacterFull } from './types'

export interface SheetContextValue {
  character: CharacterFull
  bundle: RulesBundle
  sheet: ComputedSheet
  hpCurrent: number
  canEdit: boolean
  isDm: boolean
  adjust: (ops: AdjustOp[]) => void
  update: (patch: Parameters<ReturnType<typeof useUpdateCharacter>['mutate']>[0]) => void
  setOverride: (key: string, value: number | null) => void
}

export const SheetContext = createContext<SheetContextValue | null>(null)

export function useSheet(): SheetContextValue {
  const ctx = useContext(SheetContext)
  if (!ctx) throw new Error('useSheet musí být použit uvnitř SheetProvider')
  return ctx
}
