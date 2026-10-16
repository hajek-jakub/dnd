import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { COINS, COIN_LABELS, type Coin } from './money'

/** Pět políček na mince (pp až cp) pro zadání částky; prázdné políčko = 0. */
export function CoinFields({ idPrefix, values, onChange }: { idPrefix: string; values: Record<Coin, string>; onChange: (coin: Coin, value: string) => void }) {
  return (
    <div className="grid grid-cols-5 gap-2">
      {COINS.map((c) => (
        <div key={c} className="space-y-1">
          <Label htmlFor={`${idPrefix}-${c}`} title={COIN_LABELS[c]}>
            {c.toUpperCase()}
          </Label>
          <Input id={`${idPrefix}-${c}`} type="number" inputMode="numeric" min={0} value={values[c]} onChange={(e) => onChange(c, e.target.value)} className="px-2" />
        </div>
      ))}
    </div>
  )
}
