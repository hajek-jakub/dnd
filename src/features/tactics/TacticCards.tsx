import { ChevronDownIcon, ChevronUpIcon, PencilIcon, StarIcon, Trash2Icon, ZapIcon } from 'lucide-react'
import { toast } from 'sonner'
import { combineMode } from '@/engine'
import { Button } from '@/components/ui/button'
import { RollButton } from '@/features/dice/RollButton'
import { useSheet } from '@/features/sheet/sheet-context'
import { riderFor, type DamageRider } from '@/features/sheet/riders'
import { CONCENTRATION_RIDER, useClassToggle } from '@/features/sheet/class-toggles'
import type { AdjustOp } from '@/features/sheet/types'
import { cn } from '@/lib/utils'
import { useBatchRoll, type BatchResult } from '@/features/dice/api'
import { useRollSettings } from '@/features/dice/roll-settings-context'
import { ActionBadge, Badge, CostBadge } from './badges'
import type { BatchOutcome } from './BatchResultDialog'
import { formatCost, planSpend, stringifyCost } from './cost'
import { rollFor, toHitRoll, withClassBonus, type ClassBonus } from './damage'
import { planRun } from './run'
import type { Tactic } from './types'

export interface EditControls {
  editing: boolean
  first: boolean
  last: boolean
  onMove: (direction: -1 | 1) => void
  onEdit: () => void
  onDelete: () => void
}

/** Řazení, úprava a smazání; zobrazí se jen v režimu úprav. */
function EditBar({ tactic, controls, className }: { tactic: Tactic; controls: EditControls; className?: string }) {
  if (!controls.editing) return null
  return (
    <div className={cn('flex flex-wrap items-center gap-1 border-t pt-2', className)} role="group" aria-label={`Úpravy: ${tactic.title}`}>
      <Button variant="outline" size="icon" aria-label={`${tactic.title}: posunout výš`} disabled={controls.first} onClick={() => controls.onMove(-1)}>
        <ChevronUpIcon aria-hidden />
      </Button>
      <Button variant="outline" size="icon" aria-label={`${tactic.title}: posunout níž`} disabled={controls.last} onClick={() => controls.onMove(1)}>
        <ChevronDownIcon aria-hidden />
      </Button>
      <Button variant="outline" onClick={controls.onEdit} aria-label={`Upravit ${tactic.title}`}>
        <PencilIcon aria-hidden /> Upravit
      </Button>
      <Button variant="destructive" size="icon" aria-label={`Smazat ${tactic.title}`} onClick={controls.onDelete}>
        <Trash2Icon aria-hidden />
      </Button>
    </div>
  )
}

/** Rámeček jedné položky: hlavička se štítky, tělo a řada tlačítek (hody, použití ceny, v režimu úprav i řazení). */
function Shell({ tactic, badges, highlight, children, actions, controls }: { tactic: Tactic; badges: React.ReactNode; highlight?: boolean; children?: React.ReactNode; actions?: React.ReactNode; controls: EditControls }) {
  return (
    <li className={cn('space-y-2 rounded-xl border bg-card p-3', highlight && 'border-2 border-primary bg-primary/10')} data-tactic-kind={tactic.kind}>
      <div className="space-y-1">
        <h3 className="flex items-center gap-2 font-semibold">
          {highlight && <StarIcon aria-hidden className="size-4 shrink-0 fill-current text-primary" />}
          <span className="min-w-0 break-words">{tactic.title}</span>
        </h3>
        <div className="flex flex-wrap gap-1">{badges}</div>
      </div>
      {children}
      {actions && <div className="flex flex-wrap items-center gap-1">{actions}</div>}
      <EditBar tactic={tactic} controls={controls} />
    </li>
  )
}

/** Co potřebuje tlačítko Použít vědět o okolí: všechny taktiky postavy (kombo odkazuje na jiné), Hex a kam poslat výsledky. */
export interface RunContext {
  all: Tactic[]
  rider: DamageRider | null
  /** Rage a Sneak Attack, které se přičtou k zranění položek s příznakem `rage` a `sneak`. */
  classBonus: ClassBonus
  /** Otevře okno s točícími se kostkami hned po kliknutí; `results` doplní odpověď serveru, při chybě se okno zavře. */
  onRoll: (outcome: Omit<BatchOutcome, 'token' | 'results'>) => { results: (r: BatchResult[]) => void; fail: () => void }
}

