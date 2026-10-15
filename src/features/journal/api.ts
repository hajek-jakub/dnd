import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { SUMMARY_KEY, useSummary } from '@/features/summary/api'

export interface JournalEntry {
  id: string
  topic: string
  title: string
  body: string
  visibility: 'all' | 'selected' | 'dm' | 'owner'
  pinned: boolean
  createdBy: string
  createdByName: string
  mine: boolean
  canEdit: boolean
  viewerIds?: string[]
  /** nový nebo změněný od posledního otevření deníku */
  isNew: boolean
  createdAt: string
  updatedAt: string
}

export interface JournalInput {
  topic?: string
  title?: string
  body?: string
  visibility?: JournalEntry['visibility']
  viewerIds?: string[]
  pinned?: boolean
}

export function useJournal(campaignId: string) {
  return useQuery({
    queryKey: ['journal', campaignId],
    refetchInterval: 20_000,
    queryFn: () => api.get<{ entries: JournalEntry[]; unread: number }>(`/campaigns/${campaignId}/journal`),
  })
}

export function useCreateEntry(campaignId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: JournalInput) => (await api.post<{ entry: JournalEntry }>(`/campaigns/${campaignId}/journal`, input)).entry,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['journal', campaignId] }),
  })
}

export function useUpdateEntry(campaignId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: JournalInput & { id: string }) => {
      const { id, ...patch } = input
      return (await api.patch<{ entry: JournalEntry }>(`/journal/${id}`, patch)).entry
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['journal', campaignId] }),
  })
}

export function useDeleteEntry(campaignId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.delete(`/journal/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['journal', campaignId] }),
  })
}

export function useMarkJournalRead(campaignId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => api.post(`/campaigns/${campaignId}/journal/read`, {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: SUMMARY_KEY }),
  })
}

export interface JournalUnread {
  total: number
  campaigns: { campaignId: string; name: string; unread: number }[]
}

/** Nové zápisy v deníku ve všech kampaních (odznak v dolní liště). */
export function useJournalUnread() {
  return useSummary((s) => s.journal)
}
