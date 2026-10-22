import { formatModifier, riderApplies, type DamageRiderInfo } from '@/engine'
import { useState } from 'react'
import { FlameIcon, SkullIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { RollButton } from '@/features/dice/RollButton'
import { d20, damageExpression } from '@/features/dice/format'
import { ComputedValue } from './ComputedValue'
import { riderFor } from './riders'
import { ClassRiderToggle } from './ClassRiderToggle'
import { useClassToggle } from './class-toggles'
import { useSheet } from './sheet-context'

export function AttacksCard() {
  const { sheet, character, canEdit, adjust } = useSheet()
  // Soustředění na Hex apod.: ke každému zásahu proti označenému cíli přibývá kostka zranění.
  const rider = riderFor(character.state.concentration)
  const [riderOn, setRiderOn] = useState(true)
  const active = rider !== null && riderOn
  // Přídavky od tříd (Sneak Attack, ...): „vždy“ se přidají samy, ostatní si hráč zapíná pro konkrétní zásah.
  const [sneakOn] = useClassToggle(character.id, 'sneak-attack')
  const [colossusOn] = useClassToggle(character.id, 'colossus-slayer')
  const classOn: Record<string, boolean> = { 'sneak-attack': sneakOn, 'colossus-slayer': colossusOn }
  const togglable = sheet.damageRiders.filter((r) => r.mode === 'toggle' && sheet.attacks.some((a) => riderApplies(r, a)))
  const rage = sheet.rage
  function toggleRage() {
    if (!rage) return
    if (rage.active) adjust([{ op: 'condition', name: 'Raging', set: false }])
    else
      adjust([
        { op: 'resource', key: rage.resourceKey, delta: -1, max: rage.usesMax },
        { op: 'condition', name: 'Raging', set: true },
      ])
  }
  const extraFor = (r: DamageRiderInfo) => ({ dice: r.dice, type: r.type === 'weapon' ? r.name : `${r.type} (${r.name})` })
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
        {rage && canEdit && (
          <Button
            type="button"
            data-testid="rage-toggle"
            variant={rage.active ? 'default' : 'outline'}
            aria-pressed={rage.active}
            disabled={!rage.active && rage.usesLeft <= 0}
            onClick={toggleRage}
            className="mb-3 h-auto min-h-11 w-full justify-start whitespace-normal py-2 text-left"
          >
            <FlameIcon aria-hidden />
            <span>
              {rage.active ? 'Rage trvá: ukončit' : 'Rage'} (+{rage.damageBonus} ke zranění na STR zblízka)
              <span className="block text-xs font-normal">
                {rage.active ? 'Při odpočinku skončí sama.' : `Zapnutí stojí 1 použití (zbývá ${rage.usesLeft} z ${rage.usesMax}).`}
              </span>
            </span>
          </Button>
        )}
        {canEdit && togglable.map((r) => <ClassRiderToggle key={r.id} rider={r} />)}
        {rider && canEdit && (
          <Button type="button" variant={riderOn ? 'default' : 'outline'} aria-pressed={riderOn} onClick={() => setRiderOn((v) => !v)} className="mb-3 h-auto min-h-11 w-full justify-start whitespace-normal py-2 text-left">
            <SkullIcon aria-hidden />
            <span>
              Cíl je pod kouzlem {rider.name}: ke zranění se přidá {rider.dice} {rider.type.toLowerCase()}
              <span className="block text-xs font-normal">Vypni, když útočíš na jiného protivníka (bonus platí jen proti jednomu cíli).</span>
            </span>
          </Button>
        )}
        <ul className="divide-y">
          {sheet.attacks.map((a) => {
            // Přídavky od tříd, které se na tento útok vztahují (a jsou zapnuté nebo platí vždy).
            const classRiders = sheet.damageRiders.filter((r) => riderApplies(r, a) && (r.mode === 'always' || classOn[r.id] === true))
            const extras = [...a.extraDamage, ...(active ? [{ dice: rider.dice, type: `${rider.type} (${rider.name})` }] : []), ...classRiders.map(extraFor)]
            const damage = damageExpression(a.damageDice, a.damageBonus.value, [...a.extraDamage, ...(active ? [rider] : []), ...classRiders])
            const damageLabel = `${a.name}: zranění${active ? ` + ${rider.name}` : ''}${classRiders.map((r) => ` + ${r.name}`).join('')}`
            return (
              <li key={a.id} className="space-y-1 py-2">
                <div>
                  <p className="font-medium">{a.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {[a.ability.toUpperCase(), a.damageType.toLowerCase(), ...a.notes, !a.proficient && 'bez proficiency'].filter(Boolean).join(' · ')}
                  </p>
                </div>
                {/* Oba řádky mají stejné sloupce (popisek, kostka, bonus, hody), takže čísla jsou přesně pod sebou. */}
                <div className="grid grid-cols-[4rem_3rem_3rem_minmax(0,1fr)] items-center gap-x-2 text-sm">
                  <span className="text-muted-foreground">Útok</span>
                  <span className="text-muted-foreground tabular-nums">d20</span>
                  <ComputedValue
                    title={`${a.name}: bonus k útoku`}
                    computed={a.toHit}
                    overrideKey={`attack.${a.id}.toHit`}
                    format={formatModifier}
                    className="justify-self-start"
                  />
                  <div className="flex items-center">
                    <RollButton label={`${a.name}: útok`} expression={d20(a.toHit.value)} kind="attack" />
                  </div>

                  <span className="text-muted-foreground">Zranění</span>
                  <span className="font-semibold tabular-nums">{a.damageDice}</span>
                  <ComputedValue
                    title={`${a.name}: bonus ke zranění`}
                    computed={a.damageBonus}
                    overrideKey={`attack.${a.id}.damage`}
                    format={formatModifier}
                    className="justify-self-start"
                  />
                  <div className="flex flex-wrap items-center">
                    {damage && (
                      <>
                        <RollButton label={damageLabel} expression={damage} />
                        <RollButton label={damageLabel} expression={damage} crit critExtra={a.critExtra ?? undefined} text="Krit" />
                      </>
                    )}
                  </div>
                  {extras.length > 0 && (
                    <p className="col-span-3 col-start-2 pb-1 text-sm font-semibold" title="Doplňková zranění">
                      {extras.map((x) => `+ ${x.dice} ${x.type.toLowerCase()}`).join(', ')}
                    </p>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      </CardContent>
    </Card>
  )
}
