import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { Tactic, TacticInput, TacticKind } from './types'

const key = (characterId: string) => ['tactics', characterId]

export function useTactics(characterId: string) {
  return useQuery({
    queryKey: key(characterId),
    refetchInterval: 30_000,
    queryFn: async () => (await api.get<{ tactics: Tactic[] }>(`/characters/${characterId}/tactics`)).tactics,
  })
}

export function useCreateTactic(characterId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: TacticInput & { kind: TacticKind }) => (await api.post<{ tactic: Tactic }>(`/characters/${characterId}/tactics`, input)).tactic,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key(characterId) }),
  })
}

export function useUpdateTactic(characterId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...patch }: TacticInput & { id: string }) => (await api.patch<{ tactic: Tactic }>(`/tactics/${id}`, patch)).tactic,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key(characterId) }),
  })
}

export function useDeleteTactic(characterId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => api.delete(`/tactics/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key(characterId) }),
  })
}

export function useReorderTactics(characterId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { kind: TacticKind; ids: string[] }) => (await api.post<{ tactics: Tactic[] }>(`/characters/${characterId}/tactics/reorder`, input)).tactics,
    onSuccess: (tactics) => queryClient.setQueryData(key(characterId), tactics),
  })
}
