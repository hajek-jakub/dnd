import { BrainIcon, SkullIcon, ZapIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { DAMAGE_RIDERS, riderFor } from '@/features/sheet/riders'
import { CONCENTRATION_RIDER, useClassToggle } from '@/features/sheet/class-toggles'
import { useSheet } from '@/features/sheet/sheet-context'
import { formatCost, parseCost, planSpend, stringifyCost, type Cost } from './cost'
import type { Tactic } from './types'

interface Candidate {
  name: string
  cost: Cost
}

/**
 * Kouzla se soustředěním, která jde zapnout přímo z taktik: kouzla s přídavkem ke zranění (Hex, Hunter's Mark) ze seznamu kouzel
 * postavy a kouzla z taktik označená „Soustředění“. Cena se bere z taktiky, jinak slot úrovně kouzla.
 */
function candidatesOf(spells: { name: string; level: number; concentration: boolean }[], tactics: Tactic[]): Candidate[] {
  const out = new Map<string, Candidate>()
  for (const t of tactics) if (t.kind === 'spell' && t.data.concentration) out.set(t.title, { name: t.title, cost: parseCost(t.data.cost) })
  for (const s of spells)
    if (s.concentration && s.level > 0 && DAMAGE_RIDERS[s.name] && !out.has(s.name)) out.set(s.name, { name: s.name, cost: { type: 'slot', n: s.level } })
  return [...out.values()]
}

/**
 * Soustředění na záložce Taktiky: co trvá, jeho ukončení a přepínač, jestli je cíl pod kouzlem (Hex přidá 1d6 k automatickým hodům).
 * Bez soustředění nabídne seslání (zaplatí slot) nebo jen zapnutí, když kouzlo už trvá (sesláno jinde, přesun Hexu na nový cíl).
 */
export function ConcentrationCard({ tactics }: { tactics: Tactic[] }) {
  const { character, sheet, canEdit, adjust } = useSheet()
  const [riderOn, toggleRider] = useClassToggle(character.id, CONCENTRATION_RIDER, true)
  const current = character.state.concentration
  const rider = riderFor(current)
  const candidates = candidatesOf(character.spells, tactics)
  if (!current && (candidates.length === 0 || !canEdit)) return null

  const start = (c: Candidate, pay: boolean) => {
    const spend = pay ? planSpend(c.cost.type === 'free' ? [] : [c.cost], sheet) : { ok: true, ops: [], detail: '' }
    if (!spend.ok) return
    adjust([...spend.ops, { op: 'concentration', set: c.name }])
    if (riderFor(c.name) && !riderOn) toggleRider()
    toast.success(pay ? `${c.name} seslán${c.cost.type !== 'free' ? ` (${formatCost(stringifyCost(c.cost))})` : ''}. Soustředíš se.` : `Soustředíš se na ${c.name}.`)
  }

  return (
    <Card size="sm" className="border-amber-500/40 bg-amber-500/5" data-testid="concentration-card">
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-2 font-medium">
            <BrainIcon aria-hidden className="size-5 text-amber-600 dark:text-amber-400" />
            {current ? (
              <span>
                Soustředíš se na <strong>{current}</strong>
              </span>
            ) : (
              <span>Nesoustředíš se na žádné kouzlo</span>
            )}
          </p>
          {current && canEdit && (
            <Button variant="outline" onClick={() => adjust([{ op: 'concentration', set: null }])}>
              Ukončit koncentraci
            </Button>
          )}
        </div>

        {rider && canEdit && (
          <Button type="button" variant={riderOn ? 'default' : 'outline'} aria-pressed={riderOn} onClick={toggleRider} className="h-auto min-h-11 w-full justify-start whitespace-normal py-2 text-left">
            <SkullIcon aria-hidden />
            <span>
              Cíl je pod kouzlem {rider.name}: ke zranění útoků se přidá {rider.dice} {rider.type.toLowerCase()}
              <span className="block text-xs font-normal opacity-80">
                {riderOn
                  ? 'Hody z taktik i karty Útoky ho započítají. Vypni, když útočíš na jiného protivníka.'
                  : `Hody ${rider.name} nezapočítají. Když cíl padne, přesuneš ${rider.name} bonus akcí na nový cíl bez slotu; pak to zase zapni.`}
              </span>
            </span>
          </Button>
        )}

        {!current && canEdit && (
          <ul className="space-y-2">
            {candidates.map((c) => {
              const spend = planSpend(c.cost.type === 'free' ? [] : [c.cost], sheet)
              const price = c.cost.type === 'free' ? '' : formatCost(stringifyCost(c.cost))
              return (
                <li key={c.name} className="flex flex-wrap gap-2">
                  <Button className="flex-1" disabled={!spend.ok} title={spend.ok ? undefined : spend.detail} onClick={() => start(c, true)} aria-label={`Seslat ${c.name}${price ? `, platí se ${price}` : ''}${spend.ok ? '' : ` (${spend.detail})`}`}>
                    <ZapIcon aria-hidden /> Seslat {c.name}
                    {price && <span className="text-xs font-normal opacity-80">({price})</span>}
                  </Button>
                  <Button variant="outline" className="flex-1" onClick={() => start(c, false)}>
                    {c.name} už trvá
                  </Button>
                </li>
              )
            })}
            <li className="text-xs text-muted-foreground">„Už trvá“ jen zapne soustředění bez placení: kouzlo jsi seslal jinde, nebo přesouváš Hex na nový cíl.</li>
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
