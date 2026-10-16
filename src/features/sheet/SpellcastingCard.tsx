import type { ReactNode } from 'react'
import { formatModifier } from '@/engine'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { RollButton } from '@/features/dice/RollButton'
import { d20 } from '@/features/dice/format'
import { ComputedValue } from './ComputedValue'
import { useSheet } from './sheet-context'

/** Řádek přehledu: hodnota je ve sloupci vycentrovaná stejně jako přepisovatelné hodnoty (tlačítko 44 px). */
function Row({ label, children, action }: { label: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="col-span-3 grid min-h-11 grid-cols-subgrid items-center">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="flex justify-center font-semibold tabular-nums">{children}</dd>
      <dd className="flex justify-center">{action}</dd>
    </div>
  )
}

/** Sesílání po třídách: každá sesilatelská třída má vlastní schopnost, DC a bonus k útoku kouzlem. */
export function SpellcastingCard() {
  const { sheet } = useSheet()
  const { classes, casterLevel, pact } = sheet.spellcasting
  if (classes.length === 0) return null
  return (
    <Card>
      <CardHeader>
        <CardTitle>Sesílání</CardTitle>
        <p className="text-sm text-muted-foreground">
          {casterLevel > 0 ? `Caster level ${casterLevel} pro běžné sloty` : 'Žádné běžné sloty'}
          {pact ? ` · Pact Magic: ${pact.count}× ${pact.level}. úrovně` : ''}
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {classes.map((c) => (
          <section key={c.classIndex} aria-label={`Sesílání: ${c.className}`} className="rounded-lg border p-3">
            <h3 className="font-medium">
              {c.className} <span className="text-sm font-normal text-muted-foreground">({c.ability.toUpperCase()})</span>
            </h3>
            {/* Stejné sloupce jako u dovedností: popisek, hodnota (čísla pod sebou), tlačítko hodu. */}
            <dl className="mt-1 grid grid-cols-[minmax(0,1fr)_3rem_2.75rem] items-center gap-x-2 text-sm">
              <Row label="Spell save DC">
                <ComputedValue title={`${c.className}: Spell save DC`} computed={c.saveDc} overrideKey={`spellDc.${c.classIndex}`} />
              </Row>
              <Row
                label="Bonus k útoku kouzlem"
                action={<RollButton label={`${c.className}: útok kouzlem`} expression={d20(c.attackBonus.value)} />}
              >
                <ComputedValue
                  title={`${c.className}: bonus k útoku kouzlem`}
                  computed={c.attackBonus}
                  overrideKey={`spellAttack.${c.classIndex}`}
                  format={formatModifier}
                />
              </Row>
              {c.cantripsKnown !== null && <Row label="Cantripy">{c.cantripsKnown}</Row>}
              {c.spellsKnown !== null && <Row label="Známá kouzla">{c.spellsKnown}</Row>}
              {c.preparedMax !== null && <Row label="Připravená kouzla (nejvýš)">{c.preparedMax}</Row>}
            </dl>
          </section>
        ))}
      </CardContent>
    </Card>
  )
}
