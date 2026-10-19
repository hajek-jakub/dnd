import { useState, type ReactNode } from 'react'
import { ArrowLeftIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import type { RuleSummary } from '@/lib/types'
import { useRule, useRuleOptions, useRules } from '@/features/rules/api'
import { metaLine } from '@/features/rules/labels'
import type { ItemInput } from './api'
import { ItemForm } from './ItemForm'

/** Magická zbroj nebo zbraň z pravidel potřebuje základ (Armor, +1 na Chain Mail), jinak by se nepočítala do AC ani útoků. */
const needsBase = (e: RuleSummary) => e.kind === 'magic_item' && /^(armor|weapon)/i.test(e.category ?? '')

/**
 * Výběr itemu: z pravidel (SRD a homebrew kampaně) s počtem kusů, nebo vlastní přes formulář (druh, tučný popis, u DM i kletba).
 * U magické zbroje a zbraně se před přidáním vybere základ (u Dwarven Plate je předvybraný). Používá ho přidání do inventáře,
 * rozdávání itemu DM i dílna lootu, `onPick` dostane hotový vstup itemu.
 */
export function ItemSourcePicker({
  campaignId,
  onPick,
  pending,
  pickLabel,
  submitLabel,
  dm = false,
  note,
  customTabLabel = 'Vlastní item',
}: {
  campaignId: string
  /** `rule` je záznam pravidel, když item pochází z nich (např. kvůli ceně). */
  onPick: (item: ItemInput, label: string, rule?: RuleSummary) => void
  pending: boolean
  /** Text tlačítka u položky z pravidel (např. „Dát“, „Přidat“). */
  pickLabel: string
  /** Text tlačítka ve formuláři vlastního itemu. */
  submitLabel: string
  /** DM: formulář vlastního itemu nabídne kletbu. */
  dm?: boolean
  /** Poznámka pod seznamem pravidel. */
  note?: ReactNode
  customTabLabel?: string
}) {
  const [tab, setTab] = useState<'rules' | 'custom'>('rules')
  const [q, setQ] = useState('')
  const [kind, setKind] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [baseFor, setBaseFor] = useState<RuleSummary | null>(null)
  const kinds = kind === '' ? ['weapon', 'armor', 'equipment', 'magic_item'] : kind.split(',')
  const rules = useRules({ kinds, q: q.trim() || undefined, campaignId })
  const entries = rules.data?.pages.flatMap((p) => p.entries) ?? []
  const qty = Math.max(1, Number.parseInt(quantity, 10) || 1)

  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="Zdroj itemu" className="grid grid-cols-2 gap-2">
        {(
          [
            ['rules', 'Z pravidel'],
            ['custom', customTabLabel],
          ] as const
        ).map(([id, label]) => (
          <Button key={id} type="button" role="tab" aria-selected={tab === id} variant={tab === id ? 'default' : 'outline'} onClick={() => setTab(id)}>
            {label}
          </Button>
        ))}
      </div>

      {tab === 'custom' ? (
        <ItemForm dm={dm} pending={pending} submitLabel={submitLabel} onSubmit={(input) => onPick(input, input.name ?? 'item')} />
      ) : baseFor ? (
        <BaseStep
          entry={baseFor}
          campaignId={campaignId}
          pending={pending}
          pickLabel={pickLabel}
          onBack={() => setBaseFor(null)}
          onPick={(baseRuleId, label) => {
            onPick({ ruleId: baseFor.id, quantity: qty, ...(baseRuleId ? { baseRuleId } : {}) }, label, baseFor)
            setBaseFor(null) // zpátky na seznam, ať jde přidat další
          }}
        />
      ) : (
        <div className="space-y-3">
          <Input type="search" aria-label="Hledat item" placeholder="Hledat podle názvu…" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="grid grid-cols-[minmax(0,1fr)_6rem] gap-2">
            <NativeSelect aria-label="Druh itemu" value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="">Všechno</option>
              <option value="weapon">Zbraně</option>
              <option value="armor">Zbroje a štíty</option>
              <option value="equipment">Vybavení</option>
              <option value="magic_item">Magické itemy</option>
            </NativeSelect>
            <Input aria-label="Počet kusů" type="number" min={1} max={9999} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          </div>
          {/* SRD prodává munici v balení; server pak zapíše skutečný počet kusů (2 balení Arrow = 40 šípů). */}
          {(kind === '' || kind === 'equipment') && <p className="text-xs text-muted-foreground">U munice v balení (Arrow, Crossbow bolt, Sling bullet po 20, Blowgun needle po 50) je počet kusů počtem balení.</p>}
          <ul className="scroll-area max-h-[40dvh] space-y-2 pr-2">
            {entries.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-2 rounded-lg border p-2">
                <span className="min-w-0">
                  <span className="block truncate font-medium">{e.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{metaLine(e)}</span>
                </span>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={pending}
                  aria-label={`${pickLabel} ${e.name}`}
                  onClick={() => (needsBase(e) ? setBaseFor(e) : onPick({ ruleId: e.id, quantity: qty }, e.name, e))}
                >
                  {pickLabel}
                </Button>
              </li>
            ))}
            {!rules.isPending && entries.length === 0 && <li className="text-sm text-muted-foreground">Nic nenalezeno.</li>}
          </ul>
          {rules.hasNextPage && (
            <Button type="button" variant="outline" className="w-full" onClick={() => void rules.fetchNextPage()}>
              Načíst další
            </Button>
          )}
          {note && <p className="text-xs text-muted-foreground">{note}</p>}
        </div>
      )}
    </div>
  )
}

