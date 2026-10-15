import { formatModifier } from '@/engine'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { RollButton } from '@/features/dice/RollButton'
import { d20, damageExpression } from '@/features/dice/format'
import { ComputedValue } from './ComputedValue'
import { useSheet } from './sheet-context'

export function AttacksCard() {
  const { sheet } = useSheet()
  return (
    <Card>
      <CardHeader>
        <CardTitle>Útoky</CardTitle>
        <p className="text-sm text-muted-foreground">
          {sheet.attacksPerAction} {sheet.attacksPerAction === 1 ? 'útok' : sheet.attacksPerAction < 5 ? 'útoky' : 'útoků'} na akci (Attack action)
          {sheet.martialArtsDie ? ` · Martial Arts ${sheet.martialArtsDie}` : ''}
        </p>
      </CardHeader>
      <CardContent>
        <ul className="divide-y">
          {sheet.attacks.map((a) => (
            <li key={a.id} className="space-y-1 py-2">
              <div>
                <p className="font-medium">{a.name}</p>
                <p className="text-xs text-muted-foreground">
                  {a.ability.toUpperCase()}
                  {a.notes.length > 0 && ` · ${a.notes.join(', ')}`}
                  {!a.proficient && ' · bez proficiency'}
                </p>
              </div>
              {/* Útok a zranění se na úzkém displeji zalomí pod sebe, ať stránka nejezdí do stran. */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                <div className="flex items-center gap-1">
                  <span className="text-muted-foreground">k20</span>
                  <ComputedValue title={`${a.name}: bonus k útoku`} computed={a.toHit} overrideKey={`attack.${a.id}.toHit`} format={formatModifier} />
                  <RollButton label={`${a.name}: útok`} expression={d20(a.toHit.value)} />
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  <span className="text-muted-foreground">zranění</span>
                  <span className="font-semibold">{a.damageDice}</span>
                  <ComputedValue
                    title={`${a.name}: bonus ke zranění`}
                    computed={a.damageBonus}
                    overrideKey={`attack.${a.id}.damage`}
                    format={formatModifier}
                  />
                  {a.extraDamage.map((x) => (
                    <span key={`${x.dice}${x.type}`} className="font-semibold" title="Doplňkové zranění">
                      + {x.dice} {x.type.toLowerCase()}
                    </span>
                  ))}
                  {damageExpression(a.damageDice, a.damageBonus.value, a.extraDamage) && (
                    <>
                      <RollButton label={`${a.name}: zranění`} expression={damageExpression(a.damageDice, a.damageBonus.value, a.extraDamage)!} />
                      <RollButton label={`${a.name}: zranění`} expression={damageExpression(a.damageDice, a.damageBonus.value, a.extraDamage)!} crit text="Krit" />
                    </>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
