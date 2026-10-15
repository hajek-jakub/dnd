import { useMemo, useState, type ReactNode } from 'react'
import type { RollMode } from './api'
import { RollSettingsContext } from './roll-settings-context'

/** Režim hodu (normálně / výhoda / nevýhoda) a skrytý hod jsou společné pro tlačítka na sheetu i panel kostek. */
export function RollSettingsProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<RollMode>('normal')
  const [hidden, setHidden] = useState(false)
  const value = useMemo(() => ({ mode, setMode, hidden, setHidden }), [mode, hidden])
  return <RollSettingsContext.Provider value={value}>{children}</RollSettingsContext.Provider>
}
