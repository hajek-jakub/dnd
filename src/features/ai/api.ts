import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { LootTree } from '@/features/loot/api'
import type { ItemKind } from '@/features/sheet/labels'

export interface AiConversationSummary {
  id: string
  title: string
  updatedAt: string
}

export interface AiStatus {
  /** Smí volající pomocníka používat (DM kampaně a účet v claude_users na serveru). */
  enabled: boolean
  configured: boolean
  model: string
  spentUsd: number
  budgetUsd: number
  conversations: AiConversationSummary[]
}

export interface AiProposalEntry {
  /** Cesta složky („Hrobka / Místnost 1“), prázdná = Nezařazené. */
  folder: string
  label: string
  /** Druh itemu (wondrous, weapon, …), u zlata 'gold'. */
  kind: ItemKind | 'gold'
  rarity: string | null
  attunement: boolean
  quantity: number
  /** Jen u zlata: mince jako text („50 gp, 20 sp“). */
  coins: string | null
  /** Cena v obchodě jako text, null = nalezená věc zdarma. */
  price: string | null
  curse: boolean
}

export interface AiProposal {
  id: string
  title: string
  status: 'pending' | 'applied' | 'discarded'
  folders: string[]
  entries: AiProposalEntry[]
}

export type AiItem =
  | { id: string; type: 'user'; text: string }
  | { id: string; type: 'assistant'; text: string }
  | { id: string; type: 'activity'; text: string }
  | { id: string; type: 'proposal'; proposal: AiProposal }

export interface AiConversation {
  id: string
  campaignId: string
  title: string
  /** working = AI má co dělat (další krok), stopped = zastavila se a čeká na zprávu DM (`notice` říká proč). */
  state: 'idle' | 'working' | 'stopped'
  notice: string | null
  updatedAt: string
  items: AiItem[]
}

interface ConversationResponse {
  conversation: AiConversation
  /** Jen u založení: konverzace vznikla, ale první krok AI selhal (dá se zopakovat). */
  error?: { code: string; message: string }
}

export const aiStatusKey = (campaignId: string) => ['ai', campaignId] as const
export const aiConversationKey = (id: string) => ['ai-conversation', id] as const

export function useAiStatus(campaignId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: aiStatusKey(campaignId ?? ''),
    enabled: enabled && Boolean(campaignId),
    staleTime: 60_000,
    queryFn: () => api.get<AiStatus>(`/campaigns/${campaignId}/ai`),
  })
}

export function useAiConversation(id: string | null) {
  return useQuery({
    queryKey: aiConversationKey(id ?? ''),
    enabled: id !== null,
    queryFn: () => aiApi.get(id ?? ''),
  })
}

export const aiApi = {
  get: (id: string) => api.get<ConversationResponse>(`/ai/conversations/${id}`).then((r) => r.conversation),
  create: (campaignId: string, message: string) => api.post<ConversationResponse>(`/campaigns/${campaignId}/ai/conversations`, { message }),
  message: (id: string, message: string) => api.post<ConversationResponse>(`/ai/conversations/${id}/messages`, { message }),
  step: (id: string) => api.post<ConversationResponse>(`/ai/conversations/${id}/step`),
  remove: (id: string) => api.delete(`/ai/conversations/${id}`),
}

/** Nahradí v konverzaci kartu návrhu novým stavem. */
function withProposal(conv: AiConversation | undefined, proposal: AiProposal): AiConversation | undefined {
  if (!conv) return conv
  return { ...conv, items: conv.items.map((i) => (i.type === 'proposal' && i.proposal.id === proposal.id ? { ...i, proposal } : i)) }
}

/** Potvrzení návrhu: složky a položky vzniknou v lootu; strom lootu se rovnou uloží z odpovědi. */
export function useApplyProposal(campaignId: string, conversationId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (proposalId: string) => api.post<{ proposal: AiProposal } & LootTree>(`/ai/proposals/${proposalId}/apply`),
    onSuccess: ({ proposal, folders, entries }) => {
      qc.setQueryData<AiConversation>(aiConversationKey(conversationId), (c) => withProposal(c, proposal))
      qc.setQueryData<LootTree>(['loot', campaignId], { folders, entries })
    },
  })
}

export function useDiscardProposal(conversationId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (proposalId: string) => api.post<{ proposal: AiProposal }>(`/ai/proposals/${proposalId}/discard`),
    onSuccess: ({ proposal }) => qc.setQueryData<AiConversation>(aiConversationKey(conversationId), (c) => withProposal(c, proposal)),
  })
}
