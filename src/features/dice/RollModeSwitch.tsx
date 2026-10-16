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
    <div className={cn('grid gap-2 sm:flex sm:flex-wrap sm:items-center', className)}>
      <div role="group" aria-label="Režim hodu" className="grid grid-cols-3 gap-1 sm:inline-flex">
        {MODES.map((m) => (
          <Button key={m.value} type="button" variant={mode === m.value ? 'default' : 'outline'} aria-pressed={mode === m.value} onClick={() => setMode(m.value)} className="px-2 sm:px-4">
            {m.label}
          </Button>
        ))}
      </div>
      <Button type="button" variant={hidden ? 'default' : 'outline'} aria-pressed={hidden} onClick={() => setHidden(!hidden)} className="w-full sm:w-auto">
        {hidden ? <EyeOffIcon aria-hidden /> : <EyeIcon aria-hidden />} Skrytý hod (vidí jen DM)
      </Button>
    </div>
  )
}
