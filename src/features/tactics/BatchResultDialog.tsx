import { useEffect, useMemo, useRef, useState } from 'react'
import { DicesIcon, EyeOffIcon, SwordsIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { BatchAttack, BatchResult, DiceRoll, RollMode } from '@/features/dice/api'
import { DieFace } from '@/features/dice/DieFace'
import { AttemptDice, CritDice } from '@/features/dice/RollOverlay'
import { placeholderDice, prefersReducedMotion } from '@/features/dice/dice-visual'
import { modeLabel, termText } from '@/features/dice/format'
import { Button } from '@/components/ui/button'

export interface BatchOutcome {
  /** Číslo série: nové použití okno vykreslí znovu (vynuluje zásahy a minutí). */
  token: number
  title: string
  attacks: BatchAttack[]
  mode: RollMode
  /** výsledky ze serveru; do té doby se kostky točí */
  results: BatchResult[] | null
  hidden: boolean
  /** co se zaplatilo a spotřebovalo, např. "1 ki, 2× Crossbow bolt" */
  paid: string
}

/** Kostky se točí aspoň takhle dlouho, i když server odpoví hned (stejně jako u jednoho hodu). */
const MIN_ROLL_MS = 950

/**
 * Výsledek série hodů z taktik ve stejném okně jako běžný hod: kostky se hned roztočí, po odpovědi dosednou.
 * U každého útoku zásah a zranění; přirozená 20 = kritický zásah (zranění je už hozené jako krit, krit kostky zlatě),
 * přirozená 1 = minutí. Zásah nebo minutí jde přepnout podle AC cíle a součet zranění počítá jen zásahy.
 */
export function BatchResultDialog({ outcome, onClose }: { outcome: BatchOutcome | null; onClose: () => void }) {
  if (!outcome) return null
  return <BatchDialog key={outcome.token} outcome={outcome} onClose={onClose} />
}

function BatchDialog({ outcome, onClose }: { outcome: BatchOutcome; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  const [startedAt] = useState(() => Date.now())
  const [shown, setShown] = useState<BatchResult[] | null>(null)
  const [missed, setMissed] = useState<Set<number> | null>(null)

  useEffect(() => {
    const dialog = ref.current
    if (dialog && !dialog.open) dialog.showModal()
  }, [])

  useEffect(() => {
    const results = outcome.results
    if (!results) return
    const reveal = () => {
      setShown(results)
      setMissed(new Set(results.flatMap((r, i) => (r.hit?.natural === 1 ? [i] : []))))
    }
    const wait = prefersReducedMotion() ? 0 : Math.max(0, MIN_ROLL_MS - (Date.now() - startedAt))
    if (wait === 0) {
      reveal()
      return
    }
    const timer = window.setTimeout(reveal, wait)
    return () => window.clearTimeout(timer)
  }, [outcome.results, startedAt])

  const total = shown?.reduce((n, r, i) => n + (missed?.has(i) ? 0 : (r.damage?.total ?? 0)), 0) ?? 0
  const hits = shown ? shown.filter((r, i) => r.hit && !missed?.has(i)).length : 0
  const withHit = shown ? shown.filter((r) => r.hit).length : 0
  const crits = shown?.filter((r) => r.crit).length ?? 0

  const toggle = (i: number) =>
    setMissed((m) => {
      const next = new Set(m)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })

  return (
    <dialog
      ref={ref}
      aria-label={`Hody: ${outcome.title}`}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose()
      }}
      className={cn(
        'm-auto max-h-[calc(100dvh-1.5rem)] w-[calc(100%-1.5rem)] max-w-lg overflow-hidden rounded-3xl border bg-card p-0 text-card-foreground shadow-2xl backdrop:bg-black/60 backdrop:backdrop-blur-sm',
        crits > 0 && 'border-2 border-amber-500 shadow-amber-500/40',
      )}
    >
      <div className="flex max-h-[calc(100dvh-1.5rem)] flex-col bg-[radial-gradient(60%_30%_at_50%_0%,color-mix(in_oklch,var(--primary)_16%,transparent),transparent)]">
        <header className="space-y-1 px-5 pt-6 text-center">
          {crits > 0 && (
            <p data-testid="crit-banner" className="mx-auto inline-flex items-center gap-2 rounded-full bg-amber-500 px-4 py-1 font-display text-sm font-bold uppercase tracking-wider text-black">
              <SwordsIcon aria-hidden className="size-4" /> {crits > 1 ? `${crits}× kritický zásah` : 'Kritický zásah'}
            </p>
          )}
          <p className="font-display text-xl font-semibold">{outcome.title}</p>
          <p className="text-sm text-muted-foreground">
            {outcome.attacks.length}× {outcome.attacks.length === 1 ? 'útok' : outcome.attacks.length < 5 ? 'útoky' : 'útoků'}
            {outcome.mode !== 'normal' ? ` · ${modeLabel(outcome.mode)} na zásah` : ''}
            {outcome.hidden ? ' · skrytý hod' : ''}
          </p>
        </header>

        <ul aria-label="Výsledky útoků" className="scroll-area mt-4 min-h-0 flex-1 space-y-2 overflow-y-auto px-4">
          {outcome.attacks.map((a, i) => {
            const r = shown?.[i]
            return r ? (
              <ResultRow key={i} result={r} missed={missed?.has(i) ?? false} onToggle={() => toggle(i)} />
            ) : (
              <RollingRow key={i} attack={a} index={i} mode={outcome.mode} />
            )
          })}
        </ul>

        <footer className="space-y-3 border-t px-5 pb-5 pt-4 text-center">
          {shown ? (
            <>
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Zranění celkem</p>
                <p data-testid="batch-total" data-total={total} className="font-display text-6xl font-bold leading-none tabular-nums text-primary">
                  {total}
                </p>
                <p aria-live="polite" className="mt-1 text-sm text-muted-foreground">
                  {withHit > 0 ? `Zásahy ${hits} z ${withHit}. Podle AC cíle klepni na Zasáhl / Minul.` : 'Kouzlo bez hodu na zásah (cíl hází záchranný hod).'}
                </p>
              </div>
              {outcome.paid && <p className="text-sm text-muted-foreground">Odečteno: {outcome.paid}</p>}
              {outcome.hidden && (
                <p className="flex items-center justify-center gap-1 text-xs text-muted-foreground">
                  <EyeOffIcon aria-hidden className="size-4 shrink-0" /> Skrytý hod: výsledky vidíš jen ty a DM.
                </p>
              )}
            </>
          ) : (
            <p role="status" className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <DicesIcon aria-hidden className="size-4 animate-pulse" /> Házím…
            </p>
          )}
          <Button type="button" className="w-full" onClick={onClose} autoFocus>
            Zavřít
          </Button>
        </footer>
      </div>
    </dialog>
  )
}

