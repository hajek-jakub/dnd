import { useMemo, useState, type ReactNode } from 'react'
import type { RollMode } from './api'
import { RollSettingsContext } from './roll-settings-context'

const STORAGE_KEY = 'dnd.rollSettings'

function stored(): { mode: RollMode; hidden: boolean } {
  try {
    const v = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as { mode?: unknown; hidden?: unknown }
    const mode = v.mode === 'advantage' || v.mode === 'disadvantage' ? v.mode : 'normal'
    return { mode, hidden: v.hidden === true }
  } catch {
    return { mode: 'normal', hidden: false }
  }
}

function persist(mode: RollMode, hidden: boolean) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ mode, hidden }))
  } catch {
    // bez úložiště platí volba do zavření stránky
  }
}

/**
 * Režim hodu (normálně / výhoda / nevýhoda) a skrytý hod jsou společné pro tlačítka na sheetu i panel kostek.
 * Pamatují se v prohlížeči, takže vydrží zavření a znovuotevření aplikace.
 */
export function RollSettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState(stored)
  const value = useMemo(
    () => ({
      mode: settings.mode,
      hidden: settings.hidden,
      setMode: (mode: RollMode) => {
        persist(mode, settings.hidden)
        setSettings({ ...settings, mode })
      },
      setHidden: (hidden: boolean) => {
        persist(settings.mode, hidden)
        setSettings({ ...settings, hidden })
      },
    }),
    [settings],
  )
  return <RollSettingsContext.Provider value={value}>{children}</RollSettingsContext.Provider>
}
