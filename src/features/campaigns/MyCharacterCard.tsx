import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { PlusIcon, ShieldIcon, WindIcon } from 'lucide-react'
import { buttonVariants } from '@/components/ui/button'
import { useAuth } from '@/features/auth/auth-context'
import { Avatar } from '@/features/sheet/Avatar'
import { useCharacters, useEngineBundle } from '@/features/sheet/api'
import { deriveSheet } from '@/features/sheet/model'
import type { CharacterFull } from '@/features/sheet/types'
import { cn } from '@/lib/utils'
import { useCampaign } from './api'
import { engineRulesOf } from './ruleset'

/** Moje postava na úvodní stránce kampaně: HP, AC, rychlost a stavy na první pohled a odkaz na celý sheet. */
export default function MyCharacterCard({ campaignId }: { campaignId: string }) {
  const { user } = useAuth()
  const { data: campaign } = useCampaign(campaignId)
  const { data: characters } = useCharacters(campaignId)
  const { data: bundle } = useEngineBundle()
  const rules = useMemo(() => engineRulesOf(campaign?.settings), [campaign?.settings])
  const mine = characters?.filter((c): c is CharacterFull => c.ownerId === user?.id && c.access === 'full') ?? []

  if (!characters) return null
  if (mine.length === 0) {
    return (
      <section aria-label="Moje postava" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-dashed bg-card p-4">
        <p className="text-muted-foreground">V téhle kampani zatím nemáš postavu.</p>
        <Link to={`/campaigns/${campaignId}/characters/new`} className={buttonVariants()}>
          <PlusIcon aria-hidden /> Vytvořit postavu
        </Link>
      </section>
    )
  }

  return (
    <section aria-label="Moje postava" className="space-y-3">
      {mine.map((c) => {
        const derived = bundle ? deriveSheet(c, bundle, rules) : null
        const max = derived?.sheet.hp.max.value ?? 0
        const hp = derived?.hpCurrent ?? 0
        const percent = max > 0 ? Math.max(0, Math.min(100, Math.round((hp / max) * 100))) : 0
        return (
          <Link
            key={c.id}
            to={`/characters/${c.id}`}
            className="block rounded-2xl border bg-card p-4 shadow-sm transition-colors hover:border-primary/50"
          >
            <div className="flex items-center gap-4">
              <Avatar id={c.id} name={c.name} version={c.photoVersion} className="size-16 text-2xl" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-display text-xl font-semibold">{c.name}</p>
                <p className="truncate text-sm text-muted-foreground">
                  {[c.race, derived?.sheet.classSummary ?? c.classSummary].filter(Boolean).join(' · ')} · level {c.level}
                </p>
              </div>
            </div>
            {derived && (
              <div className="mt-3 space-y-3">
                <div>
                  <p className="mb-1 flex items-baseline justify-between text-sm">
                    <span className="font-medium">
                      HP {hp} / {max}
                      {c.state.hpTemp > 0 && <span className="text-muted-foreground"> (+{c.state.hpTemp})</span>}
                    </span>
                    <span className="text-xs text-muted-foreground">{percent} %</span>
                  </p>
                  <div className="h-2.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                    <div className={cn('h-full rounded-full', percent > 50 ? 'bg-green-500' : percent > 25 ? 'bg-amber-500' : 'bg-red-500')} style={{ width: `${percent}%` }} />
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="inline-flex items-center gap-1 rounded-full bg-muted px-3 py-1 font-medium">
                    <ShieldIcon aria-hidden className="size-4" /> AC {derived.sheet.ac.value}
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full bg-muted px-3 py-1 font-medium">
                    <WindIcon aria-hidden className="size-4" /> {derived.sheet.speed.value} ft
                  </span>
                  {c.inspiration && <span className="rounded-full bg-amber-500/15 px-3 py-1 font-medium text-amber-700 dark:text-amber-300">★ inspirace</span>}
                  {c.state.conditions.map((cond) => (
                    <span key={cond} className="rounded-full border border-amber-500 bg-amber-500/10 px-3 py-1">
                      {cond}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </Link>
        )
      })}
    </section>
  )
}
