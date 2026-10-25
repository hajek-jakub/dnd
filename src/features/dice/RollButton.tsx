import { DicesIcon } from 'lucide-react'
import type { AbilityKey } from '@/engine'
import { useSheet } from '@/features/sheet/sheet-context'
import { cn } from '@/lib/utils'
import { useRoller } from './useRoller'

/** Který druh hodu to je: stavy (Poisoned, Exhaustion, ...) k němu přidají výhodu nebo nevýhodu. `{ check }` = zkouška dané vlastnosti (dovednost patří ke své vlastnosti; Rage dává výhodu na STR), `{ save }` = záchranný hod na danou vlastnost. */
export type RollKind = 'attack' | 'check' | { check: AbilityKey } | { save: AbilityKey }

/** Malé tlačítko s kostkou: hodí `expression` za aktuální postavu (jen pro majitele a DM). Režim bere z nastavení hodu a ze stavů postavy. */
export function RollButton({
  label,
  expression,
  crit,
  critExtra,
  text,
  className,
  initiative,
  kind,
}: {
  label: string
  expression: string
  crit?: boolean
  /** Kostky navíc při kritu (Brutal Critical), nezdvojují se. */
  critExtra?: string
  text?: string
  className?: string
  initiative?: boolean
  kind?: RollKind
}) {
  const { character, canEdit, sheet } = useSheet()
  const { roll, pending } = useRoller(character.campaignId, character.id)
  if (!canEdit) return null
  const info =
    kind === undefined
      ? null
      : kind === 'attack'
        ? sheet.conditions.attack
        : kind === 'check'
          ? sheet.conditions.check
          : 'check' in kind
            ? sheet.conditions.checks[kind.check]
            : sheet.conditions.saves[kind.save]
  const conditionMode = info?.mode ?? 'normal'
  // Výhoda a nevýhoda patří jen k hodům k20 (útok, zkouška, záchrana, iniciativa); zranění se hází vždy jednou.
  const d20 = kind !== undefined || initiative === true || /d20(?!\d)/i.test(expression)
  const note =
    info && info.sources.length > 0
      ? conditionMode === 'normal'
        ? `výhoda a nevýhoda se ruší (${info.sources.join(', ')})`
        : `${conditionMode === 'disadvantage' ? 'nevýhoda' : 'výhoda'} kvůli stavu ${info.sources.join(', ')}`
      : ''
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => roll(label, expression, { crit, critExtra, initiative, conditionMode, ...(d20 ? {} : { mode: 'normal' as const }) })}
      aria-label={`Hodit: ${label}${crit ? ' (kritický)' : ''} (${expression}${crit && critExtra ? ` + ${critExtra}` : ''})${note ? `, ${note}` : ''}`}
      title={`Hodit ${expression}${note ? ` – ${note}` : ''}`}
      className={cn(
        'relative inline-flex size-11 shrink-0 items-center justify-center gap-1 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50',
        text && 'w-auto px-2 text-xs',
        className,
      )}
    >
      <DicesIcon aria-hidden className="size-4" />
      {text}
      {conditionMode !== 'normal' && (
        <span
          aria-hidden
          data-testid="condition-mode"
          className={cn('absolute top-1 right-1 size-2.5 rounded-full ring-2 ring-background', conditionMode === 'disadvantage' ? 'bg-red-600' : 'bg-green-600')}
        />
      )}
    </button>
  )
}
