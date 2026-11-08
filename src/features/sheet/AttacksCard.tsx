import { formatModifier, riderApplies, type AttackInfo, type DamageRiderInfo } from '@/engine'
import { FlameIcon, SkullIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { RollButton } from '@/features/dice/RollButton'
import { d20, damageExpression } from '@/features/dice/format'
import { ComputedValue } from './ComputedValue'
import { riderFor } from './riders'
import { ClassRiderToggle } from './ClassRiderToggle'
import { CONCENTRATION_RIDER, useClassToggle } from './class-toggles'
import { useSheet } from './sheet-context'
import { WearDetails } from './WearControl'
import { tracksBreakage } from './wear'

export function AttacksCard() {
  const { sheet, character, canEdit, adjust } = useSheet()
  // Soustředění na Hex apod.: ke každému zásahu proti označenému cíli přibývá kostka zranění.
  const rider = riderFor(character.state.concentration)
  const [riderOn, toggleRider] = useClassToggle(character.id, CONCENTRATION_RIDER, true)
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
          <Button type="button" variant={riderOn ? 'default' : 'outline'} aria-pressed={riderOn} onClick={toggleRider} className="mb-3 h-auto min-h-11 w-full justify-start whitespace-normal py-2 text-left">
            <SkullIcon aria-hidden />
            <span>
              Cíl je pod kouzlem {rider.name}: ke zranění se přidá {rider.dice} {rider.type.toLowerCase()}
              <span className="block text-xs font-normal">Vypni, když útočíš na jiného protivníka (bonus platí jen proti jednomu cíli).</span>
            </span>
          </Button>
        )}
        <ul className="space-y-3">
          {sheet.attacks.map((a) => {
            // Přídavky od tříd, které se na tento útok vztahují (a jsou zapnuté nebo platí vždy).
            const classRiders = sheet.damageRiders.filter((r) => riderApplies(r, a) && (r.mode === 'always' || classOn[r.id] === true))
            const riders = [...(active ? [rider] : []), ...classRiders]
            const extras = [...a.extraDamage, ...(active ? [{ dice: rider.dice, type: `${rider.type} (${rider.name})` }] : []), ...classRiders.map(extraFor)]
            const damageLabel = `${a.name}: zranění${active ? ` + ${rider.name}` : ''}${classRiders.map((r) => ` + ${r.name}`).join('')}`
            return <AttackRow key={a.id} attack={a} riders={riders} extras={extras} damageLabel={damageLabel} />
          })}
        </ul>
      </CardContent>
    </Card>
  )
}

/** Jeden útok: nahoře velký bonus k útoku a zranění s hody, pod tím Versatile a úplně dole opotřebení zbraně. */
function AttackRow({
  attack: a,
  riders,
  extras,
  damageLabel,
}: {
  attack: AttackInfo
  riders: { dice: string }[]
  extras: { dice: string; type: string }[]
  damageLabel: string
}) {
  const { character } = useSheet()
  const [twoHanded, toggleTwoHanded] = useClassToggle(character.id, `versatile:${a.id}`)
  const versatile = a.versatileDice !== null
  const dice = versatile && twoHanded ? (a.versatileDice ?? a.damageDice) : a.damageDice
  const grip = versatile && twoHanded ? ' (oběma rukama)' : ''
  const damage = damageExpression(dice, a.damageBonus.value, [...a.extraDamage, ...riders])
  const gear = character.items.find((i) => i.id === a.id)
  const wear = gear && tracksBreakage(gear) ? gear : null
  const broken = wear?.broken === true
  return (
    <li className="space-y-2 rounded-xl border p-3" data-testid="attack-row">
      <div>
        <p className="font-medium">
          {a.name}
          {broken && <span className="ml-2 text-sm font-semibold text-red-700 dark:text-red-400">Rozbitá</span>}
        </p>
        <p className="text-xs text-muted-foreground">
          {[a.ability.toUpperCase(), a.damageType.toLowerCase(), ...a.notes, !a.proficient && 'bez proficiency'].filter(Boolean).join(' · ')}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg bg-muted/60 p-2">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Útok</p>
          <ComputedValue title={`${a.name}: bonus k útoku`} computed={a.toHit} overrideKey={`attack.${a.id}.toHit`} format={formatModifier} className="px-1">
            <span className="text-3xl font-bold tabular-nums">{formatModifier(a.toHit.value)}</span>
          </ComputedValue>
          <div className="flex items-center">{!broken && <RollButton label={`${a.name}: útok`} expression={d20(a.toHit.value)} kind="attack" text="Hodit" />}</div>
        </div>
        <div className="rounded-lg bg-muted/60 p-2">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Zranění</p>
          <div className="flex flex-wrap items-baseline">
            <span className="px-1 text-3xl font-bold tabular-nums" data-testid="attack-dice">
              {dice}
            </span>
            <ComputedValue title={`${a.name}: bonus ke zranění`} computed={a.damageBonus} overrideKey={`attack.${a.id}.damage`} format={formatModifier} className="px-1">
              <span className="text-3xl font-bold tabular-nums">{formatModifier(a.damageBonus.value)}</span>
            </ComputedValue>
          </div>
          {extras.length > 0 && (
            <p className="px-1 text-sm font-semibold" title="Doplňková zranění">
              {extras.map((x) => `+ ${x.dice} ${x.type.toLowerCase()}`).join(', ')}
            </p>
          )}
          <div className="flex flex-wrap items-center">
            {damage && !broken && (
              <>
                <RollButton label={`${damageLabel}${grip}`} expression={damage} text="Hodit" />
                <RollButton label={`${damageLabel}${grip}`} expression={damage} crit critExtra={a.critExtra ?? undefined} text="Krit" />
              </>
            )}
          </div>
        </div>
      </div>
      {versatile && (
        <div role="group" aria-label={`${a.name}: držení zbraně (Versatile)`} className="grid grid-cols-2 gap-2">
          <Button type="button" variant={twoHanded ? 'outline' : 'secondary'} aria-pressed={!twoHanded} onClick={() => twoHanded && toggleTwoHanded()} className="h-auto min-h-11 whitespace-normal">
            Jednou rukou {a.damageDice}
          </Button>
          <Button type="button" variant={twoHanded ? 'secondary' : 'outline'} aria-pressed={twoHanded} onClick={() => !twoHanded && toggleTwoHanded()} className="h-auto min-h-11 whitespace-normal">
            Oběma rukama {a.versatileDice}
          </Button>
        </div>
      )}
      {wear && <WearDetails item={wear} />}
    </li>
  )
}
