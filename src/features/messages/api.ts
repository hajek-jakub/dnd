import { useEffect, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { SUMMARY_KEY, useSummary } from '@/features/summary/api'
import { mergeMessages, toggleReaction } from './chat-utils'

export interface ChatMessage {
  id: number
  senderId: string
  senderName: string
  /** 'group' | 'secret' | 'dm:<id hráče>' | 'lang:<jazyk>' */
  thread: string
  recipients: { id: string; name: string }[]
  /** u smazané zprávy prázdný */
  body: string
  createdAt: string
  editedAt: string | null
  deletedAt: string | null
  /** zpráva, na kterou tahle odpovídá (text původní zprávy server ukáže jen tomu, kdo ji vidí: `hidden`) */
  replyTo: { id: number; senderName: string; snippet: string; deleted: boolean; hidden: boolean } | null
  reactions: Reaction[]
}

export interface Reaction {
  emoji: string
  users: { id: string; name: string }[]
}

/** Aktuální stav zprávy, která se mohla změnit (reakce, úprava, smazání). */
export interface MessageMark {
  id: number
  body: string
  editedAt: string | null
  deletedAt: string | null
  reactions: Reaction[]
}

export interface MessagesState {
  messages: ChatMessage[]
  /** jen při průběžném dotazování: stav změněných zpráv (viz `mergeMessages`) */
  marks?: MessageMark[]
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

// Otevřený chat se ptá často (zprávy mají přijít hned); dotaz s `after` je malý a běží jen při viditelném okně.
const POLL_MS = 2000

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
      const from = prev?.messages[0]?.id ?? 0
      const res = await api.get<MessagesState>(`/campaigns/${campaignId}/messages${last > 0 ? `?after=${last}&from=${from}` : ''}`)
      if (!prev) return res
      return mergeMessages(prev, res, from)
    },
  })
}

export function useSendMessage(campaignId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { to: 'all' | string[] | { language: string }; body: string; replyToId?: number }) =>
      (await api.post<{ message: ChatMessage }>(`/campaigns/${campaignId}/messages`, input)).message,
    onSuccess: (message) => {
      queryClient.setQueryData<MessagesState>(['messages', campaignId], (old) =>
        old && !old.messages.some((m) => m.id === message.id) ? { ...old, messages: [...old.messages, message] } : old,
      )
      void queryClient.invalidateQueries({ queryKey: SUMMARY_KEY })
    },
  })
}

const messagesKey = (campaignId: string) => ['messages', campaignId] as const

function patchMessage(old: MessagesState | undefined, id: number, patch: (m: ChatMessage) => ChatMessage): MessagesState | undefined {
  return old ? { ...old, messages: old.messages.map((m) => (m.id === id ? patch(m) : m)) } : old
}

/** Reakce na zprávu: změna se ukáže hned a při chybě se vrátí (odpověď serveru platí jen po poslední rozběhnuté změně, ať neblikají starší stavy). */
export function useReact(campaignId: string) {
  const queryClient = useQueryClient()
  const inFlight = useRef(0)
  return useMutation({
    mutationFn: async (v: { id: number; emoji: string; me: { id: string; name: string } }) =>
      await api.post<{ id: number; reactions: Reaction[] }>(`/messages/${v.id}/reactions`, { emoji: v.emoji }),
    onMutate: async (v) => {
      inFlight.current += 1
      await queryClient.cancelQueries({ queryKey: messagesKey(campaignId) })
      const previous = queryClient.getQueryData<MessagesState>(messagesKey(campaignId))
      queryClient.setQueryData<MessagesState>(messagesKey(campaignId), (old) => patchMessage(old, v.id, (m) => ({ ...m, reactions: toggleReaction(m.reactions, v.emoji, v.me) })))
      return { previous }
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(messagesKey(campaignId), ctx.previous)
    },
    onSuccess: (res) => {
      if (inFlight.current <= 1) queryClient.setQueryData<MessagesState>(messagesKey(campaignId), (old) => patchMessage(old, res.id, (m) => ({ ...m, reactions: res.reactions })))
    },
    onSettled: () => {
      inFlight.current = Math.max(0, inFlight.current - 1)
    },
  })
}

/** Autor upraví text své zprávy. */
export function useEditMessage(campaignId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (v: { id: number; body: string }) => (await api.patch<{ message: ChatMessage }>(`/messages/${v.id}`, { body: v.body })).message,
    onSuccess: (message) => queryClient.setQueryData<MessagesState>(messagesKey(campaignId), (old) => patchMessage(old, message.id, () => message)),
  })
}

/** Smaže zprávu (autor, DM kteroukoli): text zmizí, v chatu zůstane „zpráva byla smazána“. */
export function useDeleteMessage(campaignId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: number) => (await api.delete<{ message: ChatMessage }>(`/messages/${id}`)).message,
    onSuccess: (message) => queryClient.setQueryData<MessagesState>(messagesKey(campaignId), (old) => patchMessage(old, message.id, () => message)),
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
