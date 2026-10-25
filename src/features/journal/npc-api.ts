import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

/** NPC z přehledu deníku, nebo postava či NPC postava z kampaně (`characterId`): jméno a rasa jdou pak podle postavy. */
export interface JournalNpc {
  id: string
  name: string
  race: string
  description: string
  visibility: 'all' | 'dm'
  characterId: string | null
  characterKind: 'pc' | 'npc' | null
  photoVersion: string | null
  createdBy: string
  createdByName: string
  mine: boolean
  canEdit: boolean
  /** U postavy z kampaně se popis zapisuje do jejího profilu: smí majitel postavy a DM. */
  canEditDescription: boolean
  /** body na mapách, kde se nachází (jen ty, které uživatel na mapě vidí) */
  places: NpcPlace[]
  createdAt: string
  updatedAt: string
}

export interface NpcPlace {
  pinId: string
  mapId: string
  mapName: string
  title: string
  icon: string
}

export interface NpcInput {
  name?: string
  race?: string
  description?: string
  visibility?: JournalNpc['visibility']
  /** body na mapách, kde se nachází (mění jen body, které uživatel vidí) */
  pinIds?: string[]
}

const key = (campaignId: string) => ['journal-npcs', campaignId]

export function useJournalNpcs(campaignId: string) {
  return useQuery({
    queryKey: key(campaignId),
    refetchInterval: 20_000,
    queryFn: async () => (await api.get<{ npcs: JournalNpc[] }>(`/campaigns/${campaignId}/journal/npcs`)).npcs,
  })
}

export function useCreateNpc(campaignId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: NpcInput & { name: string }) => (await api.post<{ npc: JournalNpc }>(`/campaigns/${campaignId}/journal/npcs`, input)).npc,
    onSuccess: (_npc, input) => {
      void queryClient.invalidateQueries({ queryKey: key(campaignId) })
      if (input.pinIds) void queryClient.invalidateQueries({ queryKey: ['map-pins'] })
      if (input.description !== undefined) void queryClient.invalidateQueries({ queryKey: ['character'] })
    },
  })
}

/** Přidá postavy a NPC postavy z kampaně do přehledu (všechny, nebo žádnou). */
export function useAddCharacterNpcs(campaignId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (characterIds: string[]) => (await api.post<{ npcs: JournalNpc[] }>(`/campaigns/${campaignId}/journal/npcs`, { characterIds })).npcs,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key(campaignId) }),
  })
}

export function useUpdateNpc(campaignId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: NpcInput & { id: string }) => {
      const { id, ...patch } = input
      return (await api.patch<{ npc: JournalNpc }>(`/journal-npcs/${id}`, patch)).npc
    },
    onSuccess: (_npc, input) => {
      void queryClient.invalidateQueries({ queryKey: key(campaignId) })
      if (input.pinIds) void queryClient.invalidateQueries({ queryKey: ['map-pins'] })
    },
  })
}

export function useDeleteNpc(campaignId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.delete(`/journal-npcs/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: key(campaignId) })
      queryClient.invalidateQueries({ queryKey: ['journal', campaignId] })
    },
  })
}
