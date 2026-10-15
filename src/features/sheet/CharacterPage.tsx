import { useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { ArrowLeftIcon, SparklesIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { FullPageSpinner } from '@/components/FullPageSpinner'
import { cn } from '@/lib/utils'
import { AbilitiesCard, SavesCard, SkillsCard } from './AbilitiesCard'
import { Avatar } from './Avatar'
import { AttacksCard } from './AttacksCard'
import { FeaturesTab } from './FeaturesTab'
import { HpCard } from './HpCard'
import { ProfileTab } from './ProfileTab'
import { RestButtons } from './RestDialog'
import { ResourcesCard } from './ResourcesCard'
import { SheetProvider } from './SheetContext'
import { useSheet } from './sheet-context'
import { SpellcastingCard } from './SpellcastingCard'
import { StatsCard } from './StatsCard'
import { useCharacter, useEngineBundle } from './api'

const TABS = [
  { id: 'overview', label: 'Přehled' },
  { id: 'features', label: 'Featury' },
  { id: 'profile', label: 'Postava' },
] as const
type TabId = (typeof TABS)[number]['id']

export function CharacterPage() {
  const { id } = useParams<{ id: string }>()
  const { data: character, isPending, error } = useCharacter(id)
  const { data: bundle, isPending: bundlePending, error: bundleError } = useEngineBundle()

  if (isPending || bundlePending) return <FullPageSpinner />
  if (error || !character) return <Navigate to="/" replace />
  if (bundleError || !bundle) return <p role="alert">Pravidla se nepodařilo načíst. Obnov stránku.</p>

  return (
    <SheetProvider character={character} bundle={bundle}>
      <SheetView />
    </SheetProvider>
  )
}

function SheetView() {
  const { character, sheet, canEdit, adjust } = useSheet()
  const [tab, setTab] = useState<TabId>('overview')

  return (
    <div className="space-y-4">
      <Link
        to={`/campaigns/${character.campaignId}`}
        className="inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeftIcon aria-hidden className="size-4" /> Zpět do kampaně
      </Link>

      <header className="flex flex-wrap items-center gap-4">
        <Avatar id={character.id} name={character.name} version={character.photoVersion} className="size-20 text-3xl" />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-bold">{character.name}</h1>
          <p className="text-muted-foreground">{[character.race, sheet.classSummary].filter(Boolean).join(' · ')}</p>
          <p className="text-sm text-muted-foreground">
            Level {sheet.totalLevel} · {character.xp} XP
          </p>
        </div>
        <Button
          variant={character.inspiration ? 'default' : 'outline'}
          aria-pressed={character.inspiration}
          disabled={!canEdit}
          onClick={() => adjust([{ op: 'inspiration', set: !character.inspiration }])}
        >
          <SparklesIcon aria-hidden /> Inspirace
        </Button>
      </header>

      {character.state.conditions.length > 0 && (
        <ul aria-label="Stavy" className="flex flex-wrap gap-2">
          {character.state.conditions.map((c) => (
            <li key={c} className="rounded-full border border-amber-500 bg-amber-500/10 px-3 py-1 text-sm">
              {c}
            </li>
          ))}
        </ul>
      )}

      <nav aria-label="Části karty postavy" className="-mx-4 overflow-x-auto px-4">
        <ul className="flex gap-2">
          {TABS.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                aria-pressed={tab === t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  'inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-medium',
                  tab === t.id ? 'border-primary bg-primary text-primary-foreground' : 'bg-background hover:bg-muted',
                )}
              >
                {t.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      {tab === 'overview' && (
        <div className="space-y-4">
          <StatsCard />
          <div className="grid gap-4 lg:grid-cols-3 lg:items-start">
            <div className="space-y-4">
              <HpCard />
              <RestButtons />
              <ResourcesCard />
            </div>
            <div className="space-y-4">
              <AttacksCard />
              <SpellcastingCard />
              <AbilitiesCard />
              <SavesCard />
            </div>
            <SkillsCard />
          </div>
        </div>
      )}
      {tab === 'features' && <FeaturesTab />}
      {tab === 'profile' && <ProfileTab />}
    </div>
  )
}
