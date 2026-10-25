import { useState } from 'react'
import { DicesIcon, EyeOffIcon, HeartIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useRoller } from '@/features/dice/useRoller'
import { cn } from '@/lib/utils'
import { ComputedValue } from './ComputedValue'
import { useSheet } from './sheet-context'
import { Stepper } from './Stepper'

export function HpCard() {
  const { sheet, character, hpCurrent, canEdit, adjust } = useSheet()
  const max = sheet.hp.max.value
  const temp = character.state.hpTemp
  const [amount, setAmount] = useState('')
  const amountNumber = Number.parseInt(amount, 10)
  const percent = max > 0 ? Math.max(0, Math.min(100, Math.round((hpCurrent / max) * 100))) : 0
  const hp = (delta: number) => adjust([{ op: 'hp', delta, max }])
  const down = hpCurrent === 0

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <CardTitle className="flex items-center gap-2">
          <HeartIcon aria-hidden className="size-5 text-red-500" /> Životy
        </CardTitle>
        <ComputedValue title="Maximální HP" computed={sheet.hp.max} overrideKey="hp.max" className="text-sm text-muted-foreground">
          <span>max {max}</span>
        </ComputedValue>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="text-center">
          <p
            className="text-5xl font-bold tabular-nums"
            role="status"
            aria-label={`Životy: ${hpCurrent} z ${max} (${percent} %)${temp ? `, dočasných ${temp}` : ''}`}
          >
            {hpCurrent}
            <span className="text-2xl font-normal text-muted-foreground"> / {max}</span>
          </p>
          {temp > 0 && <p className="text-sm text-sky-600 dark:text-sky-400">+ {temp} dočasných</p>}
          <div className="mx-auto mt-2 flex max-w-xs items-center gap-2">
            <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden>
              <div
                className={cn('h-full transition-all', percent > 50 ? 'bg-green-500' : percent > 25 ? 'bg-amber-500' : 'bg-red-500')}
                style={{ width: `${percent}%` }}
              />
            </div>
            <span
              data-testid="hp-percent"
              className={cn(
                'min-w-12 text-right text-sm font-semibold tabular-nums',
                percent > 50 ? 'text-green-700 dark:text-green-400' : percent > 25 ? 'text-amber-700 dark:text-amber-400' : 'text-red-700 dark:text-red-400',
              )}
            >
              {percent} %
            </span>
          </div>
        </div>

        {canEdit && (
          <>
            <div className="grid grid-cols-4 gap-2">
              {[-5, -1, 1, 5].map((d) => (
                <Button
                  key={d}
                  variant={d < 0 ? 'destructive' : 'secondary'}
                  className="h-14 text-lg"
                  onClick={() => hp(d)}
                  aria-label={d < 0 ? `Poškození ${-d}` : `Léčení ${d}`}
                >
                  {d > 0 ? `+${d}` : `−${-d}`}
                </Button>
              ))}
            </div>

            <form className="flex gap-2" onSubmit={(e) => e.preventDefault()} aria-label="Vlastní hodnota poškození nebo léčení">
              <Input
                type="number"
                inputMode="numeric"
                min={1}
                placeholder="Počet"
                aria-label="Počet životů"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
              <Button
                type="button"
                variant="destructive"
                disabled={!(amountNumber > 0)}
                onClick={() => {
                  hp(-amountNumber)
                  setAmount('')
                }}
              >
                Zranit
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={!(amountNumber > 0)}
                onClick={() => {
                  hp(amountNumber)
                  setAmount('')
                }}
              >
                Vyléčit
              </Button>
            </form>

            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-muted-foreground">Dočasná HP</span>
              <Stepper label="Dočasná HP" value={temp} onDelta={(d) => adjust([{ op: 'tempHp', set: Math.max(0, temp + d) }])} />
            </div>
          </>
        )}

        {down && canEdit && (
          <section aria-label="Death saves" className="space-y-2 rounded-lg border border-red-500/40 bg-red-500/5 p-3">
            <h3 className="text-sm font-semibold">Death saves</h3>
            <DeathRow label="Úspěchy" kind="success" count={character.state.deathSuccesses} canEdit={canEdit} />
            <DeathRow label="Neúspěchy" kind="failure" count={character.state.deathFailures} canEdit={canEdit} />
            <DeathStatus successes={character.state.deathSuccesses} failures={character.state.deathFailures} />
            {canEdit && <DeathRoll max={max} />}
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              <EyeOffIcon aria-hidden className="size-3.5 shrink-0" /> Death saves a jejich hody vidíš jen ty a DM, ostatní hráči ne.
            </p>
          </section>
        )}
      </CardContent>
    </Card>
  )
}

