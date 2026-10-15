import { ChevronDownIcon, ChevronUpIcon, PencilIcon, StarIcon, Trash2Icon, ZapIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { RollButton } from '@/features/dice/RollButton'
import { useSheet } from '@/features/sheet/sheet-context'
import type { DamageRider } from '@/features/sheet/riders'
import { cn } from '@/lib/utils'
import { ActionBadge, Badge, CostBadge } from './badges'
import { availability, formatCost, parseCost, spendOps } from './cost'
import { rollFor, toHitRoll } from './damage'
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

/** "Použít" odečte cenu (ki nebo slot) ze stavu postavy. Hod kostkou nic neodečítá, tlačítko je volitelné. */
function UseButton({ title, cost }: { title: string; cost: string }) {
  const { sheet, canEdit, adjust } = useSheet()
  const parsed = parseCost(cost)
  if (!canEdit || parsed.type === 'free') return null
  const avail = availability(parsed, sheet)
  return (
    <Button
      variant="outline"
      disabled={!avail.ok}
      aria-label={`Použít ${title}: zaplatit ${formatCost(cost)} (${avail.detail})`}
      onClick={() => {
        const ops = spendOps(parsed, sheet)
        if (!ops) return
        adjust(ops)
        toast.success(`${title}: odečteno ${formatCost(cost)}`)
      }}
    >
      <ZapIcon aria-hidden /> Použít
    </Button>
  )
}

const Field = ({ label, value }: { label: string; value: string }) =>
  value ? (
    <p className="text-sm">
      <span className="text-muted-foreground">{label}: </span>
      {value}
    </p>
  ) : null

export function AttackCard({ tactic, rider, controls }: { tactic: Extract<Tactic, { kind: 'attack' }>; rider: DamageRider | null; controls: EditControls }) {
  const d = tactic.data
  const hit = toHitRoll(d.toHit)
  const base = rollFor(d)
  const withRider = rider !== null && d.hex
  const dmg = base ? `${base}${withRider ? `+${rider.dice}` : ''}` : null
  const damageText = `${d.damage}${withRider ? ` + ${rider.dice} ${rider.type.toLowerCase()} (${rider.name})` : ''}`
  return (
    <Shell
      tactic={tactic}
      controls={controls}
      badges={
        <>
          <ActionBadge type={d.actionType} />
          <CostBadge cost={d.cost} />
        </>
      }
      actions={
        <>
          {hit && <RollButton label={`${tactic.title}: útok`} expression={hit} text="Útok" />}
          {dmg && <RollButton label={`${tactic.title}: zranění${withRider ? ` + ${rider.name}` : ''}`} expression={dmg} text="Zranění" />}
          {dmg && <RollButton label={`${tactic.title}: zranění${withRider ? ` + ${rider.name}` : ''}`} expression={dmg} crit text="Krit" />}
          <UseButton title={tactic.title} cost={d.cost} />
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

export function SpellCard({ tactic, controls }: { tactic: Extract<Tactic, { kind: 'spell' }>; controls: EditControls }) {
  const d = tactic.data
  const dmg = d.roll ? rollFor({ roll: d.roll }) : null
  return (
    <Shell
      tactic={tactic}
      controls={controls}
      badges={
        <>
          <Badge>{d.level === 0 ? 'Cantrip' : `${d.level}. úroveň`}</Badge>
          <ActionBadge type={d.actionType} />
          {d.concentration && <Badge>Soustředění</Badge>}
          <CostBadge cost={d.cost} />
        </>
      }
      actions={
        <>
          {dmg && <RollButton label={`${tactic.title}: zranění`} expression={dmg} text="Zranění" />}
          {dmg && <RollButton label={`${tactic.title}: zranění`} expression={dmg} crit text="Krit" />}
          <UseButton title={tactic.title} cost={d.cost} />
        </>
      }
    >
      <div className="space-y-0.5">
        <Field label="Dosah" value={d.range} />
        <Field label="Trvání" value={d.duration} />
        <Field label="Záchranný hod" value={d.save} />
        {d.effect && <p className="text-sm text-muted-foreground">{d.effect}</p>}
      </div>
    </Shell>
  )
}

export function KiCard({ tactic, controls }: { tactic: Extract<Tactic, { kind: 'ki' }>; controls: EditControls }) {
  const d = tactic.data
  return (
    <Shell
      tactic={tactic}
      controls={controls}
      badges={
        <>
          <ActionBadge type={d.actionType} />
          <CostBadge cost={d.cost} />
        </>
      }
      actions={<UseButton title={tactic.title} cost={d.cost} />}
    >
      {d.description && <p className="text-sm text-muted-foreground">{d.description}</p>}
    </Shell>
  )
}

export function PassiveCard({ tactic, controls }: { tactic: Extract<Tactic, { kind: 'passive' }>; controls: EditControls }) {
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
      actions={<UseButton title={tactic.title} cost={d.cost} />}
    >
      {d.description && <p className="text-sm text-muted-foreground">{d.description}</p>}
    </Shell>
  )
}

export function ComboCard({ tactic, controls }: { tactic: Extract<Tactic, { kind: 'combo' }>; controls: EditControls }) {
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
      actions={<UseButton title={tactic.title} cost={d.cost} />}
    >
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
