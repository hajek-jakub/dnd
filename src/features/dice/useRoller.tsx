import { toast } from 'sonner'
import { ApiError } from '@/lib/api'
import { useRollMutation, type DiceRoll, type RollMode } from './api'
import { describeRoll, naturalNote } from './format'
import { useRollOverlay } from './roll-overlay-context'
import { useRollSettings } from './roll-settings-context'

export function showRoll(r: DiceRoll, who?: string) {
  const note = naturalNote(r)
  const title = `${who ? `${who}: ` : ''}${r.label || r.expression}: ${r.total}${note === 'crit' ? ' · přirozená 20!' : note === 'fail' ? ' · přirozená 1' : ''}${r.hidden ? ' (skrytý)' : ''}`
  const opts = { description: describeRoll(r), duration: 6000 }
  if (note === 'crit') toast.success(title, opts)
  else if (note === 'fail') toast.error(title, opts)
  else toast(title, opts)
}

/**
 * Hází kostky na serveru podle společného nastavení (výhoda / nevýhoda, skrytý hod). Hned se otevře okno s točícími se kostkami
 * a po odpovědi serveru ukáže hozená čísla a součet (`RollOverlay`).
 */
export function useRoller(campaignId: string, characterId?: string) {
  const settings = useRollSettings()
  const overlay = useRollOverlay()
  const mutation = useRollMutation(campaignId)

  function roll(label: string, expression: string, options: { crit?: boolean; mode?: RollMode; hidden?: boolean } = {}) {
    const mode = options.mode ?? settings.mode
    const hidden = options.hidden ?? settings.hidden
    const crit = options.crit === true
    const token = overlay.begin({ label, expression, mode, crit, hidden, again: () => roll(label, expression, options) })
    mutation.mutate(
      { expression, label, mode, crit: options.crit, hidden, ...(characterId ? { characterId } : {}) },
      {
        onSuccess: (r) => overlay.finish(token, r),
        onError: (e) => {
          overlay.fail(token)
          toast.error(e instanceof ApiError ? e.message : 'Hod se nepodařil.')
        },
      },
    )
  }

  return { pending: mutation.isPending, roll }
}
