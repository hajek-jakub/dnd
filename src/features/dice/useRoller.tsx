import { toast } from 'sonner'
import { ApiError } from '@/lib/api'
import { useRollMutation, type DiceRoll, type RollMode } from './api'
import { describeRoll, naturalNote } from './format'
import { useRollSettings } from './roll-settings-context'

export function showRoll(r: DiceRoll, who?: string) {
  const note = naturalNote(r)
  const title = `${who ? `${who}: ` : ''}${r.label || r.expression}: ${r.total}${note === 'crit' ? ' · přirozená 20!' : note === 'fail' ? ' · přirozená 1' : ''}${r.hidden ? ' (skrytý)' : ''}`
  const opts = { description: describeRoll(r), duration: 6000 }
  if (note === 'crit') toast.success(title, opts)
  else if (note === 'fail') toast.error(title, opts)
  else toast(title, opts)
}

/** Hází kostky na serveru podle společného nastavení (výhoda / nevýhoda, skrytý hod) a ukáže výsledek. */
export function useRoller(campaignId: string, characterId?: string) {
  const settings = useRollSettings()
  const mutation = useRollMutation(campaignId)
  return {
    pending: mutation.isPending,
    roll(label: string, expression: string, options: { crit?: boolean; mode?: RollMode } = {}) {
      mutation.mutate(
        { expression, label, mode: options.mode ?? settings.mode, crit: options.crit, hidden: settings.hidden, ...(characterId ? { characterId } : {}) },
        {
          onSuccess: (r) => showRoll(r),
          onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Hod se nepodařil.'),
        },
      )
    },
  }
}
