import { Button } from '@/components/ui/button'
import { CoinFields } from './CoinFields'
import type { Coin } from './money'

export type PriceMode = 'found' | 'sale'

/**
 * Nalezené, nebo koupené: nalezenou věc postava dostane zdarma, u koupené (obchod) zaplatí cenu při předání.
 * Cena je za celou položku (všechny kusy); bez zadané ceny se u itemu z pravidel použije cena z pravidel.
 */
export function PriceFields({
  idPrefix,
  mode,
  onMode,
  values,
  onValues,
}: {
  idPrefix: string
  mode: PriceMode
  onMode: (mode: PriceMode) => void
  values: Record<Coin, string>
  onValues: (values: Record<Coin, string>) => void
}) {
  return (
    <fieldset className="space-y-3 rounded-lg border p-3">
      <legend className="px-1 text-sm font-medium">Nalezené, nebo koupené?</legend>
      <div role="group" aria-label="Jak item postava získá" className="grid grid-cols-2 gap-2">
        <Button type="button" aria-pressed={mode === 'found'} variant={mode === 'found' ? 'default' : 'outline'} onClick={() => onMode('found')}>
          Nalezené
        </Button>
        <Button type="button" aria-pressed={mode === 'sale'} variant={mode === 'sale' ? 'default' : 'outline'} onClick={() => onMode('sale')}>
          Kupuje
        </Button>
      </div>
      {mode === 'sale' ? (
        <>
          <CoinFields idPrefix={idPrefix} values={values} onChange={(c, v) => onValues({ ...values, [c]: v })} />
          <p className="text-xs text-muted-foreground">
            Cena za celou položku (všechny kusy); postava ji při předání zaplatí, a když nemá dost, nic se neprodá. Bez zadané ceny se u itemu z pravidel vezme cena z pravidel.
          </p>
        </>
      ) : (
        <p className="text-xs text-muted-foreground">Nalezenou věc postava dostane zdarma.</p>
      )}
    </fieldset>
  )
}
