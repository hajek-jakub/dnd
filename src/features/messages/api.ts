import { useEffect, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { SUMMARY_KEY, useSummary } from '@/features/summary/api'

export interface ChatMessage {
  id: number
  senderId: string
  senderName: string
  /** 'group' | 'secret' | 'dm:<id hráče>' | 'lang:<jazyk>' */
  thread: string
  recipients: { id: string; name: string }[]
  body: string
  createdAt: string
}

export interface MessagesState {
  messages: ChatMessage[]
  /** nepřečtené (cizí) zprávy podle vlákna */
  unread: Record<string, number>
  /** jazyky, které umím, a ostatní hráči, kteří je umí taky */
  languages: LanguageInfo[]
}

export interface LanguageInfo {
  slug: string
  name: string
  speakers: { id: string; name: string }[]
}

const POLL_MS = 4000

/**
 * Zprávy kampaně. Průběžně se ptá jen na novější než poslední známé (`after`) a skládá je k těm, co už jsou v paměti,
 * takže každý dotaz je malý, i když je v kampani hodně zpráv.
 */
export function useMessages(campaignId: string) {
  const queryClient = useQueryClient()
  return useQuery({
    queryKey: ['messages', campaignId],
    refetchInterval: POLL_MS,
    queryFn: async (): Promise<MessagesState> => {
      const prev = queryClient.getQueryData<MessagesState>(['messages', campaignId])
      const last = prev?.messages.at(-1)?.id ?? 0
      const res = await api.get<MessagesState>(`/campaigns/${campaignId}/messages${last > 0 ? `?after=${last}` : ''}`)
      if (!prev) return res
      const known = new Set(prev.messages.map((m) => m.id))
      return { messages: [...prev.messages, ...res.messages.filter((m) => !known.has(m.id))], unread: res.unread, languages: res.languages }
    },
  })
}

export function useSendMessage(campaignId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { to: 'all' | string[] | { language: string }; body: string }) =>
      (await api.post<{ message: ChatMessage }>(`/campaigns/${campaignId}/messages`, input)).message,
    onSuccess: (message) => {
      queryClient.setQueryData<MessagesState>(['messages', campaignId], (old) =>
        old && !old.messages.some((m) => m.id === message.id) ? { ...old, messages: [...old.messages, message] } : old,
      )
      void queryClient.invalidateQueries({ queryKey: SUMMARY_KEY })
    },
  })
}

export function useMarkThreadRead(campaignId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (thread: string) => (await api.post<{ unread: Record<string, number> }>(`/campaigns/${campaignId}/messages/read`, { thread })).unread,
    onSuccess: (unread) => {
      queryClient.setQueryData<MessagesState>(['messages', campaignId], (old) => (old ? { ...old, unread } : old))
      void queryClient.invalidateQueries({ queryKey: SUMMARY_KEY })
    },
  })
}

export interface UnreadOverview {
  total: number
  campaigns: { campaignId: string; name: string; unread: number }[]
}

/** Nepřečtené zprávy ve všech kampaních (odznak v hlavičce a u kampaně). */
export function useUnreadMessages() {
  return useSummary((s) => s.messages)
}

/** Když přibude nová zpráva, ukáže toast. Volá se jen z jednoho místa (hlavička), ať se toasty nezdvojí. */
export function useNewMessageToasts(data: UnreadOverview | undefined) {
  const seen = useRef<Record<string, number> | null>(null)
  useEffect(() => {
    if (!data) return
    if (seen.current !== null) {
      for (const c of data.campaigns) {
        if (c.unread > (seen.current[c.campaignId] ?? 0)) toast('Nová zpráva', { description: c.name })
      }
    }
    seen.current = Object.fromEntries(data.campaigns.map((c) => [c.campaignId, c.unread]))
  }, [data])
}

/** Připravená zpráva DM (koncept): text a příjemci jsou nachystané předem, odešlou se jedním klepnutím. */
export interface MessageDraft {
  id: string
  title: string
  body: string
  /** true = skupina; jinak `recipients` (jeden hráč = soukromě, víc = tajná zpráva) */
  toAll: boolean
  /** jen hráči, kteří v kampani pořád jsou */
  recipients: { id: string; name: string }[]
  sentAt: string | null
  createdAt: string
  updatedAt: string
}

export interface DraftInput {
  title: string
  body: string
  to: 'all' | string[]
}

const draftsKey = (campaignId: string) => ['message-drafts', campaignId] as const

export function useDrafts(campaignId: string, enabled: boolean) {
  return useQuery({
    queryKey: draftsKey(campaignId),
    enabled,
    queryFn: async () => (await api.get<{ drafts: MessageDraft[] }>(`/campaigns/${campaignId}/message-drafts`)).drafts,
  })
}

function useDraftsRefresh(campaignId: string) {
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries({ queryKey: draftsKey(campaignId) })
}

export function useCreateDraft(campaignId: string) {
  const refresh = useDraftsRefresh(campaignId)
  return useMutation({
    mutationFn: async (input: DraftInput) => (await api.post<{ draft: MessageDraft }>(`/campaigns/${campaignId}/message-drafts`, input)).draft,
    onSuccess: refresh,
  })
}

export function useUpdateDraft(campaignId: string) {
  const refresh = useDraftsRefresh(campaignId)
  return useMutation({
    mutationFn: async ({ id, ...input }: DraftInput & { id: string }) => (await api.patch<{ draft: MessageDraft }>(`/message-drafts/${id}`, input)).draft,
    onSuccess: refresh,
  })
}

export function useDeleteDraft(campaignId: string) {
  const refresh = useDraftsRefresh(campaignId)
  return useMutation({
    mutationFn: async (id: string) => void (await api.delete(`/message-drafts/${id}`)),
    onSuccess: refresh,
  })
}

/** Odešle koncept jako běžnou zprávu; odeslaná zpráva se hned přidá do vláken. */
export function useSendDraft(campaignId: string) {
  const queryClient = useQueryClient()
  const refresh = useDraftsRefresh(campaignId)
  return useMutation({
    mutationFn: async (id: string) => await api.post<{ message: ChatMessage; draft: MessageDraft }>(`/message-drafts/${id}/send`, {}),
    onSuccess: ({ message }) => {
      queryClient.setQueryData<MessagesState>(['messages', campaignId], (old) =>
        old && !old.messages.some((m) => m.id === message.id) ? { ...old, messages: [...old.messages, message] } : old,
      )
      void refresh()
      void queryClient.invalidateQueries({ queryKey: SUMMARY_KEY })
    },
  })
}
