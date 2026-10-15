import { formatModifier } from '@/engine'
import { useState } from 'react'
import { SkullIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { RollButton } from '@/features/dice/RollButton'
import { d20, damageExpression } from '@/features/dice/format'
import { ComputedValue } from './ComputedValue'
import { riderFor } from './riders'
import { useSheet } from './sheet-context'

export function AttacksCard() {
  const { sheet, character, canEdit } = useSheet()
  // Soustředění na Hex apod.: ke každému zásahu proti označenému cíli přibývá kostka zranění.
  const rider = riderFor(character.state.concentration)
  const [riderOn, setRiderOn] = useState(true)
  const active = rider !== null && riderOn
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
        {rider && canEdit && (
          <Button type="button" variant={riderOn ? 'default' : 'outline'} aria-pressed={riderOn} onClick={() => setRiderOn((v) => !v)} className="mb-3 h-auto min-h-11 w-full justify-start whitespace-normal py-2 text-left">
            <SkullIcon aria-hidden />
            <span>
              Cíl je pod kouzlem {rider.name}: ke zranění se přidá {rider.dice} {rider.type.toLowerCase()}
              <span className="block text-xs font-normal opacity-80">Vypni, když útočíš na jiného protivníka (bonus platí jen proti jednomu cíli).</span>
            </span>
          </Button>
        )}
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
              {/* Dva řádky pod sebou ve stejném sloupci: popisek vlevo, hodnoty a kostky vedle sebe a při nedostatku místa se zalomí. */}
              <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-x-3 text-sm">
                <span className="text-muted-foreground">k20</span>
                <div className="flex items-center gap-1">
                  <ComputedValue title={`${a.name}: bonus k útoku`} computed={a.toHit} overrideKey={`attack.${a.id}.toHit`} format={formatModifier} />
                  <RollButton label={`${a.name}: útok`} expression={d20(a.toHit.value)} />
                </div>
                <span className="text-muted-foreground">zranění</span>
                <div className="flex flex-wrap items-center gap-x-2">
                  <span className="font-semibold">{a.damageDice}</span>
                  <ComputedValue
                    title={`${a.name}: bonus ke zranění`}
                    computed={a.damageBonus}
                    overrideKey={`attack.${a.id}.damage`}
                    format={formatModifier}
                  />
                  {[...a.extraDamage, ...(active ? [{ dice: rider.dice, type: `${rider.type} (${rider.name})` }] : [])].map((x) => (
                    <span key={`${x.dice}${x.type}`} className="font-semibold" title="Doplňkové zranění">
                      + {x.dice} {x.type.toLowerCase()}
                    </span>
                  ))}
                  {damageExpression(a.damageDice, a.damageBonus.value, [...a.extraDamage, ...(active ? [rider] : [])]) && (
                    <span className="flex items-center">
                      <RollButton label={`${a.name}: zranění${active ? ` + ${rider.name}` : ''}`} expression={damageExpression(a.damageDice, a.damageBonus.value, [...a.extraDamage, ...(active ? [rider] : [])])!} />
                      <RollButton label={`${a.name}: zranění${active ? ` + ${rider.name}` : ''}`} expression={damageExpression(a.damageDice, a.damageBonus.value, [...a.extraDamage, ...(active ? [rider] : [])])!} crit text="Krit" />
                    </span>
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