/**
 * „Použít“ zaplatí cenu (ki, spell slot, munice) a rovnou hodí všechny útoky položky: každý má hod na zásah a zranění,
 * např. 2× kopí + Flurry = 4 zásahy a 4 zranění najednou. Bez hodů (Patient Defense, Command) jen odečte cenu.
 */
function RunButton({ tactic, ctx, withoutCast = false }: { tactic: Tactic; ctx: RunContext; withoutCast?: boolean }) {
  const { sheet, character, canEdit, adjust } = useSheet()
  const settings = useRollSettings()
  const batch = useBatchRoll(character.campaignId)
  const [riderOn, toggleRider] = useClassToggle(character.id, CONCENTRATION_RIDER, true)
  if (!canEdit) return null
  const plan = planRun(tactic, ctx.all, character.items, ctx.rider, ctx.classBonus, { withoutCast })
  if (withoutCast && plan.castable === null) return null
  const title = withoutCast ? `${tactic.title} bez kouzla ${plan.castable}` : tactic.title
  if (plan.attacks.length === 0 && plan.costs.length === 0 && plan.blocked === null) return null
  const spend = planSpend(plan.costs, sheet)
  const rolling = plan.attacks.length > 0
  const blocked = plan.blocked !== null && !rolling
  const ok = spend.ok && !blocked
  const reason = !spend.ok ? spend.detail : blocked ? (plan.blocked ?? '') : ''
  const paid = [
    ...plan.costs.map((c) => formatCost(stringifyCost(c))),
    ...plan.ammo.map((a) => `${a.shots}× ${a.name}`),
  ].join(', ')

  function run() {
    if (!ok) return
    const ops: AdjustOp[] = [...spend.ops, ...plan.ammo.map((a) => ({ op: 'item' as const, itemId: a.itemId, delta: -a.shots }))]
    if (plan.concentration !== null) ops.push({ op: 'concentration', set: plan.concentration })
    if (ops.length > 0) adjust(ops)
    if (plan.concentration !== null && riderFor(plan.concentration) && !riderOn) toggleRider()
    for (const w of plan.warnings) toast.warning(w)
    if (!rolling) {
      toast.success(`${title}: odečteno ${paid}`)
      return
    }
    const mode = combineMode(settings.mode, sheet.conditions.attack.mode)
    const view = ctx.onRoll({ title, attacks: plan.attacks, mode, hidden: settings.hidden, paid })
    batch.mutate(
      { attacks: plan.attacks, mode, hidden: settings.hidden, characterId: character.id },
      {
        onSuccess: (results: BatchResult[]) => view.results(results),
        onError: (e) => {
          view.fail()
          toast.error(e instanceof Error ? e.message : 'Hody se nepodařily.')
        },
      },
    )
  }

  return (
    <Button
      variant={rolling && !withoutCast ? 'default' : 'outline'}
      disabled={!ok || batch.isPending}
      title={reason || undefined}
      aria-label={`Použít ${title}${rolling ? `: ${plan.attacks.length}× hod` : ''}${paid ? `, platí se ${paid}` : ''}${reason ? ` (${reason})` : ''}`}
      onClick={run}
    >
      <ZapIcon aria-hidden /> {withoutCast ? `Bez kouzla ${plan.castable}${rolling ? ` (${plan.attacks.length}×)` : ''}` : rolling ? `Použít a hodit${plan.attacks.length > 1 ? ` (${plan.attacks.length}×)` : ''}` : 'Použít'}
    </Button>
  )
}

/** Zbývající munice u útoku: kolik kusů itemu ještě je (po vyčerpání přeškrtnuto). */
function AmmoBadge({ itemId }: { itemId: string }) {
  const { character } = useSheet()
  if (!itemId) return null
  const item = character.items.find((i) => i.id === itemId)
  if (!item) return <Badge className="border-dashed line-through">munice chybí</Badge>
  return (
    <Badge className={item.quantity < 1 ? 'border-dashed bg-muted line-through' : 'text-foreground'} data-testid="ammo-badge">
      {item.name}: {item.quantity} ks
    </Badge>
  )
}

