import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

export interface EnemyAttack {
  name: string
  toHit: number
  damage: string
}

export interface Enemy {
  id: string
  campaignId: string
  name: string
  hpMax: number
  hpCurrent: number
  ac: number | null
  /** bonus k hodu na iniciativu */
  initiative: number
  attacks: EnemyAttack[]
  notes: string
  position: number
}

export interface EnemyInput {
  name: string
  hpMax: number
  hpCurrent?: number
  ac: number | null
  initiative: number
  attacks: EnemyAttack[]
  notes: string
}

const key = (campaignId: string) => ['enemies', campaignId]

export function useEnemies(campaignId: string, enabled: boolean) {
  return useQuery({
    queryKey: key(campaignId),
    enabled,
    queryFn: async () => (await api.get<{ enemies: Enemy[] }>(`/campaigns/${campaignId}/enemies`)).enemies,
  })
}

export function useCreateEnemy(campaignId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: EnemyInput) => (await api.post<{ enemy: Enemy }>(`/campaigns/${campaignId}/enemies`, input)).enemy,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key(campaignId) }),
  })
}

export function useUpdateEnemy(campaignId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...patch }: Partial<EnemyInput> & { id: string }) => (await api.patch<{ enemy: Enemy }>(`/enemies/${id}`, patch)).enemy,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key(campaignId) }),
  })
}

/** Zranění (záporné) nebo léčení (kladné); server výsledek ořízne na 0 až maximum. */
export function useEnemyHp(campaignId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, delta }: { id: string; delta: number }) => (await api.post<{ enemy: Enemy }>(`/enemies/${id}/hp`, { delta })).enemy,
    onSuccess: (enemy) =>
      queryClient.setQueryData<Enemy[]>(key(campaignId), (old) => old?.map((e) => (e.id === enemy.id ? enemy : e))),
  })
}

export function useDuplicateEnemy(campaignId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => (await api.post<{ enemy: Enemy }>(`/enemies/${id}/duplicate`, {})).enemy,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key(campaignId) }),
  })
}

export function useDeleteEnemy(campaignId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.delete(`/enemies/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key(campaignId) }),
  })
}

export interface InitiativeRollResult {
  id: string
  name: string
  total: number
}

/** Hod na iniciativu jednoho nepřítele (skrytý, server ho zapíše do pořadí iniciativy). */
export function useRollEnemyInitiative(campaignId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => (await api.post<{ result: InitiativeRollResult }>(`/enemies/${id}/initiative`, {})).result,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['initiative', campaignId] })
      void queryClient.invalidateQueries({ queryKey: ['rolls', campaignId] })
    },
  })
}
