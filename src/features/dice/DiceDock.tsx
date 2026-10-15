import { useEffect, useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { DicesIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Modal } from '@/components/ui/modal'
import { useAuth } from '@/features/auth/auth-context'
import { cn } from '@/lib/utils'
import { useRolls, type DiceRoll } from './api'
import { breakdown, modeLabel, naturalNote } from './format'
import { useDiceSlot } from './dice-slot-context'
import { RollModeSwitch } from './RollModeSwitch'
import { showRoll, useRoller } from './useRoller'

const QUICK = [4, 6, 8, 10, 12, 20, 100]

/**
 * Plovoucí tlačítko s kostkami: volný hod ("2d6+3" nebo rychlé kostky), režim hodu a sdílený log kampaně.
 * I se zavřeným panelem hlídá hody ostatních a ukáže je jako toast.
 */
export function DiceDock({ campaignId, characterId }: { campaignId: string; characterId?: string }) {
  const [open, setOpen] = useState(false)
  const { user } = useAuth()
  const { data: rolls } = useRolls(campaignId)
  const { roll, pending } = useRoller(campaignId, characterId)
  const [expression, setExpression] = useState('')
  // Tlačítko kostek je v horní liště (kontejner vykresluje AppLayout), ne plovoucí nad obsahem.
  const slot = useDiceSlot()

  // Hody ostatních se ukážou jako toast (první načtení jen zapamatuje, co už v logu je).
  const seen = useRef<number | null>(null)
  useEffect(() => {
    if (!rolls) return
    const max = rolls.at(-1)?.id ?? 0
    if (seen.current === null) {
      seen.current = max
      return
    }
    for (const r of rolls.filter((x) => x.id > (seen.current ?? 0))) {
      if (r.userId !== user?.id) showRoll(r, r.characterName ?? r.userName)
    }
    seen.current = Math.max(seen.current, max)
  }, [rolls, user?.id])

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!expression.trim()) return
    roll('', expression.trim())
  }

  return (
    <>
      {slot &&
        createPortal(
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Kostky"
            title="Kostky"
            className="inline-flex size-11 items-center justify-center rounded-lg text-primary transition-colors hover:bg-muted"
          >
            <DicesIcon aria-hidden className="size-6" />
          </button>,
          slot,
        )}
      <Modal open={open} onClose={() => setOpen(false)} title="Kostky">
        {open && (
          <div className="space-y-4">
            <RollModeSwitch />
            <div role="group" aria-label="Rychlé kostky" className="flex flex-wrap gap-2">
              {QUICK.map((n) => (
                <Button key={n} type="button" variant="secondary" disabled={pending} onClick={() => roll(`d${n}`, `1d${n}`)} aria-label={`Hodit d${n}`}>
                  d{n}
                </Button>
              ))}
            </div>
            <form onSubmit={submit} className="flex items-end gap-2">
              <div className="min-w-0 flex-1 space-y-1">
                <Label htmlFor="dice-expression">Vlastní hod</Label>
                <Input id="dice-expression" value={expression} maxLength={100} placeholder="2d6+3" autoComplete="off" onChange={(e) => setExpression(e.target.value)} />
              </div>
              <Button type="submit" disabled={pending || !expression.trim()}>
                Hodit
              </Button>
            </form>
            <RollLog rolls={rolls ?? []} me={user?.id ?? ''} />
          </div>
        )}
      </Modal>
    </>
  )
}

function RollLog({ rolls, me }: { rolls: DiceRoll[]; me: string }) {
  const list = [...rolls].reverse()
  return (
    <section aria-label="Log hodů" className="space-y-2">
      <h3 className="text-sm font-medium text-muted-foreground">Log hodů kampaně</h3>
      {list.length === 0 && <p className="text-sm text-muted-foreground">Zatím se nehodilo nic.</p>}
      <ul className="scroll-area max-h-[40dvh] space-y-2 pr-2">
        {list.map((r) => {
          const note = naturalNote(r)
          return (
            <li key={r.id} className={cn('rounded-lg border p-2 text-sm', note === 'crit' && 'border-green-600 bg-green-500/10', note === 'fail' && 'border-red-600 bg-red-500/10')}>
              <p className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium">
                  {r.userId === me ? 'Ty' : r.userName}
                  {r.characterName ? ` (${r.characterName})` : ''}
                  {r.label ? ` · ${r.label}` : ''}
                </span>
                <span className="text-xl font-bold tabular-nums" data-testid="roll-total">
                  {r.total}
                </span>
              </p>
              <p className="text-xs text-muted-foreground">
                {r.expression}
                {r.crit ? ' (kritický)' : ''} · {r.attempts[r.chosen] ? breakdown(r.attempts[r.chosen]!) : ''}
                {r.attempts.length > 1 ? ` · ${modeLabel(r.mode)}: ${r.attempts.map((a, i) => (i === r.chosen ? a.total : `(${a.total})`)).join(' / ')}` : ''}
                {note === 'crit' ? ' · přirozená 20' : note === 'fail' ? ' · přirozená 1' : ''}
                {r.hidden ? ' · skrytý' : ''}
              </p>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
