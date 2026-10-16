import { useMemo, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import {
  ArrowLeftIcon,
  CoinsIcon,
  PlusIcon,
  HeartPulseIcon,
  PackagePlusIcon,
  ShieldPlusIcon,
  SparklesIcon,
  SwordsIcon,
  ZapIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { FullPageSpinner } from '@/components/FullPageSpinner'
import { SectionHeader } from '@/components/SectionHeader'
import { EnemiesSection } from '@/features/enemies/EnemiesSection'
import { EnemyForm } from '@/features/enemies/EnemyForm'
import { useEnemies, type Enemy } from '@/features/enemies/api'
import { InitiativeSection } from '@/features/initiative/InitiativeSection'
import { useCampaign } from '@/features/campaigns/api'
import { engineRulesOf } from '@/features/campaigns/ruleset'
import { Avatar } from '@/features/sheet/Avatar'
import { useCharacters, useEngineBundle } from '@/features/sheet/api'
import { deriveSheet } from '@/features/sheet/model'
import type { CharacterFull } from '@/features/sheet/types'
import { DURATION_LABELS, effectLabel, formatBonus } from '@/features/sheet/effects'
import { ApiError } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useDmHp, useRemoveEffect, useSetCondition } from './api'
import { DmDialogs, type DmAction, type DmTarget } from './DmDialogs'
import { NotesPanel } from './NotesPanel'
import { DiceDock } from '@/features/dice/DiceDock'
import { usePageTitle } from '@/lib/page-title'

const ACTIONS: { id: DmAction; label: string; icon: typeof ZapIcon }[] = [
  { id: 'hp', label: 'Zranění / léčení', icon: HeartPulseIcon },
  { id: 'temp', label: 'Dočasná HP', icon: ShieldPlusIcon },
  { id: 'currency', label: 'Peníze', icon: CoinsIcon },
  { id: 'item', label: 'Item', icon: PackagePlusIcon },
  { id: 'condition', label: 'Stav', icon: ZapIcon },
  { id: 'inspiration', label: 'Inspirace', icon: SparklesIcon },
  { id: 'effect', label: 'Bonus', icon: SwordsIcon },
]

export function DmPage() {
  const { campaignId = '' } = useParams<{ campaignId: string }>()
  const { data: campaign, isPending } = useCampaign(campaignId)
  usePageTitle('Panel DM', campaign?.name)
  const { data: bundle } = useEngineBundle()
  const { data: list } = useCharacters(campaignId, { pollMs: 5000 })
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [action, setAction] = useState<DmAction | null>(null)
  const [enemyForm, setEnemyForm] = useState<{ enemy?: Enemy } | null>(null)
  const isDm = campaign?.role === 'dm'
  const { data: enemies } = useEnemies(campaignId, isDm)
  const rules = useMemo(() => engineRulesOf(campaign?.settings), [campaign?.settings])

  const rows = useMemo(() => {
    if (!bundle || !list) return []
    return list
      .filter((c): c is CharacterFull => c.access === 'full')
      .sort((a, b) => Number(a.kind === 'npc') - Number(b.kind === 'npc')) // NPC až za postavami hráčů
      .map((character) => {
        const { sheet, hpCurrent } = deriveSheet(character, bundle, rules)
        return { character, sheet, hpCurrent }
      })
  }, [bundle, list, rules])

  if (isPending) return <FullPageSpinner />
  if (!campaign) return <Navigate to="/" replace />
  // Panel je jen pro DM; hráč se vrátí na kampaň.
  if (campaign.role !== 'dm') return <Navigate to={`/campaigns/${campaignId}`} replace />

  const targets: DmTarget[] = rows.filter((r) => selected.has(r.character.id)).map((r) => ({ id: r.character.id, name: r.character.name, hpMax: r.sheet.hp.max.value }))
  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <>
      <div className="space-y-2">
        <Link to={`/campaigns/${campaignId}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeftIcon aria-hidden className="size-4" /> {campaign.name}
        </Link>
        <SectionHeader level={1} title="Panel DM" />
      </div>

      <Card className="lg:sticky lg:top-[4.25rem] lg:z-[5]">
        <CardContent className="space-y-3 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p aria-live="polite" className="text-sm">
              Vybráno: <strong>{targets.length}</strong> z {rows.length}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => setSelected(new Set(rows.filter((r) => r.character.kind !== 'npc').map((r) => r.character.id)))} disabled={rows.length === 0}>
                Vybrat všechny hráče
              </Button>
              <Button variant="ghost" onClick={() => setSelected(new Set())} disabled={targets.length === 0}>
                Zrušit výběr
              </Button>
            </div>
          </div>
          <div role="group" aria-label="Akce pro vybrané postavy" className="flex flex-wrap gap-2">
            {ACTIONS.map(({ id, label, icon: Icon }) => (
              <Button key={id} variant="secondary" disabled={targets.length === 0} onClick={() => setAction(id)}>
                <Icon aria-hidden /> {label}
              </Button>
            ))}
          </div>
          {targets.length === 0 && <p className="text-sm text-muted-foreground">Nejdřív zaškrtni postavy, kterých se akce týká.</p>}
        </CardContent>
      </Card>

      <InitiativeSection
        campaignId={campaignId}
        characters={rows.map((r) => ({ id: r.character.id, name: r.character.name, photoVersion: r.character.photoVersion, npc: r.character.kind === 'npc', bonus: r.sheet.initiative.value }))}
        enemies={enemies ?? []}
      />

      <SectionHeader
        title="Postavy a NPC"
        actions={
          <Link to={`/campaigns/${campaignId}/characters/new?npc=1`} className={buttonVariants({ variant: 'secondary' })}>
            <PlusIcon aria-hidden /> Nové NPC
          </Link>
        }
      />
      {!list || !bundle ? (
        <p className="text-muted-foreground">Načítám postavy…</p>
      ) : rows.length === 0 ? (
        <p className="text-muted-foreground">V kampani zatím nejsou žádné postavy.</p>
      ) : (
        <ul aria-label="Postavy" className="grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-2 xl:grid-cols-3">
          {rows.map(({ character, sheet, hpCurrent }) => (
            <CharacterOverview
              key={character.id}
              campaignId={campaignId}
              character={character}
              sheet={sheet}
              hpCurrent={hpCurrent}
              selected={selected.has(character.id)}
              onToggle={() => toggle(character.id)}
            />
          ))}
        </ul>
      )}

      <EnemiesSection campaignId={campaignId} enemies={enemies ?? []} onAdd={() => setEnemyForm({})} onEdit={(enemy) => setEnemyForm({ enemy })} />

      <NotesPanel campaignId={campaignId} characters={rows.map((r) => ({ id: r.character.id, name: r.character.name }))} />

      <DiceDock campaignId={campaignId} />
      {enemyForm && <EnemyForm key={enemyForm.enemy?.id ?? 'new'} campaignId={campaignId} enemy={enemyForm.enemy} onClose={() => setEnemyForm(null)} />}

      <DmDialogs action={action} campaignId={campaignId} targets={targets} onClose={() => setAction(null)} />
    </>
  )
}

function CharacterOverview({
  campaignId,
  character,
  sheet,
  hpCurrent,
  selected,
  onToggle,
}: {
  campaignId: string
  character: CharacterFull
  sheet: ReturnType<typeof deriveSheet>['sheet']
  hpCurrent: number
  selected: boolean
  onToggle: () => void
}) {
  const hp = useDmHp(campaignId)
  const removeEffect = useRemoveEffect(campaignId)
  const setCondition = useSetCondition(campaignId)
  const max = sheet.hp.max.value
  const percent = max > 0 ? Math.max(0, Math.min(100, Math.round((hpCurrent / max) * 100))) : 0
  const resources = sheet.resources.filter((r) => r.max.value > 0)
  const slots = sheet.spellcasting.slots.filter((s) => s.max > 0)

  function change(delta: number) {
    hp.mutate(
      { delta, targets: [{ characterId: character.id, max }] },
      { onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Změna HP se nepodařila.') },
    )
  }

  return (
    <li className={cn('rounded-xl border bg-card p-4', selected && 'border-primary ring-2 ring-primary/40')}>
      <div className="flex items-start gap-3">
        <label className="flex min-h-11 min-w-11 items-center justify-center">
          <input type="checkbox" className="size-5" checked={selected} onChange={onToggle} aria-label={`Vybrat ${character.name}`} />
        </label>
        <Avatar id={character.id} name={character.name} version={character.photoVersion} className="size-12 text-xl" />
        <div className="min-w-0 flex-1">
          <Link to={`/characters/${character.id}`} className="block truncate font-semibold underline-offset-4 hover:underline">
            {character.name}
          </Link>
          {character.kind === 'npc' && <span className="mb-0.5 inline-flex rounded-full border border-primary px-2 text-xs font-medium text-primary">NPC</span>}
          <p className="truncate text-sm text-muted-foreground">
            {[character.race, sheet.classSummary].filter(Boolean).join(' · ')} · level {sheet.totalLevel}
          </p>
          <p className="text-xs text-muted-foreground">
            {character.inspiration && <span className="ml-2 font-medium text-amber-600">★ inspirace</span>}
          </p>
        </div>
      </div>

      <dl className="mt-3 grid grid-cols-3 gap-2 text-center text-sm">
        <div className="rounded-lg bg-muted/50 p-2">
          <dt className="text-xs text-muted-foreground">AC</dt>
          <dd className="text-lg font-semibold">{sheet.ac.value}</dd>
        </div>
        <div className="rounded-lg bg-muted/50 p-2">
          <dt className="text-xs text-muted-foreground">Pas. vnímání</dt>
          <dd className="text-lg font-semibold">{sheet.passivePerception.value}</dd>
        </div>
        <div className="rounded-lg bg-muted/50 p-2">
          <dt className="text-xs text-muted-foreground">Rychlost</dt>
          <dd className="text-lg font-semibold">{sheet.speed.value}</dd>
        </div>
      </dl>

      <div className="mt-3 space-y-2">
        <p className="flex items-baseline justify-between text-sm">
          <span>
            HP: <strong data-testid={`hp-${character.name}`}>{hpCurrent}</strong> / {max}
            {character.state.hpTemp > 0 && <span className="text-muted-foreground"> (+{character.state.hpTemp} dočasná)</span>}
          </span>
        </p>
        <div className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
          <div className={cn('h-full', percent > 50 ? 'bg-green-500' : percent > 25 ? 'bg-amber-500' : 'bg-red-500')} style={{ width: `${percent}%` }} />
        </div>
        {hpCurrent === 0 && (
          <p className="text-sm font-medium text-red-700 dark:text-red-400" data-testid={`death-${character.name}`}>
            Death saves: ✓ {character.state.deathSuccesses}/3 · ✗ {character.state.deathFailures}/3
          </p>
        )}
        <div className="grid grid-cols-4 gap-2">
          {[-5, -1, 1, 5].map((d) => (
            <Button key={d} variant="outline" disabled={hp.isPending} aria-label={`${character.name}: ${d > 0 ? '+' : '−'}${Math.abs(d)} HP`} onClick={() => change(d)}>
              {d > 0 ? `+${d}` : `−${Math.abs(d)}`}
            </Button>
          ))}
        </div>
      </div>

      {character.state.conditions.length > 0 && (
        <ul aria-label="Stavy" className="mt-3 flex flex-wrap gap-2">
          {character.state.conditions.map((c) => (
            <li key={c}>
              <button
                type="button"
                title="Zrušit stav"
                aria-label={`Zrušit stav ${c} u ${character.name}`}
                disabled={setCondition.isPending}
                onClick={() =>
                  setCondition.mutate(
                    { characterIds: [character.id], name: c, set: false },
                    { onSuccess: () => toast.success(`Stav zrušen: ${c}`), onError: (err) => toast.error(err instanceof ApiError ? err.message : 'Stav se nepodařilo zrušit.') },
                  )
                }
                className="inline-flex min-h-11 items-center gap-1 rounded-full border border-amber-500 bg-amber-500/10 px-3 text-xs hover:bg-amber-500/20"
              >
                {c} <span aria-hidden>✕</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {(resources.length > 0 || slots.length > 0 || sheet.spellcasting.pact) && (
        <ul aria-label="Zdroje" className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
          {slots.map((s) => (
            <li key={s.level}>
              Slot {s.level}: {s.max - s.used}/{s.max}
            </li>
          ))}
          {sheet.spellcasting.pact && (
            <li>
              Pact: {sheet.spellcasting.pact.count - sheet.spellcasting.pact.used}/{sheet.spellcasting.pact.count}
            </li>
          )}
          {resources.map((r) => (
            <li key={r.key}>
              {r.name}: {r.current}/{r.max.value}
            </li>
          ))}
        </ul>
      )}

      {character.effects.length > 0 && (
        <ul aria-label="Bonusy" className="mt-3 space-y-1">
          {character.effects.map((e) => (
            <li key={e.id} className="flex items-center justify-between gap-2 rounded-lg border px-2 py-1 text-sm">
              <span className="min-w-0 truncate">
                <strong>
                  {formatBonus(e.value)} {effectLabel(e.target)}
                </strong>{' '}
                <span className="text-muted-foreground">
                  {e.source} · {DURATION_LABELS[e.duration]}
                </span>
              </span>
              <Button
                variant="ghost"
                aria-label={`Zrušit bonus ${e.source} u ${character.name}`}
                disabled={removeEffect.isPending}
                onClick={() =>
                  removeEffect.mutate(e.id, {
                    onSuccess: () => toast.success('Bonus zrušen'),
                    onError: (err) => toast.error(err instanceof ApiError ? err.message : 'Bonus se nepodařilo zrušit.'),
                  })
                }
              >
                Zrušit
              </Button>
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}
