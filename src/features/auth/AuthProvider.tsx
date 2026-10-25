import { forgetPushOnServer } from '@/features/push/push'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api, onUnauthorized } from '@/lib/api'
import type { User } from '@/lib/types'
import { useTheme } from '@/components/theme-context'
import { AuthContext, type AuthState } from './auth-context'

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const { setAccent } = useTheme()

  // Barva motivu patří účtu: po přihlášení (i na jiném zařízení) se použije barva uživatele.
  const accent = user ? user.accent ?? null : undefined
  useEffect(() => {
    if (accent !== undefined) setAccent(accent)
  }, [accent, setAccent])

  useEffect(() => {
    let active = true
    api
      .get<{ user: User | null }>('/auth/me')
      .then((res) => {
        if (active) setUser(res.user)
      })
      .catch(() => {
        // server nedostupný: bereme jako odhlášeného, přihlašovací stránka ukáže chybu při pokusu
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  // Vypršela relace uprostřed práce: odhlásit v UI, RequireAuth přesměruje na přihlášení.
  useEffect(
    () =>
      onUnauthorized(() => {
        setUser(null)
        queryClient.clear()
      }),
    [queryClient],
  )

  const login = useCallback(async (username: string, password: string) => {
    const res = await api.post<{ user: User }>('/auth/login', { username, password })
    setUser(res.user)
  }, [])

  const register = useCallback(async (input: { username: string; password: string; code: string; displayName?: string }) => {
    const res = await api.post<{ user: User }>('/auth/register', input)
    setUser(res.user)
  }, [])

  const logout = useCallback(async () => {
    try {
      // Dokud je uživatel přihlášený: odběr push tohoto zařízení se zruší, ať po odhlášení nechodí cizí upozornění.
      await forgetPushOnServer()
      await api.post('/auth/logout')
    } finally {
      setUser(null)
      queryClient.clear()
    }
  }, [queryClient])

  const value = useMemo<AuthState>(
    () => ({ user, loading, login, register, logout, setUser }),
    [user, loading, login, register, logout],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
