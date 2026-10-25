import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useSummary } from '@/features/summary/api'

export type RollMode = 'normal' | 'advantage' | 'disadvantage'

export interface RollTerm {
  sign: 1 | -1
  count?: number
  sides?: number
  rolls?: number[]
  constant?: number
  /** Člen přidaný kritickým zásahem: `max` plná kostka, `double` druhý hod, `extra` kostky navíc (Brutal Critical). */
  crit?: 'max' | 'double' | 'extra'
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
  /** kostky navíc jen při kritu, nezdvojují se (Brutal Critical: '1d12') */
  critExtra?: string
  hidden?: boolean
  characterId?: string
  /** hod na iniciativu postavy: server ho zapíše DM do pořadí iniciativy */
  initiative?: boolean
}

/**
 * Log hodů kampaně. Neptá se sám pořád dokola: znovu se načte, když souhrn (`/summary`, `rolls`) ohlásí nový hod (`useRollsWatch`).
 * Pak se ptá jen na novější hody a skládá je k těm, co už jsou v paměti.
 */
export function useRolls(campaignId: string, enabled = true) {
  const queryClient = useQueryClient()
  return useQuery({
    queryKey: ['rolls', campaignId],
    enabled: enabled && Boolean(campaignId),
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

/** Načte nové hody, když je souhrn ohlásí (id posledního viditelného hodu je vyšší než poslední známý). */
export function useRollsWatch(campaignId: string, known: number | undefined) {
  const queryClient = useQueryClient()
  const latest = useSummary((s) => s.rolls?.[campaignId] ?? 0)
  useEffect(() => {
    if (known === undefined || !latest.data || latest.data <= known) return
    void queryClient.invalidateQueries({ queryKey: ['rolls', campaignId] })
  }, [latest.data, known, campaignId, queryClient])
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
