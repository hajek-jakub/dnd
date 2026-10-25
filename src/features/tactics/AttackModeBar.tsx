import { EyeIcon, EyeOffIcon } from 'lucide-react'
import { combineMode } from '@/engine'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import type { RollMode } from '@/features/dice/api'
import { useRollSettings } from '@/features/dice/roll-settings-context'
import { useSheet } from '@/features/sheet/sheet-context'
import { cn } from '@/lib/utils'

const MODES: { value: RollMode; label: string }[] = [
  { value: 'normal', label: 'Normálně' },
  { value: 'advantage', label: 'Výhoda' },
  { value: 'disadvantage', label: 'Nevýhoda' },
]

const WORD: Record<RollMode, string> = { normal: 'normálně', advantage: 's výhodou', disadvantage: 's nevýhodou' }

/**
 * Výhoda a nevýhoda pro hody z taktik: platí jen na hod na zásah (2× k20, platí vyšší / nižší), zranění se hází jednou.
 * Kritický zásah je jen přirozená 20 na kostce, která platí. Stav postavy (Poisoned, Invisible, ...) se přidá sám
 * a výhoda s nevýhodou se ruší, ať je jich kolik chce. Nastavení je společné s přehledem sheetu a panelem kostek.
 */
export function AttackModeBar() {
  const { sheet } = useSheet()
  const { mode, setMode, hidden, setHidden } = useRollSettings()
  const condition = sheet.conditions.attack
  const effective = combineMode(mode, condition.mode)
  return (
    <Card size="sm" data-testid="attack-mode">
      <CardContent className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">Hod na zásah</span>
          <div role="group" aria-label="Hod na zásah" className="grid flex-1 grid-cols-3 gap-1 sm:flex-none">
            {MODES.map((m) => (
              <Button
                key={m.value}
                type="button"
                variant={mode === m.value ? 'default' : 'outline'}
                aria-pressed={mode === m.value}
                onClick={() => setMode(m.value)}
                className={cn('px-2 sm:px-4', mode === m.value && m.value === 'advantage' && 'bg-green-700 text-white hover:bg-green-700/90', mode === m.value && m.value === 'disadvantage' && 'bg-red-700 text-white hover:bg-red-700/90')}
              >
                {m.label}
              </Button>
            ))}
          </div>
          <Button type="button" variant={hidden ? 'default' : 'outline'} aria-pressed={hidden} onClick={() => setHidden(!hidden)} className="w-full sm:w-auto">
            {hidden ? <EyeOffIcon aria-hidden /> : <EyeIcon aria-hidden />} Skrytý hod
          </Button>
        </div>
        <p className="text-xs text-muted-foreground" role="status" data-testid="attack-mode-effective">
          {condition.sources.length > 0 && (
            <>
              Stav {condition.sources.join(', ')}: {condition.mode === 'normal' ? 'výhoda a nevýhoda se ruší' : condition.mode === 'advantage' ? 'výhoda' : 'nevýhoda'}.{' '}
            </>
          )}
          Útoky se hodí <strong className="text-foreground">{WORD[effective]}</strong>
          {effective !== 'normal' ? ' (2× k20, platí ' + (effective === 'advantage' ? 'vyšší' : 'nižší') + '; krit jen při 20 na té, která platí)' : ''}. Zranění se hází vždy jednou.
          {mode !== 'normal' && condition.mode !== 'normal' && mode !== condition.mode ? ' Výhoda a nevýhoda se navzájem ruší.' : ''}
        </p>
      </CardContent>
    </Card>
  )
}