const Field = ({ label, value }: { label: string; value: string }) =>
  value ? (
    <p className="text-sm">
      <span className="text-muted-foreground">{label}: </span>
      {value}
    </p>
  ) : null

export function AttackCard({ tactic, rider, ctx, controls }: { tactic: Extract<Tactic, { kind: 'attack' }>; rider: DamageRider | null; ctx: RunContext; controls: EditControls }) {
  const d = tactic.data
  const hit = toHitRoll(d.toHit)
  const base = rollFor(d)
  const withRider = rider !== null && d.hex
  const dmg = base ? withClassBonus(`${base}${withRider ? `+${rider.dice}` : ''}`, d, ctx.classBonus) : null
  const classText = `${d.rage && ctx.classBonus.rage > 0 ? ` + ${ctx.classBonus.rage} (Rage)` : ''}${d.sneak && ctx.classBonus.sneak ? ` + ${ctx.classBonus.sneak} (Sneak Attack)` : ''}`
  const damageText = `${d.damage}${withRider ? ` + ${rider.dice} ${rider.type.toLowerCase()} (${rider.name})` : ''}${classText}`
  return (
    <Shell
      tactic={tactic}
      controls={controls}
      badges={
        <>
          <ActionBadge type={d.actionType} />
          <CostBadge cost={d.cost} />
          {(d.count ?? 1) > 1 && <Badge className="text-foreground">{d.count}× útok</Badge>}
          <AmmoBadge itemId={d.ammo} />
        </>
      }
      actions={
        <>
          {hit && <RollButton label={`${tactic.title}: útok`} expression={hit} text="Útok" kind="attack" />}
          {dmg && <RollButton label={`${tactic.title}: zranění${withRider ? ` + ${rider.name}` : ''}`} expression={dmg} text="Zranění" />}
          {dmg && <RollButton label={`${tactic.title}: zranění${withRider ? ` + ${rider.name}` : ''}`} expression={dmg} crit text="Krit" />}
          <RunButton tactic={tactic} ctx={ctx} />
        </>
      }
    >
      <div className="space-y-0.5">
        <Field label="Útok" value={d.toHit} />
        <Field label="Zranění" value={damageText.trim()} />
        <Field label="Dostřel" value={d.range} />
        <Field label="Kdy" value={d.usage} />
        {d.note && <p className="text-sm text-muted-foreground">{d.note}</p>}
      </div>
    </Shell>
  )
}

export function SpellCard({ tactic, ctx, controls }: { tactic: Extract<Tactic, { kind: 'spell' }>; ctx: RunContext; controls: EditControls }) {
  const d = tactic.data
  const dmg = d.roll ? rollFor({ roll: d.roll }) : null
  return (
    <Shell
      tactic={tactic}
      controls={controls}
      badges={
        <>
          <Badge>{d.level === 0 ? 'Cantrip' : `${d.level}. úroveň`}</Badge>
          {(d.count ?? 1) > 1 && <Badge className="text-foreground">{d.count}× útok</Badge>}
          <ActionBadge type={d.actionType} />
          {d.concentration && <Badge>Soustředění</Badge>}
          <CostBadge cost={d.cost} />
        </>
      }
      actions={
        <>
          {dmg && <RollButton label={`${tactic.title}: zranění`} expression={dmg} text="Zranění" />}
          {dmg && <RollButton label={`${tactic.title}: zranění`} expression={dmg} crit text="Krit" />}
          <RunButton tactic={tactic} ctx={ctx} />
        </>
      }
    >
      <div className="space-y-0.5">
        <Field label="Útok" value={d.toHit ?? ''} />
        <Field label="Dosah" value={d.range} />
        <Field label="Trvání" value={d.duration} />
        <Field label="Saving throw" value={d.save} />
        {d.effect && <p className="text-sm text-muted-foreground">{d.effect}</p>}
      </div>
    </Shell>
  )
}

