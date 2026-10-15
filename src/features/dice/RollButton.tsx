import { DicesIcon } from 'lucide-react'
import { useSheet } from '@/features/sheet/sheet-context'
import { cn } from '@/lib/utils'
import { useRoller } from './useRoller'

/** Malé tlačítko s kostkou: hodí `expression` za aktuální postavu (jen pro majitele a DM). Režim bere z nastavení hodu. */
export function RollButton({ label, expression, crit, text, className }: { label: string; expression: string; crit?: boolean; text?: string; className?: string }) {
  const { character, canEdit } = useSheet()
  const { roll, pending } = useRoller(character.campaignId, character.id)
  if (!canEdit) return null
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => roll(label, expression, { crit })}
      aria-label={`Hodit: ${label}${crit ? ' (kritický)' : ''} (${expression})`}
      title={`Hodit ${expression}`}
      className={cn('inline-flex size-11 shrink-0 items-center justify-center gap-1 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50', text && 'w-auto px-2 text-xs', className)}
    >
      <DicesIcon aria-hidden className="size-4" />
      {text}
    </button>
  )
}
