import { useEffect, useId, useState } from 'react'
import { cn } from '@/lib/utils'
import { DIE_EDGES, DIE_SHAPES, randomFace } from './dice-visual'

interface Props {
  sides: number
  /** Hozená hodnota; bez ní se kostka točí a čísla na ní blikají. */
  value?: number
  /** Zpoždění animace, ať se víc kostek netočí v jednom rytmu. */
  delay?: number
  sign?: 1 | -1
  tone?: 'normal' | 'crit' | 'fail' | 'dim'
  /** Menší kostka, když jich je v hodu hodně. */
  compact?: boolean
}

/** Jedna kostka jako SVG: točí se, dokud nepřijde výsledek ze serveru, pak dosedne na hozené číslo. */
export function DieFace({ sides, value, delay = 0, sign = 1, tone = 'normal', compact = false }: Props) {
  const gradient = useId()
  const rolling = value === undefined
  const [flicker, setFlicker] = useState(() => randomFace(sides))

  useEffect(() => {
    if (!rolling) return
    const timer = window.setInterval(() => setFlicker(randomFace(sides)), 80)
    return () => window.clearInterval(timer)
  }, [rolling, sides])

  const shape = DIE_SHAPES[sides]
  const edge = DIE_EDGES[sides]
  const shown = rolling ? flicker : value
  const fill = tone === 'crit' ? ['#16a34a', '#14532d'] : tone === 'fail' ? ['#dc2626', '#7f1d1d'] : ['var(--primary)', 'color-mix(in oklch, var(--primary) 55%, black)']

  return (
    <span
      data-die={sides}
      data-state={rolling ? 'rolling' : 'landed'}
      className={cn('relative inline-flex items-center justify-center', compact ? 'size-12 sm:size-14' : 'size-16 sm:size-20', tone === 'dim' && 'opacity-40')}
      style={{ animationDelay: `${delay}ms` }}
    >
      <svg
        viewBox="0 0 100 100"
        aria-hidden
        className={cn('size-full overflow-visible drop-shadow-md', rolling ? 'dice-anim animate-dice-roll' : 'dice-anim animate-dice-land', !rolling && tone === 'crit' && 'drop-shadow-[0_0_10px_rgb(34_197_94/0.9)]', !rolling && tone === 'fail' && 'animate-dice-shake drop-shadow-[0_0_10px_rgb(239_68_68/0.8)]')}
        style={{ animationDelay: `${delay}ms` }}
      >
        <defs>
          <linearGradient id={gradient} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={fill[0]} />
            <stop offset="100%" stopColor={fill[1]} />
          </linearGradient>
        </defs>
        {shape ? (
          <polygon points={shape} fill={`url(#${gradient})`} stroke="rgb(255 255 255 / 0.55)" strokeWidth="2.5" strokeLinejoin="round" />
        ) : sides === 6 ? (
          <rect x="7" y="7" width="86" height="86" rx="16" fill={`url(#${gradient})`} stroke="rgb(255 255 255 / 0.55)" strokeWidth="2.5" />
        ) : (
          <circle cx="50" cy="50" r="44" fill={`url(#${gradient})`} stroke="rgb(255 255 255 / 0.55)" strokeWidth="2.5" />
        )}
        {edge && <polygon points={edge} fill="none" stroke="rgb(255 255 255 / 0.28)" strokeWidth="2" strokeLinejoin="round" />}
        <text
          x="50"
          y={sides === 4 ? 66 : 50}
          textAnchor="middle"
          dominantBaseline="central"
          fill="white"
          fontWeight="700"
          fontSize={shown >= 100 ? 26 : shown >= 10 ? 34 : 42}
          style={{ fontFamily: 'var(--font-display)' }}
        >
          {shown}
        </text>
      </svg>
      {sign < 0 && !rolling && <span aria-hidden className="absolute -left-3 top-1/2 -translate-y-1/2 text-xl font-bold text-muted-foreground">−</span>}
    </span>
  )
}