function RollingRow({ attack, index, mode }: { attack: BatchAttack; index: number; mode: RollMode }) {
  const hit = useMemo(() => (attack.toHit ? placeholderDice(attack.toHit, false, mode === 'normal' ? 1 : 2) : null), [attack.toHit, mode])
  const dmg = useMemo(() => (attack.damage ? placeholderDice(attack.damage, false, 4) : null), [attack.damage])
  return (
    <li className="space-y-2 rounded-2xl border bg-background/60 p-3" data-testid="batch-rolling">
      <p className="font-medium">{attack.label}</p>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        {hit && (
          <span className="flex items-center gap-2">
            {hit.dice.map((d, i) => (
              <DieFace key={i} sides={d.sides} delay={(index * 3 + i) * 80} mini />
            ))}
          </span>
        )}
        {dmg && (
          <span className="flex items-center gap-2">
            {dmg.dice.map((d, i) => (
              <DieFace key={i} sides={d.sides} delay={(index * 3 + i + 1) * 80} mini />
            ))}
          </span>
        )}
      </div>
    </li>
  )
}

function ResultRow({ result: r, missed, onToggle }: { result: BatchResult; missed: boolean; onToggle: () => void }) {
  const nat = r.hit?.natural
  return (
    <li
      data-testid="batch-row"
      data-crit={r.crit}
      data-missed={missed}
      className={cn(
        'space-y-2 rounded-2xl border p-3 transition-opacity',
        r.crit && 'border-2 border-amber-500 bg-amber-500/10',
        nat === 1 && 'border-red-500/60 bg-red-500/5',
        missed && 'opacity-55',
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 font-medium">
          {r.label}
          {r.crit && <span className="ml-2 rounded bg-amber-500 px-1.5 py-0.5 text-[0.7rem] font-bold uppercase text-black">Krit</span>}
          {nat === 1 && <span className="ml-2 text-xs font-semibold text-red-700 dark:text-red-400">přirozená 1, minutí</span>}
        </p>
        {r.hit && (
          <Button type="button" size="sm" variant={missed ? 'outline' : 'secondary'} aria-pressed={!missed} onClick={onToggle} aria-label={`${r.label}: ${missed ? 'minul, klepni pro zásah' : 'zasáhl, klepni pro minutí'}`}>
            {missed ? 'Minul' : 'Zasáhl'}
          </Button>
        )}
      </div>
      {r.hit && <RollLine label="Zásah" roll={r.hit} testId="batch-hit" tone={nat === 20 ? 'crit' : nat === 1 ? 'fail' : 'normal'} />}
      {r.damage && <RollLine label="Zranění" roll={r.damage} testId="batch-damage" tone="normal" struck={missed} />}
    </li>
  )
}

/** Jeden hod v řádku: kostky (u výhody a nevýhody i zahozený hod), krit kostky zlatě, součet a rozpis. */
function RollLine({ label, roll, testId, tone, struck = false }: { label: string; roll: DiceRoll; testId: string; tone: 'normal' | 'crit' | 'fail'; struck?: boolean }) {
  const chosen = roll.attempts[roll.chosen]
  return (
    <div data-testid={testId} className="space-y-1">
      <div className="flex items-center gap-3">
        <span className="w-16 shrink-0 text-xs text-muted-foreground">{label}</span>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          {roll.attempts.map((a, i) => (
            <AttemptDice key={i} attempt={a} tone={i === roll.chosen ? tone : 'dim'} mini />
          ))}
        </div>
        <strong className={cn('text-2xl tabular-nums', struck && 'text-muted-foreground line-through')}>{roll.total}</strong>
      </div>
      {chosen && <CritDice attempt={chosen} mini />}
      {chosen && (
        <p className="pl-[4.75rem] text-xs text-muted-foreground">
          {chosen.terms.map((t) => termText(t)).join(' · ')}
          {roll.attempts.length > 1 ? ` · ${modeLabel(roll.mode).toLowerCase()}` : ''}
        </p>
      )}
    </div>
  )
}
