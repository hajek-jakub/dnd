import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

export type InitiativeKind = 'character' | 'enemy'

export interface InitiativeEntry {
  kind: InitiativeKind
  id: string
  value: number | null
}

export interface InitiativeState {
  round: number
  active: { kind: InitiativeKind; id: string } | null
  entries: InitiativeEntry[]
}

export const initiativeKey = (entry: Pick<InitiativeEntry, 'kind' | 'id'>) => `${entry.kind}:${entry.id}`

const key = (campaignId: string) => ['initiative', campaignId]

/** Pořadí iniciativy (jen DM). Dotazuje se každých pár vteřin, protože hráči si hody na iniciativu hází sami. */
export function useInitiative(campaignId: string, enabled: boolean) {
  return useQuery({
    queryKey: key(campaignId),
    enabled,
    refetchInterval: 6000,
    queryFn: () => api.get<InitiativeState>(`/campaigns/${campaignId}/initiative`),
  })
}

function useStateMutation<V>(campaignId: string, fn: (v: V) => Promise<InitiativeState>) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: (state) => queryClient.setQueryData(key(campaignId), state),
  })
}

export function useSetInitiative(campaignId: string) {
  return useStateMutation(campaignId, (input: { subjects: { kind: InitiativeKind; id: string; value?: number }[] }) =>
    api.post<InitiativeState>(`/campaigns/${campaignId}/initiative`, input),
  )
}

export function useReorderInitiative(campaignId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (keys: string[]) => api.post<InitiativeState>(`/campaigns/${campaignId}/initiative/order`, { keys }),
    // Pořadí se změní hned (přetažení nesmí cukat), server ho potvrdí nebo vrátí zpět.
    onMutate: async (keys) => {
      await queryClient.cancelQueries({ queryKey: key(campaignId) })
      const previous = queryClient.getQueryData<InitiativeState>(key(campaignId))
      if (previous) {
        const byKey = new Map(previous.entries.map((e) => [`${e.kind}:${e.id}`, e]))
        queryClient.setQueryData<InitiativeState>(key(campaignId), { ...previous, entries: keys.flatMap((k) => (byKey.has(k) ? [byKey.get(k)!] : [])) })
      }
      return { previous }
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(key(campaignId), ctx.previous)
    },
    onSuccess: (state) => queryClient.setQueryData(key(campaignId), state),
  })
}

export function useNextTurn(campaignId: string) {
  return useStateMutation(campaignId, () => api.post<InitiativeState>(`/campaigns/${campaignId}/initiative/next`, {}))
}

export function useRemoveInitiative(campaignId: string) {
  return useStateMutation(campaignId, (e: { kind: InitiativeKind; id: string }) => api.delete<InitiativeState>(`/campaigns/${campaignId}/initiative/${e.kind}/${e.id}`))
}

export function useClearInitiative(campaignId: string) {
  return useStateMutation(campaignId, () => api.delete<InitiativeState>(`/campaigns/${campaignId}/initiative`))
}
