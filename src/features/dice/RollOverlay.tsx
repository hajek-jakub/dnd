import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { DicesIcon, RotateCcwIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { DiceRoll, RollAttempt } from './api'
import { DieFace } from './DieFace'
import { MAX_VISIBLE_DICE, placeholderDice, prefersReducedMotion } from './dice-visual'
import { modeLabel, naturalNote } from './format'
import { RollOverlayContext, type RollOverlayApi, type RollOverlayRequest } from './roll-overlay-context'

/** Nejkratší doba točení kostek: i když server odpoví hned, hod nevypadá jako blesk. */
const MIN_ROLL_MS = 950

interface State {
  token: number
  request: RollOverlayRequest
  roll: DiceRoll | null
  startedAt: number
}

/**
 * Okno s hodem kostkou: po kliknutí se hned roztočí kostky z výrazu, po odpovědi serveru dosednou na hozená čísla
 * a ukáže se součet s rozpisem (výhoda a nevýhoda ukážou oba hody). Hod ostatních se dál ukazuje jen jako toast.
 */
export function RollOverlayProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State | null>(null)
  const counter = useRef(0)
  const timers = useRef<number[]>([])

  const clearTimers = () => {
    timers.current.forEach((t) => window.clearTimeout(t))
    timers.current = []
  }
  useEffect(() => clearTimers, [])

  const api = useMemo<RollOverlayApi>(
    () => ({
      begin(request) {
        clearTimers()
        const token = ++counter.current
        setState({ token, request, roll: null, startedAt: Date.now() })
        return token
      },
      finish(token, roll) {
        // Krátké zavibrování na telefonu, když kostky dosednou (přirozená 20 a 1 mají vlastní vzor).
        if (typeof navigator.vibrate === 'function' && !prefersReducedMotion()) navigator.vibrate(roll.natural === 20 ? [30, 50, 30] : roll.natural === 1 ? [80] : 20)
        setState((s) => {
          if (!s || s.token !== token) return s
          const wait = prefersReducedMotion() ? 0 : Math.max(0, MIN_ROLL_MS - (Date.now() - s.startedAt))
          if (wait === 0) return { ...s, roll }
          timers.current.push(window.setTimeout(() => setState((cur) => (cur && cur.token === token ? { ...cur, roll } : cur)), wait))
          return s
        })
      },
      fail(token) {
        setState((s) => (s && s.token === token ? null : s))
      },
    }),
    [],
  )

  return (
    <RollOverlayContext.Provider value={api}>
      {children}
      {state && <RollDialog key={state.token} state={state} onClose={() => { clearTimers(); setState(null) }} />}
    </RollOverlayContext.Provider>
  )
}

function RollDialog({ state, onClose }: { state: State; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  const { request, roll } = state
  const note = roll ? naturalNote(roll) : null

  useEffect(() => {
    const dialog = ref.current
    if (dialog && !dialog.open) dialog.showModal()
  }, [])

  const again = useCallback(() => {
    onClose()
    request.again()
  }, [onClose, request])

  return (
    <dialog
      ref={ref}
      aria-label="Hod kostkou"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose() // klepnutí vedle zavře
      }}
      className={cn(
        'm-auto w-[calc(100%-1.5rem)] max-w-md overflow-hidden rounded-3xl border bg-card p-0 text-card-foreground shadow-2xl backdrop:bg-black/60 backdrop:backdrop-blur-sm',
        note === 'crit' && 'border-green-500 shadow-green-500/30',
        note === 'fail' && 'border-red-500 shadow-red-500/30',
      )}
    >
      <div className="space-y-5 bg-[radial-gradient(60%_40%_at_50%_0%,color-mix(in_oklch,var(--primary)_16%,transparent),transparent)] px-5 pb-5 pt-6 text-center">
        <header className="space-y-1">
          <p className="font-display text-xl font-semibold">{request.label || request.expression}</p>
          <p className="text-sm text-muted-foreground">
            {request.expression}
            {request.crit ? ' (kritický)' : ''}
            {request.mode !== 'normal' ? ` · ${modeLabel(request.mode)}` : ''}
            {request.hidden ? ' · skrytý hod' : ''}
          </p>
        </header>

        {roll ? <Result roll={roll} /> : <Rolling request={request} />}

        <div className="flex gap-2">
          <Button type="button" variant="outline" className="flex-1" onClick={again} disabled={!roll}>
            <RotateCcwIcon aria-hidden /> Hodit znovu
          </Button>
          <Button type="button" className="flex-1" onClick={onClose} autoFocus>
            Zavřít
          </Button>
        </div>
      </div>
    </dialog>
  )
}

