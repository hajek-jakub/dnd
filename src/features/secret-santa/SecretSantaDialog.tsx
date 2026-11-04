import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { GiftIcon, XIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { lastDayLabel, useRevealSecretSanta, type SecretSantaDraw } from './api'
import { buildReel, landingOffset, WINNER_INDEX, type Rarity, type ReelCard } from './reel'

const CARD = 120
const SPIN_MS = 7500

// Barvy vzácnosti jako v CS:GO.
const RARITY: Record<Rarity, string> = {
  blue: '#4b69ff',
  purple: '#8847ff',
  pink: '#d32ce6',
  red: '#eb4b4b',
  gold: '#e4ae39',
}

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/** Krátké cvaknutí při přejetí karty pod ukazatelem (Web Audio, bez souborů). */
function useTicker() {
  const [ticker] = useState(createTicker)
  return ticker
}

function createTicker() {
  const ctx: { current: AudioContext | null } = { current: null }
  return {
    start() {
      try {
        ctx.current ??= new AudioContext()
        void ctx.current.resume()
      } catch {
        ctx.current = null
      }
    },
    tick(pitch = 1) {
      const ac = ctx.current
      if (!ac) return
      const osc = ac.createOscillator()
      const gain = ac.createGain()
      osc.type = 'square'
      osc.frequency.value = 1400 * pitch
      gain.gain.setValueAtTime(0.04, ac.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 0.03)
      osc.connect(gain).connect(ac.destination)
      osc.start()
      osc.stop(ac.currentTime + 0.04)
    },
    fanfare() {
      const ac = ctx.current
      if (!ac) return
      ;[523, 659, 784, 1047].forEach((f, i) => {
        const osc = ac.createOscillator()
        const gain = ac.createGain()
        const t = ac.currentTime + i * 0.11
        osc.type = 'triangle'
        osc.frequency.value = f
        gain.gain.setValueAtTime(0.0001, t)
        gain.gain.exponentialRampToValueAtTime(0.08, t + 0.02)
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.5)
        osc.connect(gain).connect(ac.destination)
        osc.start(t)
        osc.stop(t + 0.55)
      })
    },
  }
}

type Phase = 'intro' | 'spinning' | 'done'

