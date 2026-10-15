import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { Currency } from '@/features/sheet/types'
import type { ItemInput } from '@/features/sheet/api'

export interface DmNote {
  id: string
  characterId: string | null
  body: string
  createdAt: string
  updatedAt: string
}

/** Po každé akci DM se přenačtou postavy v kampani (HP, stavy, efekty se hned ukážou). */
function useRefreshCharacters(campaignId: string) {
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries({ queryKey: ['characters', campaignId] })
}

export function useGiveItem(campaignId: string) {
  const refresh = useRefreshCharacters(campaignId)
  return useMutation({
    mutationFn: (input: { characterIds: string[]; item: ItemInput }) => api.post<{ given: number }>(`/campaigns/${campaignId}/dm/items`, input),
    onSuccess: refresh,
  })
}

export function useGiveCurrency(campaignId: string) {
  const refresh = useRefreshCharacters(campaignId)
  return useMutation({
    mutationFn: (input: { characterIds: string[]; currency: Partial<Currency>; mode?: 'give' | 'take'; split?: boolean; reason?: string }) =>
      api.post<{ given: number; mode: 'give' | 'take'; each: Currency; eachCp: number; leftoverCp: number }>(`/campaigns/${campaignId}/dm/currency`, input),
    onSuccess: refresh,
  })
}

export function useGiveXp(campaignId: string) {
  const refresh = useRefreshCharacters(campaignId)
  return useMutation({
    mutationFn: (input: { characterIds: string[]; amount: number; split: boolean }) => api.post<{ eachGets: number }>(`/campaigns/${campaignId}/dm/xp`, input),
    onSuccess: refresh,
  })
}

export function useSetInspiration(campaignId: string) {
  const refresh = useRefreshCharacters(campaignId)
  return useMutation({
    mutationFn: (input: { characterIds: string[]; set: boolean }) => api.post(`/campaigns/${campaignId}/dm/inspiration`, input),
    onSuccess: refresh,
  })
}

export function useDmHp(campaignId: string) {
  const refresh = useRefreshCharacters(campaignId)
  return useMutation({
    mutationFn: (input: { delta: number; targets: { characterId: string; max: number }[] }) => api.post(`/campaigns/${campaignId}/dm/hp`, input),
    onSuccess: refresh,
  })
}

export function useSetTempHp(campaignId: string) {
  const refresh = useRefreshCharacters(campaignId)
  return useMutation({
    mutationFn: (input: { characterIds: string[]; amount: number }) => api.post(`/campaigns/${campaignId}/dm/temp-hp`, input),
    onSuccess: refresh,
  })
}

export function useSetCondition(campaignId: string) {
  const refresh = useRefreshCharacters(campaignId)
  return useMutation({
    mutationFn: (input: { characterIds: string[]; name: string; set: boolean }) => api.post(`/campaigns/${campaignId}/dm/conditions`, input),
    onSuccess: refresh,
  })
}

export function useAddEffect(campaignId: string) {
  const refresh = useRefreshCharacters(campaignId)
  return useMutation({
    mutationFn: (input: { characterIds: string[]; target: string; value: number; source: string; duration: 'permanent' | 'long_rest' | 'manual' }) =>
      api.post(`/campaigns/${campaignId}/dm/effects`, input),
    onSuccess: refresh,
  })
}

export function useRemoveEffect(campaignId: string) {
  const refresh = useRefreshCharacters(campaignId)
  return useMutation({
    mutationFn: (effectId: string) => api.delete(`/effects/${effectId}`),
    onSuccess: refresh,
  })
}

export function useDmNotes(campaignId: string) {
  return useQuery({
    queryKey: ['dm-notes', campaignId],
    queryFn: async () => (await api.get<{ notes: DmNote[] }>(`/campaigns/${campaignId}/dm-notes`)).notes,
  })
}

export function useSaveNote(campaignId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { id?: string; body: string; characterId?: string | null }) =>
      input.id
        ? api.patch<{ note: DmNote }>(`/dm-notes/${input.id}`, { body: input.body })
        : api.post<{ note: DmNote }>(`/campaigns/${campaignId}/dm-notes`, { body: input.body, ...(input.characterId ? { characterId: input.characterId } : {}) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['dm-notes', campaignId] }),
  })
}

export function useDeleteNote(campaignId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.delete(`/dm-notes/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['dm-notes', campaignId] }),
  })
}
