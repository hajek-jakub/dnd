import { useMutation } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { User } from '@/lib/types'
import { useAuth } from '@/features/auth/auth-context'

export function useUpdateDisplayName() {
  const { user, setUser } = useAuth()
  return useMutation({
    mutationFn: (displayName: string) => api.patch<{ user: User }>('/profile', { displayName }),
    // Optimistická aktualizace: jméno se změní hned, při chybě se vrátí.
    onMutate: (displayName) => {
      const previous = user
      if (user) setUser({ ...user, displayName })
      return { previous }
    },
    onError: (_error, _vars, context) => {
      if (context?.previous) setUser(context.previous)
    },
    onSuccess: (res) => setUser(res.user),
  })
}

export function useChangePassword() {
  return useMutation({
    mutationFn: (input: { currentPassword: string; newPassword: string }) => api.post('/auth/password', input),
  })
}

/** Barva motivu: změní se hned (optimisticky), při chybě se vrátí. */
export function useUpdateAccent() {
  const { user, setUser } = useAuth()
  return useMutation({
    mutationFn: (accent: string | null) => api.patch<{ user: User }>('/profile', { accent }),
    onMutate: (accent) => {
      const previous = user
      if (user) setUser({ ...user, accent })
      return { previous }
    },
    onError: (_error, _vars, context) => {
      if (context?.previous) setUser(context.previous)
    },
  })
}