export function KiCard({ tactic, ctx, controls }: { tactic: Extract<Tactic, { kind: 'ki' }>; ctx: RunContext; controls: EditControls }) {
  const d = tactic.data
  return (
    <Shell
      tactic={tactic}
      controls={controls}
      badges={
        <>
          <ActionBadge type={d.actionType} />
          <CostBadge cost={d.cost} />
          {(d.count ?? 1) > 1 && <Badge className="text-foreground">{d.count}× útok</Badge>}
        </>
      }
      actions={<RunButton tactic={tactic} ctx={ctx} />}
    >
      <Field label="Útok" value={d.toHit ?? ''} />
      <Field label="Zranění" value={d.damage ?? ''} />
      {d.description && <p className="text-sm text-muted-foreground">{d.description}</p>}
    </Shell>
  )
}

export function PassiveCard({ tactic, ctx, controls }: { tactic: Extract<Tactic, { kind: 'passive' }>; ctx: RunContext; controls: EditControls }) {
  const d = tactic.data
  return (
    <Shell
      tactic={tactic}
      controls={controls}
      badges={
        <>
          {d.type === 'reaction' ? <ActionBadge type="reaction" /> : <Badge>Pasivka</Badge>}
          {d.cost !== 'free' && <CostBadge cost={d.cost} />}
        </>
      }
      actions={<RunButton tactic={tactic} ctx={ctx} />}
    >
      {d.description && <p className="text-sm text-muted-foreground">{d.description}</p>}
    </Shell>
  )
}

export function ComboCard({ tactic, ctx, controls }: { tactic: Extract<Tactic, { kind: 'combo' }>; ctx: RunContext; controls: EditControls }) {
  const d = tactic.data
  return (
    <Shell
      tactic={tactic}
      controls={controls}
      highlight={d.highlight}
      badges={
        <>
          {d.highlight && <Badge className="border-primary text-primary">Nejsilnější</Badge>}
          {d.expectedDamage && <Badge className="text-foreground">{d.expectedDamage}</Badge>}
          <CostBadge cost={d.cost} />
        </>
      }
      actions={
        <>
          <RunButton tactic={tactic} ctx={ctx} />
          <RunButton tactic={tactic} ctx={ctx} withoutCast />
        </>
      }
    >
      {(d.uses ?? []).length > 0 && (
        <p className="text-sm">
          <span className="text-muted-foreground">Provede: </span>
          {d.uses
            .map((u) => `${u.count > 1 ? `${u.count}× ` : ''}${ctx.all.find((x) => x.id === u.id)?.title ?? '(smazáno)'}`)
            .join(', ')}
        </p>
      )}
      {ctx.rider && (d.uses ?? []).some((u) => { const t = ctx.all.find((x) => x.id === u.id); return (t?.kind === 'attack' || t?.kind === 'ki') && t.data.hex }) && (
        <p className="text-sm" data-testid="combo-rider">
          Počítá s {ctx.rider.name}: +{ctx.rider.dice} {ctx.rider.type.toLowerCase()} ke zranění (vypneš přepínačem nahoře).
        </p>
      )}
      {d.steps.length > 0 && (
        <ol className="list-decimal space-y-0.5 pl-5 text-sm">
          {d.steps.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
      )}
      {d.description && <p className="text-sm text-muted-foreground">{d.description}</p>}
    </Shell>
  )
}

export function RuleCard({ tactic, controls }: { tactic: Extract<Tactic, { kind: 'rule' }>; controls: EditControls }) {
  return (
    <li className="rounded-xl border bg-card" data-tactic-kind="rule">
      <details className="group">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 font-medium [&::-webkit-details-marker]:hidden">
          <ChevronDownIcon aria-hidden className="size-4 shrink-0 transition-transform group-open:rotate-180" />
          <span className="min-w-0 break-words">{tactic.title}</span>
        </summary>
        <p className="px-3 pb-3 text-sm text-muted-foreground">{tactic.data.text}</p>
      </details>
      <EditBar tactic={tactic} controls={controls} className="p-2" />
    </li>
  )
}
