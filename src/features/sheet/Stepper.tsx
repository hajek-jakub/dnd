import { MinusIcon, PlusIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'

/** Velké tlačítka −/+ pro rychlé klikání u stolu (HP, sloty, ki). */
export function Stepper({
  label,
  value,
  max,
  onDelta,
  disabled,
  minusLabel,
  plusLabel,
}: {
  label: string
  value: number
  max?: number
  onDelta: (delta: number) => void
  disabled?: boolean
  minusLabel?: string
  plusLabel?: string
}) {
  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="size-12"
        aria-label={minusLabel ?? `${label}: −1`}
        disabled={disabled || value <= 0}
        onClick={() => onDelta(-1)}
      >
        <MinusIcon aria-hidden className="size-5" />
      </Button>
      <span
        className="min-w-14 text-center text-xl font-semibold tabular-nums"
        role="status"
        aria-label={`${label}: ${value}${max !== undefined ? ` z ${max}` : ''}`}
      >
        {value}
        {max !== undefined && <span className="text-base font-normal text-muted-foreground">/{max}</span>}
      </span>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="size-12"
        aria-label={plusLabel ?? `${label}: +1`}
        disabled={disabled || (max !== undefined && value >= max)}
        onClick={() => onDelta(1)}
      >
        <PlusIcon aria-hidden className="size-5" />
      </Button>
    </div>
  )
}
