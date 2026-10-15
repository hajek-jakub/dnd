import { formatModifier } from '@/engine'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { RollButton } from '@/features/dice/RollButton'
import { d20 } from '@/features/dice/format'
import { ComputedValue } from './ComputedValue'
import { useSheet } from './sheet-context'

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
            <dl className="mt-1 grid grid-cols-[auto_1fr] items-center gap-x-3 text-sm">
              <dt className="text-muted-foreground">Spell save DC</dt>
              <dd>
                <ComputedValue title={`${c.className}: Spell save DC`} computed={c.saveDc} overrideKey={`spellDc.${c.classIndex}`} />
              </dd>
              <dt className="text-muted-foreground">Bonus k útoku kouzlem</dt>
              <dd>
                <ComputedValue
                  title={`${c.className}: bonus k útoku kouzlem`}
                  computed={c.attackBonus}
                  overrideKey={`spellAttack.${c.classIndex}`}
                  format={formatModifier}
                />
                <RollButton label={`${c.className}: útok kouzlem`} expression={d20(c.attackBonus.value)} />
              </dd>
              {c.cantripsKnown !== null && (
                <>
                  <dt className="text-muted-foreground">Cantripy</dt>
                  <dd className="font-medium">{c.cantripsKnown}</dd>
                </>
              )}
              {c.spellsKnown !== null && (
                <>
                  <dt className="text-muted-foreground">Známá kouzla</dt>
                  <dd className="font-medium">{c.spellsKnown}</dd>
                </>
              )}
              {c.preparedMax !== null && (
                <>
                  <dt className="text-muted-foreground">Připravená kouzla</dt>
                  <dd className="font-medium">až {c.preparedMax}</dd>
                </>
              )}
            </dl>
          </section>
        ))}
      </CardContent>
    </Card>
  )
}
