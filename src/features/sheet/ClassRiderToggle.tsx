import { SwordsIcon } from 'lucide-react'
import type { DamageRiderInfo } from '@/engine'
import { Button } from '@/components/ui/button'
import { useClassToggle } from './class-toggles'
import { useSheet } from './sheet-context'

/** Přepínač přídavku ke zranění od třídy (Sneak Attack, ...): hráč ho zapne jen u zásahu, kde platí jeho podmínka. */
export function ClassRiderToggle({ rider }: { rider: DamageRiderInfo }) {
  const { character } = useSheet()
  const [on, toggle] = useClassToggle(character.id, rider.id)
  return (
    <Button
      type="button"
      data-testid={`rider-${rider.id}`}
      variant={on ? 'default' : 'outline'}
      aria-pressed={on}
      onClick={toggle}
      className="mb-3 h-auto min-h-11 w-full justify-start whitespace-normal py-2 text-left"
    >
      <SwordsIcon aria-hidden />
      <span>
        {rider.name}: ke zranění se přidá {rider.dice}
        <span className="block text-xs font-normal">{rider.note}</span>
      </span>
    </Button>
  )
}