function Rolling({ request }: { request: RollOverlayRequest }) {
  const { dice, more } = useMemo(() => placeholderDice(request.expression, request.crit), [request.expression, request.crit])
  const rows = request.mode === 'normal' ? 1 : 2
  return (
    <div role="status" aria-label="Kostky se točí" className="space-y-3 py-2">
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex flex-wrap items-center justify-center gap-3">
          {dice.map((d, i) => (
            <DieFace key={i} sides={d.sides} delay={(i + r * 2) * 90} compact={dice.length > 3} />
          ))}
          {more > 0 && <span className="text-sm text-muted-foreground">+ {more} dalších</span>}
        </div>
      ))}
      <p className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
        <DicesIcon aria-hidden className="size-4 animate-pulse" /> Házím…
      </p>
    </div>
  )
}

function Result({ roll }: { roll: DiceRoll }) {
  const note = naturalNote(roll)
  const multi = roll.attempts.length > 1
  return (
    <div className="space-y-4">
      <div className="space-y-3">
        {roll.attempts.map((attempt, i) => (
          <div key={i} data-testid="attempt" data-chosen={i === roll.chosen} className="space-y-1">
            {multi && (
              <p className="text-xs font-medium text-muted-foreground">
                Hod {i + 1}: {attempt.total}
                {i === roll.chosen ? ' · platí' : ' · zahozeno'}
              </p>
            )}
            <AttemptDice attempt={attempt} tone={i !== roll.chosen ? 'dim' : note === 'crit' ? 'crit' : note === 'fail' ? 'fail' : 'normal'} />
          </div>
        ))}
      </div>

      <div className="space-y-1">
        <Total value={roll.total} tone={note} />
        <p aria-live="polite" className="sr-only">
          {roll.label || roll.expression}: {roll.total}
        </p>
        {note === 'crit' && <p className="font-display text-lg font-semibold text-green-600 dark:text-green-400">Přirozená 20!</p>}
        {note === 'fail' && <p className="font-display text-lg font-semibold text-red-600 dark:text-red-400">Přirozená 1</p>}
        {roll.crit && <p className="text-sm font-medium text-green-700 dark:text-green-300">Kritický zásah: kostky jsou zdvojené</p>}
      </div>
    </div>
  )
}

/** Kostky jednoho hodu včetně konstant ("[12] + 7"). */
function AttemptDice({ attempt, tone }: { attempt: RollAttempt; tone: 'normal' | 'crit' | 'fail' | 'dim' }) {
  const compact = attempt.terms.reduce((n, t) => n + (t.rolls?.length ?? 0), 0) > 3
  let shown = 0
  let hidden = 0
  const parts: ReactNode[] = []
  attempt.terms.forEach((t, ti) => {
    if (t.rolls && t.sides) {
      for (const [ri, value] of t.rolls.entries()) {
        if (shown < MAX_VISIBLE_DICE) {
          shown++
          parts.push(<DieFace key={`${ti}-${ri}`} sides={t.sides} value={value} sign={t.sign} delay={(shown - 1) * 70} tone={tone} compact={compact} />)
        } else hidden++
      }
    } else if (t.constant !== undefined) {
      parts.push(
        <span key={`${ti}-c`} className="rounded-full bg-muted px-3 py-1 text-lg font-semibold tabular-nums">
          {t.sign < 0 ? '−' : '+'} {t.constant}
        </span>,
      )
    }
  })
  return (
    <div className="flex flex-wrap items-center justify-center gap-3">
      {parts}
      {hidden > 0 && <span className="text-sm text-muted-foreground">+ {hidden} dalších kostek</span>}
    </div>
  )
}

/** Součet se po dosednutí kostek krátce "dopočítá". */
function Total({ value, tone }: { value: number; tone: 'crit' | 'fail' | null }) {
  const [shown, setShown] = useState(() => (prefersReducedMotion() ? value : 0))
  useEffect(() => {
    if (prefersReducedMotion()) return
    const start = performance.now()
    let frame = 0
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / 550)
      setShown(Math.round(value * (1 - Math.pow(1 - progress, 3))))
      if (progress < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [value])
  return (
    <p
      data-testid="roll-result-total"
      data-total={value}
      className={cn('font-display text-7xl font-bold tabular-nums leading-none', tone === 'crit' && 'text-green-600 dark:text-green-400', tone === 'fail' && 'text-red-600 dark:text-red-400', tone === null && 'text-primary')}
    >
      {shown}
    </p>
  )
}