function DeathRow({ label, kind, count, canEdit }: { label: string; kind: 'success' | 'failure'; count: number; canEdit: boolean }) {
  const { adjust } = useSheet()
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm">{label}</span>
      <div className="flex gap-2" role="group" aria-label={label}>
        {[1, 2, 3].map((n) => (
          <button
            key={n}
            type="button"
            disabled={!canEdit}
            aria-pressed={count >= n}
            aria-label={`${label} ${n}`}
            onClick={() => adjust([{ op: 'deathSave', kind, delta: count >= n ? -1 : 1 }])}
            className={cn(
              'size-11 rounded-full border-2 transition-colors disabled:opacity-60',
              count >= n
                ? kind === 'success'
                  ? 'border-green-500 bg-green-500'
                  : 'border-red-500 bg-red-500'
                : 'border-muted-foreground/40 hover:bg-muted',
            )}
          />
        ))}
      </div>
    </div>
  )
}

function DeathStatus({ successes, failures }: { successes: number; failures: number }) {
  if (failures >= 3) return <p className="text-sm font-semibold text-red-700 dark:text-red-400" data-testid="death-status">Tři neúspěchy: postava umírá (mrtvá).</p>
  if (successes >= 3) return <p className="text-sm font-semibold text-green-700 dark:text-green-400" data-testid="death-status">Tři úspěchy: postava je stabilizovaná.</p>
  return null
}

/**
 * Hod death save (k20, bez bonusu): 10 a víc je úspěch, méně neúspěch, přirozená 1 jsou dva neúspěchy a přirozená 20 vrátí 1 HP
 * a smaže značky. Hod je vždy skrytý (vidí ho jen hráč a DM) a výsledek se rovnou zapíše.
 */
function DeathRoll({ max }: { max: number }) {
  const { character, adjust } = useSheet()
  const { roll, pending } = useRoller(character.campaignId, character.id)
  const stopped = character.state.deathFailures >= 3 || character.state.deathSuccesses >= 3
  return (
    <Button
      type="button"
      variant="outline"
      className="w-full"
      disabled={pending || stopped}
      onClick={() =>
        roll('Death save', '1d20', {
          hidden: true,
          mode: 'normal',
          onResult: (r) => {
            const natural = r.natural ?? r.total
            if (natural === 20) {
              adjust([{ op: 'hp', delta: 1, max }, { op: 'deathSave', kind: 'success', delta: -3 }, { op: 'deathSave', kind: 'failure', delta: -3 }])
              toast.success('Přirozená 20: postava se probere s 1 HP.')
            } else if (natural === 1) {
              adjust([{ op: 'deathSave', kind: 'failure', delta: 2 }])
              toast.error('Přirozená 1: dva neúspěchy.')
            } else if (r.total >= 10) {
              adjust([{ op: 'deathSave', kind: 'success', delta: 1 }])
              toast.success(`Death save ${r.total}: úspěch.`)
            } else {
              adjust([{ op: 'deathSave', kind: 'failure', delta: 1 }])
              toast.error(`Death save ${r.total}: neúspěch.`)
            }
          },
        })
      }
    >
      <DicesIcon aria-hidden /> Hodit death save
    </Button>
  )
}
