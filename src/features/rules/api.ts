import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { HomebrewKind, RuleDetail, RuleFacets, RuleSummary } from '@/lib/types'

export const PAGE_SIZE = 40
const RULES_STALE_MS = 5 * 60_000

export interface RuleFilters {
  kinds: string[]
  q?: string
  level?: string
  category?: string
  rarity?: string
  attunement?: string
  source?: string
  tag?: string
  scope?: string
  campaignId?: string
  sort?: string
}

function toQuery(filters: RuleFilters): string {
  const params = new URLSearchParams()
  params.set('kinds', filters.kinds.join(','))
  for (const key of ['q', 'level', 'category', 'rarity', 'attunement', 'source', 'tag', 'scope', 'campaignId', 'sort'] as const) {
    const value = filters[key]
    if (value) params.set(key, value)
  }
  return params.toString()
}

export function useRules(filters: RuleFilters) {
  const query = toQuery(filters)
  return useInfiniteQuery({
    queryKey: ['rules', query],
    initialPageParam: 0,
    staleTime: RULES_STALE_MS,
    placeholderData: keepPreviousData,
    queryFn: ({ pageParam }) =>
      api.get<{ total: number; entries: RuleSummary[] }>(`/rules?${query}&limit=${PAGE_SIZE}&offset=${pageParam}`),
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((n, p) => n + p.entries.length, 0)
      return loaded < last.total ? loaded : undefined
    },
  })
}

export function useRuleFacets(kinds: string[], campaignId?: string) {
  const params = new URLSearchParams({ kinds: kinds.join(',') })
  if (campaignId) params.set('campaignId', campaignId)
  return useQuery({
    queryKey: ['rule-facets', params.toString()],
    staleTime: RULES_STALE_MS,
    queryFn: () => api.get<RuleFacets>(`/rules/facets?${params.toString()}`),
  })
}

export function useRule(id: string | undefined) {
  return useQuery({
    queryKey: ['rule', id],
    enabled: Boolean(id),
    retry: false,
    staleTime: RULES_STALE_MS,
    queryFn: async () => (await api.get<{ entry: RuleDetail }>(`/rules/${id}`)).entry,
  })
}

export interface HomebrewInput {
  kind?: HomebrewKind
  name?: string
  description?: string
  visibility?: 'campaign' | 'private'
  level?: number | null
  school?: string
  castingTime?: string
  range?: string
  components?: string
  duration?: string
  material?: string
  higherLevel?: string
  classes?: string
  ritual?: boolean
  concentration?: boolean
  rarity?: string | null
  attunement?: boolean
  itemType?: string
  priceGp?: number | null
  category?: string
  // zbraň
  damageDice?: string
  damageType?: string
  properties?: string[]
  magicBonus?: number
  extraDamage?: { dice: string; type: string }[]
  versatileDice?: string | null
}

export function useCreateHomebrew(campaignId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: HomebrewInput) =>
      (await api.post<{ entry: RuleDetail }>(`/campaigns/${campaignId}/homebrew`, input)).entry,
    onSuccess: (entry) => {
      queryClient.setQueryData(['rule', entry.id], entry)
      void queryClient.invalidateQueries({ queryKey: ['rules'] })
      void queryClient.invalidateQueries({ queryKey: ['rule-facets'] })
    },
  })
}

export function useUpdateHomebrew(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: HomebrewInput) => (await api.patch<{ entry: RuleDetail }>(`/rules/${id}`, input)).entry,
    onSuccess: (entry) => {
      queryClient.setQueryData(['rule', id], entry)
      void queryClient.invalidateQueries({ queryKey: ['rules'] })
      void queryClient.invalidateQueries({ queryKey: ['rule-facets'] })
    },
  })
}

export function useDeleteHomebrew(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => api.delete(`/rules/${id}`),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: ['rule', id] })
      void queryClient.invalidateQueries({ queryKey: ['rules'] })
      void queryClient.invalidateQueries({ queryKey: ['rule-facets'] })
    },
  })
}
