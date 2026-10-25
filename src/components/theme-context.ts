import { createContext, useContext } from 'react'

export type Theme = 'system' | 'light' | 'dark'

export interface ThemeState {
  theme: Theme
  /** Skutečně použitý motiv (po vyhodnocení "system"). */
  resolvedTheme: 'light' | 'dark'
  setTheme: (theme: Theme) => void
  /** Barva motivu uživatele (#rrggbb), null = výchozí červená. */
  accent: string | null
  setAccent: (accent: string | null) => void
}

export const ThemeContext = createContext<ThemeState | null>(null)

export function useTheme(): ThemeState {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme musí být použit uvnitř ThemeProvider')
  return ctx
}