/** Krok „na čem je“ magická zbroj nebo zbraň: základ z popisu je předvybraný (Dwarven Plate → Plate Armor), obecný (Armor, +1) se vybere. */
function BaseStep({
  entry,
  campaignId,
  pending,
  pickLabel,
  onBack,
  onPick,
}: {
  entry: RuleSummary
  campaignId: string
  pending: boolean
  pickLabel: string
  onBack: () => void
  onPick: (baseRuleId: string | null, label: string) => void
}) {
  const detail = useRule(entry.id)
  const base = detail.data?.itemBase ?? null
  const options = useRuleOptions(base?.type === 'weapon' ? 'weapon' : 'armor', campaignId, base !== null)
  // Štít je mezi zbrojemi jediný se „Shield“ v názvu (homebrew zbroje neexistují); server základ stejně ověří.
  const list = (options.data ?? []).filter((o) => (base?.type === 'weapon' ? true : base?.type === 'shield' ? /shield/i.test(o.name) : !/shield/i.test(o.name)))
  const [choice, setChoice] = useState('')
  const selected = choice || base?.baseRuleId || ''
  const selectedName = list.find((o) => o.id === selected)?.name
  const what = base?.type === 'weapon' ? 'Základní zbraň' : base?.type === 'shield' ? 'Štít' : 'Základní zbroj'

  return (
    <div className="space-y-3 rounded-lg border p-3" data-testid="item-base-step">
      <p className="font-medium">{entry.name}</p>
      {detail.isPending ? (
        <p role="status" className="text-sm text-muted-foreground">
          Načítám…
        </p>
      ) : base ? (
        <div className="space-y-2">
          <Label htmlFor="item-base">{what}</Label>
          <NativeSelect id="item-base" value={selected} onChange={(e) => setChoice(e.target.value)}>
            <option value="">Vyber…</option>
            {list.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </NativeSelect>
          <p className="text-xs text-muted-foreground">
            {base.baseRuleId
              ? 'Základ je daný popisem itemu. AC nebo zranění se spočítá ze základu a magického bonusu.'
              : 'Tenhle item může být na různém základu, vyber, na jakém je. AC nebo zranění se spočítá ze základu a magického bonusu.'}
          </p>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Tenhle item žádný základ nepotřebuje.</p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={onBack}>
          <ArrowLeftIcon aria-hidden /> Zpět
        </Button>
        <Button
          type="button"
          disabled={pending || detail.isPending || (base !== null && !selected)}
          onClick={() => onPick(base ? selected : null, base && !base.baseRuleId && selectedName ? `${entry.name} (${selectedName})` : entry.name)}
        >
          {pickLabel}
        </Button>
      </div>
    </div>
  )
}
