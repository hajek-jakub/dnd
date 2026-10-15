import { EyeIcon, EyeOffIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { RollMode } from './api'
import { useRollSettings } from './roll-settings-context'

const MODES: { value: RollMode; label: string }[] = [
  { value: 'normal', label: 'Normálně' },
  { value: 'advantage', label: 'Výhoda' },
  { value: 'disadvantage', label: 'Nevýhoda' },
]

/** Přepínač výhody a nevýhody a skrytého hodu (společný pro celý web). */
export function RollModeSwitch({ className }: { className?: string }) {
  const { mode, setMode, hidden, setHidden } = useRollSettings()
  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      <div role="group" aria-label="Režim hodu" className="inline-flex gap-1">
        {MODES.map((m) => (
          <Button key={m.value} type="button" variant={mode === m.value ? 'default' : 'outline'} aria-pressed={mode === m.value} onClick={() => setMode(m.value)}>
            {m.label}
          </Button>
        ))}
      </div>
      <Button type="button" variant={hidden ? 'default' : 'outline'} aria-pressed={hidden} onClick={() => setHidden(!hidden)}>
        {hidden ? <EyeOffIcon aria-hidden /> : <EyeIcon aria-hidden />} Skrytý hod (vidí jen DM)
      </Button>
    </div>
  )
}
