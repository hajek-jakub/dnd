import { useEffect, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/lib/api'

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
      void queryClient.invalidateQueries({ queryKey: ['messages-unread'] })
    },
  })
}

export function useMarkThreadRead(campaignId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (thread: string) => (await api.post<{ unread: Record<string, number> }>(`/campaigns/${campaignId}/messages/read`, { thread })).unread,
    onSuccess: (unread) => {
      queryClient.setQueryData<MessagesState>(['messages', campaignId], (old) => (old ? { ...old, unread } : old))
      void queryClient.invalidateQueries({ queryKey: ['messages-unread'] })
    },
  })
}

export interface UnreadOverview {
  total: number
  campaigns: { campaignId: string; name: string; unread: number }[]
}

/** Nepřečtené zprávy ve všech kampaních (odznak v hlavičce a u kampaně). */
export function useUnreadMessages() {
  return useQuery({
    queryKey: ['messages-unread'],
    refetchInterval: 8000,
    refetchIntervalInBackground: false,
    queryFn: () => api.get<UnreadOverview>('/messages/unread'),
  })
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
