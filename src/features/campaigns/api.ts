import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/features/auth/auth-context'
import type { Tables } from '@/lib/database.types'

export type Invite = Tables<'invites'>

export interface MemberRow {
  user_id: string
  role: 'dm' | 'player'
  joined_at: string
  profiles: { display_name: string } | null
}

export function useMyCampaigns() {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['my-campaigns', user?.id],
    enabled: Boolean(user),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('campaign_members')
        .select('role, campaigns(id, name, description)')
        .eq('user_id', user!.id)
      if (error) throw error
      return data.flatMap((row) => (row.campaigns ? [{ role: row.role, campaign: row.campaigns }] : []))
    },
  })
}

export function useCampaign(campaignId: string | undefined) {
  return useQuery({
    queryKey: ['campaign', campaignId],
    enabled: Boolean(campaignId),
    queryFn: async () => {
      const { data, error } = await supabase.from('campaigns').select('*').eq('id', campaignId!).maybeSingle()
      if (error) throw error
      return data
    },
  })
}

export function useCampaignMembers(campaignId: string | undefined) {
  return useQuery({
    queryKey: ['campaign-members', campaignId],
    enabled: Boolean(campaignId),
    queryFn: async (): Promise<MemberRow[]> => {
      const { data, error } = await supabase
        .from('campaign_members')
        .select('user_id, role, joined_at, profiles(display_name)')
        .eq('campaign_id', campaignId!)
        .order('joined_at')
      if (error) throw error
      return data
    },
  })
}

export function useInvites(campaignId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['invites', campaignId],
    enabled: Boolean(campaignId) && enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('invites')
        .select('*')
        .eq('campaign_id', campaignId!)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data
    },
  })
}

export function useCreateCampaign() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { name: string; description?: string }) => {
      const { data, error } = await supabase.rpc('create_campaign', {
        p_name: input.name,
        p_description: input.description ?? '',
      })
      if (error) throw error
      return data
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['my-campaigns'] }),
  })
}

export function useCreateInvite(campaignId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { expiresInDays: number | null; maxUses: number | null }) => {
      const { data, error } = await supabase.rpc('create_invite', {
        p_campaign_id: campaignId,
        p_expires_in_days: input.expiresInDays ?? undefined,
        p_max_uses: input.maxUses ?? undefined,
      })
      if (error) throw error
      return data
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['invites', campaignId] }),
  })
}

export function useRevokeInvite(campaignId: string) {
  const queryClient = useQueryClient()
  const key = ['invites', campaignId]
  return useMutation({
    mutationFn: async (inviteId: string) => {
      const { error } = await supabase.from('invites').update({ revoked: true }).eq('id', inviteId)
      if (error) throw error
    },
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
    mutationFn: async (userId: string) => {
      // select() vrátí smazané řádky; prázdný výsledek znamená, že RLS mazání nepovolilo.
      const { data, error } = await supabase
        .from('campaign_members')
        .delete()
        .eq('campaign_id', campaignId)
        .eq('user_id', userId)
        .select('user_id')
      if (error) throw error
      if (data.length === 0) throw new Error('Člena se nepodařilo odebrat')
    },
    onMutate: async (userId) => {
      await queryClient.cancelQueries({ queryKey: key })
      const previous = queryClient.getQueryData<MemberRow[]>(key)
      queryClient.setQueryData<MemberRow[]>(key, (old) => old?.filter((m) => m.user_id !== userId))
      return { previous }
    },
    onError: (_error, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous)
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: key })
      void queryClient.invalidateQueries({ queryKey: ['my-campaigns'] })
    },
  })
}

export function useDeleteCampaign(campaignId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.from('campaigns').delete().eq('id', campaignId).select('id')
      if (error) throw error
      if (data.length === 0) throw new Error('Kampaň se nepodařilo smazat')
    },
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: ['campaign', campaignId] })
      return queryClient.invalidateQueries({ queryKey: ['my-campaigns'] })
    },
  })
}

export function usePreviewInvite(code: string) {
  return useQuery({
    queryKey: ['invite-preview', code],
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('preview_invite', { p_code: code })
      if (error) throw error
      const row = data[0]
      if (!row) throw new Error('Pozvánka je neplatná, vypršela nebo byla zrušena')
      return row
    },
  })
}

export function useAcceptInvite() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (code: string) => {
      const { data, error } = await supabase.rpc('accept_invite', { p_code: code })
      if (error) throw error
      return data
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['my-campaigns'] }),
  })
}
