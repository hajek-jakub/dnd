import { toast } from 'sonner'
import { ApiError } from '@/lib/api'
import { useAdjust, type RechargeResult } from './api'
import type { CharacterItem, ItemCharges } from './types'

export type ItemWithCharges = CharacterItem & { charges: ItemCharges }

export const hasCharges = (item: CharacterItem): item is ItemWithCharges => item.charges !== null

/** Obnova nábojů pro popisek: „obnova 1d6+1 za úsvitu“, „obnova všech za úsvitu“, „obnova jen ručně“. */
export function rechargeLabel(recharge: string | null): string {
  if (recharge === null) return 'obnova jen ručně'
  return `obnova ${recharge === 'all' ? 'všech' : recharge} za úsvitu`
}

function rechargeMessage(results: RechargeResult[]): string {
  const parts = results.map((r) => {
    const roll = r.rolled !== null && !/^\d+$/.test(r.expression) ? ` (hod ${r.expression} = ${r.rolled})` : ''
    return `${r.name} +${r.gained}${roll}`
  })
  return `Dobité náboje: ${parts.join(', ')}`
}

/** Dobití nábojů itemů (hod na serveru) s toastem výsledku; adjust bere nejvýš 20 operací. */
export function useRecharge(characterId: string) {
  const adjust = useAdjust(characterId)
  return {
    pending: adjust.isPending,
    recharge: (itemIds: string[]) =>
      adjust.mutate(
        itemIds.slice(0, 20).map((itemId) => ({ op: 'recharge', itemId })),
        {
          onSuccess: (res) => {
            if (res.recharged?.length) toast.success(rechargeMessage(res.recharged))
          },
          onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Dobití nábojů se nepodařilo.'),
        },
      ),
  }
}
