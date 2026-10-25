import { useMemo, useRef, useState } from 'react'
import { PencilIcon, PlusIcon } from 'lucide-react'
import { toast } from 'sonner'
import { formatModifier } from '@/engine'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { ApiError } from '@/lib/api'
import { riderFor } from '@/features/sheet/riders'
import { ClassRiderToggle } from '@/features/sheet/ClassRiderToggle'
import { CONCENTRATION_RIDER, useClassToggle } from '@/features/sheet/class-toggles'
import { useSheet } from '@/features/sheet/sheet-context'
import { useDeleteTactic, useReorderTactics, useTactics } from './api'
import { kiState } from './cost'
import { ConcentrationCard } from './ConcentrationCard'
import { BatchResultDialog, type BatchOutcome } from './BatchResultDialog'
import { AttackCard, ComboCard, KiCard, PassiveCard, RuleCard, SpellCard, type EditControls, type RunContext } from './TacticCards'
import { TacticForm } from './TacticForm'
import { KIND_LABELS, type Tactic, type TacticKind } from './types'

const SECTIONS: { kind: TacticKind; title: string }[] = [
  { kind: 'attack', title: 'Útoky' },
  { kind: 'spell', title: 'Kouzla' },
  { kind: 'ki', title: 'Ki schopnosti' },
  { kind: 'passive', title: 'Pasivky a reakce' },
  { kind: 'combo', title: 'Komba' },
  { kind: 'rule', title: 'Pravidla' },
]

