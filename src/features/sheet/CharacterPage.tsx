import { ConditionImpacts } from './ConditionImpacts'
import { useEffect } from 'react'
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeftIcon, SparklesIcon, TrendingUpIcon } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { Masonry, MasonryItem } from '@/components/Masonry'
import { FullPageSpinner } from '@/components/FullPageSpinner'
import { cn } from '@/lib/utils'
import { AbilitiesCard, SavesCard, SkillsCard } from './AbilitiesCard'
import { Avatar } from './Avatar'
import { AttacksCard } from './AttacksCard'
import { CompanionsCard } from '@/features/companions/CompanionsCard'
import { FeaturesTab } from './FeaturesTab'
import { InventoryTab } from './InventoryTab'
import { SpellsTab } from './SpellsTab'
import { TacticsTab } from '@/features/tactics/TacticsTab'
import { HpCard } from './HpCard'
import { ProfileTab } from './ProfileTab'
import { RestButtons } from './RestDialog'
import { rememberCampaign, rememberCharacter } from '@/features/campaigns/active-campaign'
import { DiceDock } from '@/features/dice/DiceDock'
import { RollModeSwitch } from '@/features/dice/RollModeSwitch'
import { EffectsCard } from './EffectsCard'
import { MissingInfo } from './MissingInfo'
import { ResourcesCard } from './ResourcesCard'
import { SheetProvider } from './SheetContext'
import { useSheet } from './sheet-context'
import { SpellcastingCard } from './SpellcastingCard'
import { StatsCard } from './StatsCard'
import { useCharacter, useEngineBundle } from './api'
import { usePageTitle } from '@/lib/page-title'

const TABS = [
  { id: 'overview', label: 'Přehled' },
  { id: 'spells', label: 'Kouzla' },
  { id: 'inventory', label: 'Inventář' },
  { id: 'tactics', label: 'Taktiky' },
  { id: 'features', label: 'Featury' },
  { id: 'profile', label: 'Postava' },
] as const
type TabId = (typeof TABS)[number]['id']

/** Záložka je v adrese (`?tab=inventory`), takže na ni jde odkázat (dolní lišta, úvodní stránka kampaně) a obnovení stránky ji zachová. */
const tabFromParam = (value: string | null): TabId => TABS.find((t) => t.id === value)?.id ?? 'overview'

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
  usePageTitle(character.name)
  const [searchParams, setSearchParams] = useSearchParams()
  const tab = tabFromParam(searchParams.get('tab'))
  const setTab = (next: TabId) => setSearchParams(next === 'overview' ? {} : { tab: next }, { replace: true })
  useEffect(() => {
    // Spodní lišta pak míří na tuhle postavu a do její kampaně.
    rememberCampaign(character.campaignId)
    rememberCharacter(character.campaignId, character.id)
  }, [character.campaignId, character.id])

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
        <div className="min-w-0 flex-1 basis-44">
          <h1 className="truncate text-2xl font-bold">{character.name}</h1>
          {character.kind === 'npc' && (
            <p data-testid="npc-badge" className="mb-1 inline-flex rounded-full border border-primary px-2 text-xs font-medium text-primary">
              NPC · hraje za něj DM
            </p>
          )}
          <p className="text-muted-foreground">{[character.race, sheet.classSummary].filter(Boolean).join(' · ')}</p>
          <p className="text-sm text-muted-foreground">
            Level {sheet.totalLevel}
          </p>
        </div>
        {canEdit && sheet.totalLevel < 20 && (
          <Link to={`/characters/${character.id}/levelup`} className={buttonVariants({ variant: 'secondary' })}>
            <TrendingUpIcon aria-hidden /> Level up
          </Link>
        )}
        <Button
          variant={character.inspiration ? 'default' : 'outline'}
          aria-pressed={character.inspiration}
          disabled={!canEdit}
          onClick={() => adjust([{ op: 'inspiration', set: !character.inspiration }])}
        >
          <SparklesIcon aria-hidden /> Inspirace
        </Button>
      </header>

      <MissingInfo />

      {character.state.conditions.length > 0 && (
        <ul aria-label="Stavy" className="flex flex-wrap gap-2">
          {character.state.conditions.map((c) => (
            <li key={c} className="rounded-full border border-amber-500 bg-amber-500/10 px-3 py-1 text-sm">
              {c}
            </li>
          ))}
        </ul>
      )}
      <ConditionImpacts />

      <div className="sticky top-14 z-10 -mx-4 bg-background/95 backdrop-blur tab:-mx-6 tab:flex tab:flex-wrap tab:items-center tab:justify-between tab:gap-x-4 tab:px-6">
        <nav aria-label="Části karty postavy" className="overflow-x-auto px-4 py-2 tab:px-0">
          <ul className="flex gap-2">
            {TABS.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  aria-pressed={tab === t.id}
                  onClick={() => setTab(t.id)}
                  className={cn(
                    'inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-medium tab:px-3.5',
                    tab === t.id ? 'border-primary bg-primary text-primary-foreground' : 'bg-background hover:bg-muted',
                  )}
                >
                  {t.label}
                </button>
              </li>
            ))}
          </ul>
        </nav>
        {/* Na tabletu a počítači je režim hodu v přilepené liště, takže je na dosah i při posouvání. */}
        {canEdit && tab === 'overview' && (
          <div className="hidden py-2 tab:block">
            <RollModeSwitch />
          </div>
        )}
      </div>

      {tab === 'overview' && (
        <div className="space-y-4">
          {canEdit && (
            <div className="tab:hidden">
              <RollModeSwitch />
            </div>
          )}
          <StatsCard />
          {/* Karty se skládají do nejkratšího sloupce, ať vedle sebe nezůstávají prázdná místa; nahoře jsou životy a útoky. */}
          <Masonry>
            <MasonryItem>
              <div className="space-y-4">
                <HpCard />
                <RestButtons />
              </div>
            </MasonryItem>
            <MasonryItem>
              <AttacksCard />
            </MasonryItem>
            <MasonryItem>
              <CompanionsCard />
            </MasonryItem>
            <MasonryItem>
              <ResourcesCard />
            </MasonryItem>
            {/* Tablet na výšku: dovednosti přes obě šířky úplně dole. Počítač: vysoká karta je 4. v pořadí, ať ostatní karty sloupce vyvážíme. */}
            <MasonryItem className="tab:col-span-2 max-lg:order-last lg:col-span-1">
              <SkillsCard />
            </MasonryItem>
            <MasonryItem>
              <SpellcastingCard />
            </MasonryItem>
            <MasonryItem>
              <EffectsCard />
            </MasonryItem>
            <MasonryItem>
              <AbilitiesCard />
            </MasonryItem>
            <MasonryItem>
              <SavesCard />
            </MasonryItem>
          </Masonry>
        </div>
      )}
      {tab === 'spells' && <SpellsTab />}
      {tab === 'inventory' && <InventoryTab />}
      {tab === 'tactics' && <TacticsTab />}
      {tab === 'features' && <FeaturesTab />}
      {tab === 'profile' && <ProfileTab />}
      <DiceDock campaignId={character.campaignId} characterId={character.id} />
    </div>
  )
}