/** Otevření „bedny“: pás jmen se roztočí, zpomalí a zastaví na tom, komu dávám dárek. */
export function SecretSantaDialog({ draw, open, onClose }: { draw: SecretSantaDraw; open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  const viewport = useRef<HTMLDivElement>(null)
  const strip = useRef<HTMLDivElement>(null)
  const reveal = useRevealSecretSanta()
  const ticker = useTicker()
  const [phase, setPhase] = useState<Phase>('intro')
  const [reel, setReel] = useState<ReelCard[] | null>(null)
  const [offset, setOffset] = useState<number | null>(null)
  const [receiver, setReceiver] = useState<string | null>(null)
  const quick = reducedMotion()

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  // Pás je vykreslený v pozici 0, teprve pak se nastaví cíl, aby přechod (transition) proběhl.
  useLayoutEffect(() => {
    if (phase !== 'spinning' || !reel || offset !== null || !viewport.current) return
    const width = viewport.current.clientWidth
    const target = landingOffset(CARD, width, Math.random() - 0.5)
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => setOffset(target)))
    return () => cancelAnimationFrame(raf)
  }, [phase, reel, offset])

  // Cvakání a vibrace při každé kartě, která projede pod ukazatelem.
  useEffect(() => {
    if (phase !== 'spinning' || offset === null || quick) return
    let last = -1
    let raf = 0
    const loop = () => {
      const s = strip.current
      const v = viewport.current
      if (s && v) {
        const pos = v.getBoundingClientRect().left - s.getBoundingClientRect().left + v.clientWidth / 2
        const index = Math.floor(pos / CARD)
        if (index !== last) {
          if (last !== -1) {
            ticker.tick(index >= WINNER_INDEX - 3 ? 1.25 : 1)
            navigator.vibrate?.(4)
          }
          last = index
        }
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [phase, offset, quick, ticker])

  function openCase() {
    ticker.start()
    reveal.mutate(draw.id, {
      onSuccess: (d) => {
        if (!d.receiver) return
        setReceiver(d.receiver)
        setReel(buildReel(d.names, d.receiver))
        setOffset(null)
        setPhase('spinning')
      },
      onError: () => toast.error('Losování se nepodařilo načíst, zkus to znovu'),
    })
  }

  function finish() {
    if (phase !== 'spinning') return
    setPhase('done')
    ticker.fanfare()
    navigator.vibrate?.([30, 40, 80])
  }

  return (
    <dialog
      ref={ref}
      aria-label={draw.title}
      onCancel={(e) => {
        if (phase === 'spinning') e.preventDefault()
      }}
      onClose={onClose}
      data-testid="secret-santa-dialog"
      className="m-auto w-[calc(100%-1rem)] max-w-2xl overflow-hidden rounded-2xl border border-[#e4ae39]/50 bg-zinc-950 p-0 text-white shadow-2xl backdrop:bg-black/70"
    >
      {open && (
        <div className="relative overflow-hidden p-5">
          <Snow />
          <div className="relative flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-[#e4ae39]">{draw.campaignName}</p>
              <h2 className="font-display text-2xl font-bold">🎅 {draw.title}</h2>
            </div>
            {phase !== 'spinning' && (
              <Button variant="ghost" size="icon" aria-label="Zavřít" className="text-white hover:bg-white/10 hover:text-white" onClick={() => ref.current?.close()}>
                <XIcon aria-hidden />
              </Button>
            )}
          </div>

          {phase === 'intro' && (
            <div className="relative flex flex-col items-center gap-4 py-6 text-center">
              <div className="santa-anim animate-santa-bob text-8xl drop-shadow-[0_0_30px_rgba(228,174,57,0.55)]" aria-hidden>
                🎁
              </div>
              <p className="text-lg">
                {draw.me}, komu letos dáš dárek ty?
              </p>
              <p className="max-w-sm text-sm text-white/70">Losování je tajné: kdo komu dává, ví jen dárce. Nikdo nemá sám sebe a každý dostane dárek právě od jednoho.</p>
              <Button
                size="lg"
                onClick={openCase}
                disabled={reveal.isPending}
                className="min-w-56 bg-[#e4ae39] text-base font-bold text-zinc-950 shadow-[0_0_24px_rgba(228,174,57,0.5)] hover:bg-[#f0c25a]"
              >
                <GiftIcon aria-hidden /> {draw.revealed ? 'Otevřít bednu znovu' : 'Otevřít bednu'}
              </Button>
            </div>
          )}

          {phase !== 'intro' && reel && (
            <div className="relative mt-5">
              <div ref={viewport} aria-hidden className="relative h-40 overflow-hidden rounded-xl border border-white/10 bg-zinc-900">
                <div
                  ref={strip}
                  className="absolute left-0 top-0 flex h-full items-center"
                  style={{
                    transform: `translate3d(${-(offset ?? 0)}px, 0, 0)`,
                    transition: offset === null ? 'none' : `transform ${quick ? 800 : SPIN_MS}ms cubic-bezier(0.1, 0.75, 0.12, 1)`,
                  }}
                  onTransitionEnd={finish}
                >
                  {reel.map((card, i) => (
                    <ReelItem key={i} card={card} win={phase === 'done' && i === WINNER_INDEX} dim={phase === 'done' && i !== WINNER_INDEX} />
                  ))}
                </div>
                {/* ukazatel */}
                <div className="pointer-events-none absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-[#e4ae39] shadow-[0_0_12px_#e4ae39]" />
                <div className="pointer-events-none absolute left-1/2 top-0 size-0 -translate-x-1/2 border-x-8 border-t-[10px] border-x-transparent border-t-[#e4ae39]" />
                <div className="pointer-events-none absolute bottom-0 left-1/2 size-0 -translate-x-1/2 border-x-8 border-b-[10px] border-x-transparent border-b-[#e4ae39]" />
                <div className="pointer-events-none absolute inset-y-0 left-0 w-16 bg-gradient-to-r from-zinc-950 to-transparent" />
                <div className="pointer-events-none absolute inset-y-0 right-0 w-16 bg-gradient-to-l from-zinc-950 to-transparent" />
              </div>

              <div role="status" className="flex min-h-40 flex-col items-center justify-center gap-2 pt-5 text-center">
                {phase === 'spinning' && <p className="animate-pulse text-white/70">Losuje se…</p>}
                {phase === 'done' && receiver && (
                  <>
                    {!quick && <Confetti />}
                    <p className="santa-anim animate-santa-pop text-sm uppercase tracking-[0.25em] text-white/70">Dárek dáváš</p>
                    <p data-testid="secret-santa-receiver" className="santa-anim animate-santa-pop font-display text-4xl font-bold text-[#e4ae39] drop-shadow-[0_0_18px_rgba(228,174,57,0.6)]">
                      {receiver}
                    </p>
                    <p className="text-sm text-white/70">Psst, nikomu to neprozraď. Najdeš to na úvodní stránce kampaně až do {lastDayLabel(draw.visibleUntil)}.</p>
                    <Button className="mt-2 min-w-40 bg-[#e4ae39] font-bold text-zinc-950 hover:bg-[#f0c25a]" onClick={() => ref.current?.close()}>
                      Hotovo
                    </Button>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </dialog>
  )
}

function ReelItem({ card, win, dim }: { card: ReelCard; win: boolean; dim: boolean }) {
  const color = RARITY[card.rarity]
  return (
    <div className="shrink-0 px-1" style={{ width: CARD }}>
      <div
        className={cn('flex h-32 flex-col items-center justify-center gap-2 rounded-lg border-b-4 px-1 transition-all duration-500', win && 'santa-anim animate-santa-win', dim && 'opacity-30')}
        style={{ borderColor: color, background: `linear-gradient(180deg, #27272a 0%, ${color}55 100%)`, boxShadow: win ? `0 0 28px ${color}` : undefined }}
      >
        <span className="text-4xl" aria-hidden>
          🎁
        </span>
        <span className="w-full truncate text-center text-sm font-semibold">{card.name}</span>
      </div>
    </div>
  )
}

function Snow() {
  const [flakes] = useState(() =>
    Array.from({ length: 18 }, (_, i) => ({ left: `${(i * 37) % 100}%`, delay: `${-(i * 0.7) % 8}s`, duration: `${6 + (i % 5)}s`, size: `${10 + (i % 3) * 4}px` })),
  )
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      {flakes.map((f, i) => (
        <span key={i} className="santa-anim absolute -top-4 animate-santa-snow text-white/40" style={{ left: f.left, animationDelay: f.delay, animationDuration: f.duration, fontSize: f.size }}>
          ❄
        </span>
      ))}
    </div>
  )
}

function Confetti() {
  const [pieces] = useState(() =>
    Array.from({ length: 48 }, (_, i) => {
      const angle = (i / 48) * Math.PI * 2
      const dist = 120 + Math.random() * 160
      return {
        style: {
          '--x': `${Math.cos(angle) * dist}px`,
          '--y': `${Math.sin(angle) * dist - 60}px`,
          '--r': `${Math.random() * 720 - 360}deg`,
          background: Object.values(RARITY)[i % 5],
          animationDelay: `${Math.random() * 0.15}s`,
        } as CSSProperties,
      }
    }),
  )
  return (
    <div aria-hidden className="pointer-events-none absolute left-1/2 top-24 size-0">
      {pieces.map((p, i) => (
        <span key={i} className="santa-anim absolute h-3 w-1.5 animate-santa-confetti rounded-sm" style={p.style} />
      ))}
    </div>
  )
}