/** Taktiky postavy: tahák do boje. Data jsou v databázi, hráč i DM je můžou upravovat, štítky cen sledují ki a spell sloty. */
export function TacticsTab() {
  const { character, canEdit, sheet } = useSheet()
  // Druh „ki“ jsou schopnosti třídy: u mnicha ki, u ostatních třeba Wild Shape, Natural Recovery nebo magické předměty.
  const sectionTitle = (kind: TacticKind, title: string) => (kind === 'ki' && !kiState(sheet) ? 'Schopnosti' : title)
  const { data, isPending, error } = useTactics(character.id)
  const reorder = useReorderTactics(character.id)
  const remove = useDeleteTactic(character.id)
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<{ kind: TacticKind; tactic?: Tactic } | null>(null)
  const [riderOn] = useClassToggle(character.id, CONCENTRATION_RIDER, true)
  const [outcome, setOutcome] = useState<BatchOutcome | null>(null)
  const rollCounter = useRef(0)
  const rider = riderFor(character.state.concentration)
  // Rage platí, když je zapnutá; Sneak Attack, když ho hráč zapnul (stejný přepínač jako na kartě Útoky).
  const [sneakOn] = useClassToggle(character.id, 'sneak-attack')
  const sneak = sheet.damageRiders.find((r) => r.id === 'sneak-attack')

  const byKind = useMemo(() => {
    const m = new Map<TacticKind, Tactic[]>()
    for (const t of data ?? []) m.set(t.kind, [...(m.get(t.kind) ?? []), t].sort((a, b) => a.position - b.position))
    return m
  }, [data])

  if (isPending) return <p className="text-sm text-muted-foreground">Načítám taktiky…</p>
  if (error) return <p role="alert">Taktiky se nepodařilo načíst. Obnov stránku.</p>

  const controlsFor = (t: Tactic, list: Tactic[], i: number): EditControls => ({
    editing: editing && canEdit,
    first: i === 0,
    last: i === list.length - 1,
    onMove: (dir) => {
      const ids = list.map((x) => x.id)
      const moved = ids.splice(i, 1)
      ids.splice(i + dir, 0, ...moved)
      reorder.mutate({ kind: t.kind, ids }, { onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Pořadí se nepodařilo uložit.') })
    },
    onEdit: () => setForm({ kind: t.kind, tactic: t }),
    onDelete: () => {
      if (window.confirm(`Smazat „${t.title}“?`)) remove.mutate(t.id, { onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Smazání se nepodařilo.') })
    },
  })

  const classBonus = { rage: sheet.rage?.active ? sheet.rage.damageBonus : 0, sneak: sneak && sneakOn ? sneak.dice : null }
  const onRoll: RunContext['onRoll'] = (base) => {
    const token = ++rollCounter.current
    setOutcome({ ...base, token, results: null })
    return {
      results: (results) => setOutcome((o) => (o && o.token === token ? { ...o, results } : o)),
      fail: () => setOutcome((o) => (o && o.token === token ? null : o)),
    }
  }
  const ctx: RunContext = { all: data ?? [], rider: rider && riderOn ? rider : null, classBonus, onRoll }
  const render = (t: Tactic, list: Tactic[], i: number) => {
    const controls = controlsFor(t, list, i)
    switch (t.kind) {
      case 'attack':
        return <AttackCard key={t.id} tactic={t} rider={ctx.rider} ctx={ctx} controls={controls} />
      case 'spell':
        return <SpellCard key={t.id} tactic={t} ctx={ctx} controls={controls} />
      case 'ki':
        return <KiCard key={t.id} tactic={t} ctx={ctx} controls={controls} />
      case 'passive':
        return <PassiveCard key={t.id} tactic={t} ctx={ctx} controls={controls} />
      case 'combo':
        return <ComboCard key={t.id} tactic={t} ctx={ctx} controls={controls} />
      case 'rule':
        return <RuleCard key={t.id} tactic={t} controls={controls} />
    }
  }

  const empty = (data ?? []).length === 0
  return (
    <div className="space-y-5">
      <QuickStats />

      {canEdit && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">Ceny se berou z tvého ki a spell slotů. Hod kostkou nic neodečítá, k tomu je tlačítko Použít.</p>
          <Button variant={editing ? 'default' : 'outline'} aria-pressed={editing} onClick={() => setEditing((v) => !v)}>
            <PencilIcon aria-hidden /> Upravit taktiky
          </Button>
        </div>
      )}

      <ConcentrationCard tactics={data ?? []} />

      {canEdit && sneak && <ClassRiderToggle rider={sneak} />}
      {sheet.rage?.active && <p className="text-sm font-medium">Rage trvá: útoky s příznakem Rage mají +{sheet.rage.damageBonus} ke zranění.</p>}

      {empty && !editing && (
        <p className="text-sm text-muted-foreground">
          {canEdit ? 'Zatím tu nic není. Zapni „Upravit taktiky“ a přidej první položku.' : 'Tahle postava zatím nemá žádné taktiky.'}
        </p>
      )}

      {SECTIONS.map(({ kind, title: baseTitle }) => {
        const title = sectionTitle(kind, baseTitle)
        const list = byKind.get(kind) ?? []
        if (list.length === 0 && !(editing && canEdit)) return null
        return (
          <section key={kind} aria-label={title} className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-lg font-semibold">{title}</h2>
              {editing && canEdit && (
                <Button variant="outline" onClick={() => setForm({ kind })} aria-label={`Přidat: ${KIND_LABELS[kind].toLowerCase()}`}>
                  <PlusIcon aria-hidden /> Přidat
                </Button>
              )}
            </div>
            <ul className={kind === 'rule' ? 'space-y-2' : 'grid gap-3 tab:grid-cols-2'}>{list.map((t, i) => render(t, list, i))}</ul>
          </section>
        )
      })}

      {form && <TacticForm characterId={character.id} kind={form.kind} tactic={form.tactic} all={data ?? []} items={character.items} onClose={() => setForm(null)} />}
      <BatchResultDialog outcome={outcome} onClose={() => setOutcome(null)} />
    </div>
  )
}

/** Klíčová čísla do boje pohromadě: AC, iniciativa, rychlost, HP, ki a jeho DC, DC a útok kouzel, CON save a sloty. */
function QuickStats() {
  const { sheet } = useSheet()
  const ki = kiState(sheet)
  const wildShape = sheet.resources.find((r) => r.key === 'druid.wild-shape')
  const caster = sheet.spellcasting.classes.find((c) => c.classIndex === 'warlock') ?? sheet.spellcasting.classes[0]
  const { pact, slots } = sheet.spellcasting
  const stats: { label: string; value: string; hint?: string }[] = [
    { label: 'AC', value: String(sheet.ac.value) },
    { label: 'Iniciativa', value: formatModifier(sheet.initiative.value) },
    { label: 'Rychlost', value: `${sheet.speed.value} ft` },
    { label: 'HP', value: `${sheet.hp.current}/${sheet.hp.max.value}`, hint: sheet.hp.temp > 0 ? `+${sheet.hp.temp} dočasných` : undefined },
    ...(ki ? [{ label: 'Ki', value: `${ki.current}/${ki.max}` }, { label: 'Ki DC', value: String(8 + sheet.proficiencyBonus.value + sheet.abilities.wis.modifier) }] : []),
    ...(wildShape ? [{ label: 'Wild Shape', value: `${wildShape.current}/${wildShape.max.value}` }] : []),
    ...(caster ? [{ label: 'Spell DC', value: String(caster.saveDc.value) }, { label: 'Útok kouzlem', value: formatModifier(caster.attackBonus.value) }] : []),
    { label: 'CON save', value: formatModifier(sheet.saves.con.value) },
    ...(pact ? [{ label: `Pact sloty ${pact.level}. ú.`, value: `${pact.count - pact.used}/${pact.count}` }] : []),
    ...slots.map((s) => ({ label: `Sloty ${s.level}. ú.`, value: `${s.max - s.used}/${s.max}` })),
  ]
  return (
    <Card>
      <CardContent>
        <dl aria-label="Klíčové hodnoty do boje" className="grid grid-cols-3 gap-2 tab:grid-cols-6">
          {stats.map((s) => (
            <div key={s.label} className="rounded-lg border bg-background p-2 text-center">
              <dt className="text-xs text-muted-foreground">{s.label}</dt>
              <dd className="text-xl font-bold">{s.value}</dd>
              {s.hint && <dd className="text-xs text-muted-foreground">{s.hint}</dd>}
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  )
}
