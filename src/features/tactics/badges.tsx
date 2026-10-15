import { cn } from '@/lib/utils'
import { useSheet } from '@/features/sheet/sheet-context'
import { availability, formatCost, parseCost } from './cost'
import { ACTION_LABELS, type ActionType } from './types'

const BASE = 'inline-flex min-h-6 items-center rounded-full border px-2 text-xs font-medium'

const ACTION_STYLE: Record<ActionType, string> = {
  action: 'border-border text-foreground',
  bonus: 'border-amber-600 text-amber-800 dark:text-amber-300',
  reaction: 'border-sky-600 text-sky-800 dark:text-sky-300',
  free: 'border-border text-muted-foreground',
  none: 'border-border text-muted-foreground',
}

/** Typ akce: akce, bonusová akce, reakce, zdarma. */
export function ActionBadge({ type }: { type: ActionType }) {
  return <span className={cn(BASE, ACTION_STYLE[type])}>{ACTION_LABELS[type]}</span>
}

/**
 * Cena: ki tmavě, spell slot červeně, zdarma obrysem. Když ki nebo slot nestačí, štítek zešedne a je přeškrtnutý
 * (a čtečka si přečte i důvod), takže je na první pohled vidět, co si zrovna nemůžeš dovolit.
 */
export function CostBadge({ cost }: { cost: string }) {
  const { sheet } = useSheet()
  const parsed = parseCost(cost)
  const avail = availability(parsed, sheet)
  const style =
    parsed.type === 'free'
      ? 'border-border text-foreground'
      : !avail.ok
        ? 'border-dashed border-border bg-muted text-muted-foreground line-through'
        : parsed.type === 'ki'
          ? 'border-foreground bg-foreground text-background'
          : 'border-red-700 bg-red-700 text-white'
  return (
    <span className={cn(BASE, style)} data-cost={parsed.type} data-available={avail.ok} title={avail.detail}>
      <span className="sr-only">Cena: </span>
      {formatCost(cost)}
      {parsed.type !== 'free' && <span className="sr-only"> ({avail.detail})</span>}
    </span>
  )
}

export function Badge({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn(BASE, 'border-border text-muted-foreground', className)}>{children}</span>
}
