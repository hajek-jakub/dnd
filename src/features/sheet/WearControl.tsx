import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useSheet } from './sheet-context'
import { Stepper } from './Stepper'
import type { CharacterItem } from './types'
import { wearHint } from './wear'

/** Počítadlo nat 1 sbalené do nenápadného řádku na konci karty; souhrn ukazuje stav, ovládání je po rozbalení. */
export function WearDetails({ item }: { item: CharacterItem }) {
  const nat1 = item.nat1 ?? 0
  const broken = item.broken ?? false
  const alert = broken || nat1 > 0
  return (
    <details className="group rounded-lg border border-dashed" data-testid="wear-details">
      <summary
        className={cn(
          'flex min-h-11 cursor-pointer items-center justify-between gap-2 px-3 text-xs text-muted-foreground',
          alert && 'font-medium text-red-700 dark:text-red-400',
        )}
      >
        <span>Opotřebení{broken ? ': rozbitá' : `: nat 1 ${nat1}`}</span>
        <span aria-hidden className="transition-transform group-open:rotate-180">
          ▾
        </span>
      </summary>
      <div className="border-t border-dashed px-3 py-2">
        <WearControl item={item} />
      </div>
    </details>
  )
}

/** Počítadlo nat 1: 0 je tmavé (zbraň v pořádku), 1–20 červené. Oprava číslo vynuluje a rozbitou zbraň spraví. */
export function WearControl({ item, compact = false }: { item: CharacterItem; compact?: boolean }) {
  const { canEdit, adjust } = useSheet()
  const nat1 = item.nat1 ?? 0
  const broken = item.broken ?? false
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2" data-testid="nat1">
      <span className="min-w-0 text-sm">
        <span className="block font-medium">Nat 1</span>
        {!compact && <span className={cn('block text-xs text-muted-foreground', broken && 'font-medium text-red-700 dark:text-red-400')}>{wearHint(nat1, broken)}</span>}
        {compact && broken && <span className="block text-xs font-medium text-red-700 dark:text-red-400">Rozbitá, hody jsou vypnuté</span>}
      </span>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        <Stepper
          label={`Nat 1 ${item.name}`}
          value={nat1}
          max={20}
          disabled={!canEdit}
          valueClassName={nat1 > 0 ? 'text-red-700 dark:text-red-400' : 'text-muted-foreground'}
          onDelta={(d) => adjust([{ op: 'nat1', itemId: item.id, delta: d }])}
        />
        {canEdit && (
          <>
            <Button variant="outline" disabled={broken} aria-label={`Rozbít ${item.name}`} onClick={() => adjust([{ op: 'break', itemId: item.id }])}>
              Rozbít
            </Button>
            <Button variant="outline" disabled={!broken && nat1 === 0} aria-label={`Opravit ${item.name}`} onClick={() => adjust([{ op: 'repair', itemId: item.id }])}>
              Opravit
            </Button>
          </>
        )}
      </div>
    </div>
  )
}
