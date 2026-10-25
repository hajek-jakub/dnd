import { useEffect, useRef, useState } from 'react'
import { CheckIcon } from 'lucide-react'
import { toast } from 'sonner'
import { ACCENT_PRESETS, accentHex } from '@/components/accent'
import { useTheme } from '@/components/theme-context'
import { useAuth } from '@/features/auth/auth-context'
import { cn } from '@/lib/utils'
import { useUpdateAccent } from './api'

/**
 * Barva aplikace pro přihlášeného uživatele (uloží se k účtu, platí na všech jeho zařízeních): předvolby ve stylu D&D
 * nebo libovolná vlastní barva. Světlost si aplikace upraví sama, aby byl text vždy čitelný.
 */
export function AccentPicker() {
  const { user } = useAuth()
  const { resolvedTheme, setAccent } = useTheme()
  const update = useUpdateAccent()
  const current = user?.accent ?? null
  const [custom, setCustom] = useState(current ?? '#2e7d32')
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])

  const save = (accent: string | null) =>
    update.mutate(accent, { onError: () => toast.error('Barvu se nepodařilo uložit.') })

  const isPreset = ACCENT_PRESETS.some((p) => p.hex === current)

  return (
    <fieldset className="space-y-3">
      <legend className="mb-2 text-sm font-medium">Barva aplikace</legend>
      <div role="group" aria-label="Barva aplikace" className="grid grid-cols-2 gap-2 tab:grid-cols-3">
        {ACCENT_PRESETS.map((p) => {
          const active = p.hex === current
          const swatch = p.hex ? accentHex(p.hex, resolvedTheme) : resolvedTheme === 'dark' ? '#f0605a' : '#a8221e'
          return (
            <button
              key={p.id}
              type="button"
              aria-pressed={active}
              onClick={() => save(p.hex)}
              className={cn('flex min-h-11 items-center gap-2 rounded-lg border px-2 py-1.5 text-left text-sm hover:bg-muted', active && 'border-primary ring-2 ring-primary/30')}
            >
              <span aria-hidden className="flex size-6 shrink-0 items-center justify-center rounded-full border border-black/10" style={{ background: swatch }}>
                {active && <CheckIcon className="size-4 text-white mix-blend-difference" />}
              </span>
              <span className="min-w-0">{p.label}</span>
            </button>
          )
        })}
      </div>
      <label className={cn('flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border px-3 py-1.5 text-sm hover:bg-muted', current && !isPreset && 'border-primary ring-2 ring-primary/30')}>
        <input
          type="color"
          aria-label="Vlastní barva"
          value={custom}
          onChange={(e) => {
            const v = e.target.value.toLowerCase()
            setCustom(v)
            setAccent(v)
            window.clearTimeout(timer.current)
            timer.current = window.setTimeout(() => save(v), 500)
          }}
          className="size-11 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0"
        />
        <span>
          Vlastní barva <span className="text-muted-foreground">({custom})</span>
          <span className="block text-xs text-muted-foreground">Odstín bude přesně tvůj, světlost aplikace upraví, aby šel číst text.</span>
        </span>
      </label>
      <p className="text-xs text-muted-foreground">Barva se uloží k tvému účtu, takže ji uvidíš na telefonu i na počítači. Ostatní hráči mají svou.</p>
    </fieldset>
  )
}
