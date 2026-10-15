import { useState } from 'react'
import { HeartIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
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
  const percent = Math.max(0, Math.min(100, Math.round((hpCurrent / max) * 100)))
  const hp = (delta: number) => adjust([{ op: 'hp', delta, max }])
  const down = hpCurrent === 0

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
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
            aria-label={`Životy: ${hpCurrent} z ${max}${temp ? `, dočasných ${temp}` : ''}`}
          >
            {hpCurrent}
            <span className="text-2xl font-normal text-muted-foreground"> / {max}</span>
          </p>
          {temp > 0 && <p className="text-sm text-sky-600 dark:text-sky-400">+ {temp} dočasných</p>}
          <div className="mx-auto mt-2 h-2 max-w-xs overflow-hidden rounded-full bg-muted" aria-hidden>
            <div
              className={cn('h-full transition-all', percent > 50 ? 'bg-green-500' : percent > 25 ? 'bg-amber-500' : 'bg-red-500')}
              style={{ width: `${percent}%` }}
            />
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

        {down && (
          <section aria-label="Death saves" className="space-y-2 rounded-lg border border-red-500/40 bg-red-500/5 p-3">
            <h3 className="text-sm font-semibold">Death saves</h3>
            <DeathRow label="Úspěchy" kind="success" count={character.state.deathSuccesses} canEdit={canEdit} />
            <DeathRow label="Neúspěchy" kind="failure" count={character.state.deathFailures} canEdit={canEdit} />
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
