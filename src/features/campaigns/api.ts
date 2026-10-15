import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { Campaign, CampaignSummary, Invite, InvitePreview, Member } from '@/lib/types'

/** Jak často se obnovují data, která mohou změnit ostatní (náhrada realtime; později se zrychlí tam, kde to má smysl). */
const POLL_MS = 10_000

export function useMyCampaigns() {
  return useQuery({
    queryKey: ['campaigns'],
    queryFn: async () => (await api.get<{ campaigns: CampaignSummary[] }>('/campaigns')).campaigns,
  })
}

export function useCampaign(campaignId: string | undefined) {
  return useQuery({
    queryKey: ['campaign', campaignId],
    enabled: Boolean(campaignId),
    retry: false,
    queryFn: async () => (await api.get<{ campaign: Campaign }>(`/campaigns/${campaignId}`)).campaign,
  })
}

export function useCampaignMembers(campaignId: string | undefined) {
  return useQuery({
    queryKey: ['campaign-members', campaignId],
    enabled: Boolean(campaignId),
    refetchInterval: POLL_MS,
    queryFn: async () => (await api.get<{ members: Member[] }>(`/campaigns/${campaignId}/members`)).members,
  })
}

export function useInvites(campaignId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['invites', campaignId],
    enabled: Boolean(campaignId) && enabled,
    refetchInterval: POLL_MS,
    queryFn: async () => (await api.get<{ invites: Invite[] }>(`/campaigns/${campaignId}/invites`)).invites,
  })
}

export function useCreateCampaign() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { name: string; description?: string }) =>
      (await api.post<{ campaign: Campaign }>('/campaigns', input)).campaign,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['campaigns'] }),
  })
}

export function useCreateInvite(campaignId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { expiresInDays: number | null; maxUses: number | null }) =>
      (await api.post<{ invite: Invite }>(`/campaigns/${campaignId}/invites`, input)).invite,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['invites', campaignId] }),
  })
}

export function useRevokeInvite(campaignId: string) {
  const queryClient = useQueryClient()
  const key = ['invites', campaignId]
  return useMutation({
    mutationFn: (inviteId: string) => api.patch(`/campaigns/${campaignId}/invites/${inviteId}`, { revoked: true }),
    // Optimistická aktualizace: pozvánka zmizí z aktivních hned, při chybě se vrátí.
    onMutate: async (inviteId) => {
      await queryClient.cancelQueries({ queryKey: key })
      const previous = queryClient.getQueryData<Invite[]>(key)
      queryClient.setQueryData<Invite[]>(key, (old) =>
        old?.map((invite) => (invite.id === inviteId ? { ...invite, revoked: true } : invite)),
      )
      return { previous }
    },
    onError: (_error, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous)
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  })
}

export function useRemoveMember(campaignId: string) {
  const queryClient = useQueryClient()
  const key = ['campaign-members', campaignId]
  return useMutation({
    mutationFn: (userId: string) => api.delete(`/campaigns/${campaignId}/members/${userId}`),
    onMutate: async (userId) => {
      await queryClient.cancelQueries({ queryKey: key })
      const previous = queryClient.getQueryData<Member[]>(key)
      queryClient.setQueryData<Member[]>(key, (old) => old?.filter((m) => m.userId !== userId))
      return { previous }
    },
    onError: (_error, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous)
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: key })
      void queryClient.invalidateQueries({ queryKey: ['campaigns'] })
    },
  })
}

export function useDeleteCampaign(campaignId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => api.delete(`/campaigns/${campaignId}`),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: ['campaign', campaignId] })
      return queryClient.invalidateQueries({ queryKey: ['campaigns'] })
    },
  })
}

export function usePreviewInvite(code: string) {
  return useQuery({
    queryKey: ['invite-preview', code],
    retry: false,
    queryFn: async () => (await api.get<{ invite: InvitePreview }>(`/invites/${code}`)).invite,
  })
}

export function useAcceptInvite() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (code: string) => (await api.post<{ campaignId: string }>(`/invites/${code}/accept`)).campaignId,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['campaigns'] }),
  })
}

/** Nastavení kampaně (jen DM): nosnost a přetížení, sada pravidel (2014 / 2024). */
export function useUpdateCampaignSettings(campaignId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (settings: { encumbrance?: boolean; ruleset?: '2014' | '2024' }) =>
      (await api.patch<{ campaign: Campaign }>(`/campaigns/${campaignId}`, { settings })).campaign,
    // Přepínač reaguje hned, při chybě se vrátí.
    onMutate: async (settings) => {
      await queryClient.cancelQueries({ queryKey: ['campaign', campaignId] })
      const previous = queryClient.getQueryData<Campaign>(['campaign', campaignId])
      if (previous) queryClient.setQueryData<Campaign>(['campaign', campaignId], { ...previous, settings: { ...previous.settings, ...settings } })
      return { previous }
    },
    onError: (_e, _s, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(['campaign', campaignId], ctx.previous)
    },
    onSuccess: (campaign) => queryClient.setQueryData(['campaign', campaignId], campaign),
  })
}
