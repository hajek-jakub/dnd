import { Button } from '@/components/ui/button'
import { rechargeLabel, useRecharge, type ItemWithCharges } from './charges'
import { useSheet } from './sheet-context'
import { Stepper } from './Stepper'

/** Počítadlo nábojů itemu (Wand of Wonder 5/7): −/+ jako u slotů a tlačítko Dobít podle obnovy itemu. */
export function ItemChargesControl({ item, label = 'Náboje' }: { item: ItemWithCharges; label?: string }) {
  const { character, canEdit, adjust } = useSheet()
  const { recharge, pending } = useRecharge(character.id)
  const { max, used } = item.charges
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1" data-testid="item-charges">
      <span className="min-w-0 text-sm">
        <span className="block">{label}</span>
        <span className="block text-xs text-muted-foreground">{rechargeLabel(item.charges.recharge)}</span>
      </span>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        <Stepper
          label={`Náboje ${item.name}`}
          value={max - used}
          max={max}
          disabled={!canEdit}
          minusLabel={`Použít náboj: ${item.name}`}
          plusLabel={`Vrátit náboj: ${item.name}`}
          onDelta={(d) => adjust([{ op: 'charges', itemId: item.id, delta: d }])}
        />
        {canEdit && item.charges.recharge !== null && (
          <Button variant="outline" disabled={used === 0 || pending} aria-label={`Dobít ${item.name}`} onClick={() => recharge([item.id])}>
            Dobít
          </Button>
        )}
      </div>
    </div>
  )
}
