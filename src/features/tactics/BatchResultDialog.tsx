import { EyeOffIcon } from 'lucide-react'
import { Modal } from '@/components/ui/modal'
import { cn } from '@/lib/utils'
import type { BatchResult, DiceRoll } from '@/features/dice/api'
import { breakdown } from '@/features/dice/format'

export interface BatchOutcome {
  title: string
  results: BatchResult[]
  hidden: boolean
  /** co se zaplatilo a spotřebovalo, např. "−1 ki, −2 Crossbow bolt" */
  paid: string
}

function Roll({ roll, testId }: { roll: DiceRoll; testId?: string }) {
  const chosen = roll.attempts[roll.chosen]
  return (
    <span data-testid={testId} title={`${roll.expression}: ${chosen ? breakdown(chosen) : ''}`}>
      <strong className="text-lg tabular-nums">{roll.total}</strong>
      <span className="ml-1 text-xs text-muted-foreground">({chosen ? breakdown(chosen) : roll.expression})</span>
    </span>
  )
}

/** Výsledek série hodů z taktik: u každého útoku zásah a zranění, přirozená 20 a 1 zvlášť, dole součet zranění. */
export function BatchResultDialog({ outcome, onClose }: { outcome: BatchOutcome | null; onClose: () => void }) {
  const total = outcome?.results.reduce((n, r) => n + (r.damage?.total ?? 0), 0) ?? 0
  return (
    <Modal open={outcome !== null} onClose={onClose} title={outcome ? `Hody: ${outcome.title}` : 'Hody'}>
      {outcome && (
        <div className="space-y-3">
          <ul aria-label="Výsledky útoků" className="divide-y rounded-lg border">
            {outcome.results.map((r, i) => {
              const nat = r.hit?.natural
              return (
                <li key={i} className={cn('space-y-1 px-3 py-2', nat === 20 && 'bg-green-500/10', nat === 1 && 'bg-red-500/10')} data-testid="batch-row">
                  <p className="font-medium">
                    {r.label}
                    {nat === 20 && <span className="ml-2 text-xs font-semibold text-green-700 dark:text-green-400">přirozená 20, kritický zásah</span>}
                    {nat === 1 && <span className="ml-2 text-xs font-semibold text-red-700 dark:text-red-400">přirozená 1</span>}
                  </p>
                  <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 text-sm">
                    {r.hit && (
                      <span>
                        <span className="text-muted-foreground">Zásah </span>
                        <Roll roll={r.hit} testId="batch-hit" />
                      </span>
                    )}
                    {r.damage && (
                      <span>
                        <span className="text-muted-foreground">Zranění </span>
                        <Roll roll={r.damage} testId="batch-damage" />
                      </span>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
          <p className="text-sm">
            Zranění celkem, kdyby zasáhlo vše: <strong data-testid="batch-total">{total}</strong>
          </p>
          {outcome.paid && <p className="text-sm text-muted-foreground">Odečteno: {outcome.paid}</p>}
          {outcome.hidden && (
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              <EyeOffIcon aria-hidden className="size-4 shrink-0" /> Skrytý hod: výsledky vidíš jen ty a DM.
            </p>
          )}
        </div>
      )}
    </Modal>
  )
}
