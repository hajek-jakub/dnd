import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

export type RollMode = 'normal' | 'advantage' | 'disadvantage'

export interface RollTerm {
  sign: 1 | -1
  count?: number
  sides?: number
  rolls?: number[]
  constant?: number
}

export interface RollAttempt {
  terms: RollTerm[]
  total: number
}

export interface DiceRoll {
  id: number
  userId: string
  userName: string
  characterId: string | null
  characterName: string | null
  label: string
  expression: string
  mode: RollMode
  crit: boolean
  hidden: boolean
  total: number
  attempts: RollAttempt[]
  chosen: number
  /** hodnota na kostce u jednoho k20, jinak null */
  natural: number | null
  createdAt: string
}

export interface RollRequest {
  expression: string
  label?: string
  mode?: RollMode
  crit?: boolean
  hidden?: boolean
  characterId?: string
  /** hod na iniciativu postavy: server ho zapíše DM do pořadí iniciativy */
  initiative?: boolean
}

/** Log hodů kampaně. Průběžně se ptá jen na novější hody a skládá je k těm, co už jsou v paměti. */
export function useRolls(campaignId: string, enabled = true) {
  const queryClient = useQueryClient()
  return useQuery({
    queryKey: ['rolls', campaignId],
    enabled: enabled && Boolean(campaignId),
    refetchInterval: 5000,
    queryFn: async (): Promise<DiceRoll[]> => {
      const prev = queryClient.getQueryData<DiceRoll[]>(['rolls', campaignId])
      const last = prev?.at(-1)?.id ?? 0
      const res = await api.get<{ rolls: DiceRoll[] }>(`/campaigns/${campaignId}/rolls${last > 0 ? `?after=${last}` : ''}`)
      if (!prev) return res.rolls
      const known = new Set(prev.map((r) => r.id))
      return [...prev, ...res.rolls.filter((r) => !known.has(r.id))].slice(-100)
    },
  })
}

export function useRollMutation(campaignId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: RollRequest) => (await api.post<{ roll: DiceRoll }>(`/campaigns/${campaignId}/rolls`, input)).roll,
    onSuccess: (roll) =>
      queryClient.setQueryData<DiceRoll[]>(['rolls', campaignId], (old) => (old && !old.some((r) => r.id === roll.id) ? [...old, roll].slice(-100) : old)),
  })
}

export interface BatchAttack {
  label: string
  /** výraz hodu na zásah (např. 1d20+8); chybí u kouzel se záchranným hodem */
  toHit?: string
  /** výraz zranění (např. 1d8+5+1d4) */
  damage?: string
}

export interface BatchResult {
  label: string
  /** přirozená 20 na zásah: zranění je hozené jako kritické */
  crit: boolean
  hit: DiceRoll | null
  damage: DiceRoll | null
}

/** Série útoků najednou: každý má hod na zásah a zranění (krit při přirozené 20). Hody jdou do logu kampaně. */
export function useBatchRoll(campaignId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { attacks: BatchAttack[]; mode?: RollMode; hidden?: boolean; characterId?: string }) =>
      (await api.post<{ results: BatchResult[] }>(`/campaigns/${campaignId}/rolls/batch`, input)).results,
    onSuccess: (results) => {
      const rolls = results.flatMap((r) => [r.hit, r.damage]).filter((r): r is DiceRoll => r !== null)
      queryClient.setQueryData<DiceRoll[]>(['rolls', campaignId], (old) => {
        if (!old) return old
        const known = new Set(old.map((r) => r.id))
        return [...old, ...rolls.filter((r) => !known.has(r.id))].slice(-100)
      })
    },
  })
}
