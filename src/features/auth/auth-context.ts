import { createContext, useContext } from 'react'
import type { User } from '@/lib/types'

export interface AuthState {
  user: User | null
  loading: boolean
  login: (username: string, password: string) => Promise<void>
  register: (input: { username: string; password: string; code: string; displayName?: string }) => Promise<void>
  logout: () => Promise<void>
  /** Přepíše přihlášeného uživatele (po změně profilu). */
  setUser: (user: User) => void
}

export const AuthContext = createContext<AuthState | null>(null)

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth musí být použit uvnitř AuthProvider')
  return ctx
}
