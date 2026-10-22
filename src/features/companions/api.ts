import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { EnemyAttack } from '@/features/enemies/api'

export interface Companion {
  id: string
  characterId: string
  name: string
  hpMax: number
  hpCurrent: number
  ac: number | null
  attacks: EnemyAttack[]
  notes: string
  position: number
}

export interface CompanionInput {
  name: string
  hpMax: number
  hpCurrent?: number
  ac: number | null
  attacks: EnemyAttack[]
  notes: string
}

const key = (characterId: string) => ['companions', characterId]

/** Společníci postavy; člen, který postavu vidí jen v náhledu, dostane 403 a seznam je prázdný (bez opakování dotazu). */
export function useCompanions(characterId: string) {
  return useQuery({
    queryKey: key(characterId),
    retry: false,
    queryFn: async () => (await api.get<{ companions: Companion[] }>(`/characters/${characterId}/companions`)).companions,
  })
}

export function useCreateCompanion(characterId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: CompanionInput) => (await api.post<{ companion: Companion }>(`/characters/${characterId}/companions`, input)).companion,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key(characterId) }),
  })
}

export function useUpdateCompanion(characterId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...patch }: Partial<CompanionInput> & { id: string }) => (await api.patch<{ companion: Companion }>(`/companions/${id}`, patch)).companion,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key(characterId) }),
  })
}

/** Zranění (záporné) nebo léčení (kladné); server výsledek ořízne na 0 až maximum. */
export function useCompanionHp(characterId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, delta }: { id: string; delta: number }) => (await api.post<{ companion: Companion }>(`/companions/${id}/hp`, { delta })).companion,
    onSuccess: (companion) => queryClient.setQueryData<Companion[]>(key(characterId), (old) => old?.map((c) => (c.id === companion.id ? companion : c))),
  })
}

export function useDuplicateCompanion(characterId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => (await api.post<{ companion: Companion }>(`/companions/${id}/duplicate`, {})).companion,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key(characterId) }),
  })
}

export function useDeleteCompanion(characterId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.delete(`/companions/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key(characterId) }),
  })
}
