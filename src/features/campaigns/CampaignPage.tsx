import { lazy, Suspense } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { UserMinusIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { FullPageSpinner } from '@/components/FullPageSpinner'
import { Masonry, MasonryItem } from '@/components/Masonry'
import { useAuth } from '@/features/auth/auth-context'
import { RoleBadge } from './RoleBadge'
import { useCampaign, useCampaignMembers, useRemoveMember, useUpdateCampaignSettings } from './api'
import { InvitesCard } from './InvitesCard'
import { StartCard } from './StartCard'
import { RULESETS, rulesetOf } from './ruleset'
import { CharactersSection } from '@/features/sheet/CharactersSection'
import { JournalPreview } from '@/features/journal/JournalPreview'
import { SessionPreview } from '@/features/sessions/SessionPreview'
import { SecretSantaCard } from '@/features/secret-santa/SecretSantaCard'
import { useSecretSanta } from '@/features/secret-santa/api'
import { usePageTitle } from '@/lib/page-title'

// Karta s postavou počítá sheet enginem, proto se načítá až po úvodní stránce.
const MyCharacterCard = lazy(() => import('./MyCharacterCard'))

export function CampaignPage() {
  const { campaignId } = useParams<{ campaignId: string }>()
  const { user } = useAuth()
  const { data: campaign, isPending } = useCampaign(campaignId)
  usePageTitle(campaign?.name)
  const { data: members } = useCampaignMembers(campaignId)
  const myRole = members?.find((m) => m.userId === user?.id)?.role
  const isDm = myRole === 'dm'
  const removeMember = useRemoveMember(campaignId ?? '')
  const { data: santa } = useSecretSanta()

  if (isPending) return <FullPageSpinner />
  // Kampaň neexistuje, nebo k ní nemáme přístup (RLS ji nevrátí).
  if (!campaign) return <Navigate to="/" replace />

  function removePlayer(userId: string, name: string) {
    if (!window.confirm(`Odebrat hráče ${name} z kampaně?`)) return
    removeMember.mutate(userId, { onError: () => toast.error('Hráče se nepodařilo odebrat') })
  }

  return (
    <>
      <div className="space-y-2">
        <h1 className="font-display text-3xl font-bold">{campaign.name}</h1>
        <div className="flex flex-wrap items-center gap-2">
          {myRole && <RoleBadge role={myRole} />}
          <span data-testid="ruleset-badge" className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium">
            Pravidla {rulesetOf(campaign.settings)}
          </span>
        </div>
        {campaign.description && <p className="whitespace-pre-line text-muted-foreground">{campaign.description}</p>}
      </div>

      {/* Telefon: vše pod sebou. Tablet a počítač: moje postava a deník vlevo, družina a NPC vpravo. */}
      {campaignId && (
        <Masonry columns="tab:grid-cols-2">
          {isDm && members?.length === 1 && (
            <MasonryItem className="tab:col-span-2">
              <StartCard campaignId={campaignId} />
            </MasonryItem>
          )}
          {santa?.some((d) => d.campaignId === campaignId) && (
            <MasonryItem className="tab:col-span-2">
              <SecretSantaCard campaignId={campaignId} />
            </MasonryItem>
          )}
          <MasonryItem className="tab:col-span-2">
            <SessionPreview campaignId={campaignId} isDm={isDm} />
          </MasonryItem>
          <MasonryItem>
            <Suspense fallback={null}>
              <MyCharacterCard campaignId={campaignId} />
            </Suspense>
          </MasonryItem>
          <CharactersSection campaignId={campaignId} />
          <MasonryItem>
            <JournalPreview campaignId={campaignId} />
          </MasonryItem>
        </Masonry>
      )}
      <h2 className="pt-2 font-display text-xl font-semibold">Správa kampaně</h2>

      {/* Telefon: jeden sloupec. Tablet a počítač: karty se skládají do nejkratšího sloupce. */}
      <Masonry columns="tab:grid-cols-2">
        <MasonryItem>
        <Card>
          <CardHeader>
            <CardTitle>Členové</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {members?.map((member) => {
                const name = member.displayName
                return (
                  <li key={member.userId} className="flex min-h-14 items-center justify-between gap-3 py-2">
                    <span className="min-w-0 space-y-1">
                      <span className="block truncate font-medium">
                        {name}
                        {member.userId === user?.id && <span className="text-muted-foreground"> (ty)</span>}
                      </span>
                      <RoleBadge role={member.role} />
                    </span>
                    {isDm && member.role === 'player' && (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Odebrat hráče ${name}`}
                        title="Odebrat z kampaně"
                        onClick={() => removePlayer(member.userId, name)}
                      >
                        <UserMinusIcon aria-hidden />
                      </Button>
                    )}
                  </li>
                )
              })}
            </ul>
          </CardContent>
        </Card>
        </MasonryItem>

        {isDm && campaignId && (
          <MasonryItem>
            <InvitesCard campaignId={campaignId} campaignName={campaign.name} />
          </MasonryItem>
        )}

        {isDm && campaignId && (
          <MasonryItem>
            <Card>
              <CardHeader>
                <CardTitle>Nastavení kampaně</CardTitle>
              </CardHeader>
              <CardContent>
                <SettingsForm campaignId={campaignId} settings={campaign.settings} />
              </CardContent>
            </Card>
          </MasonryItem>
        )}
      </Masonry>
    </>
  )
}

function SettingsForm({ campaignId, settings }: { campaignId: string; settings: Record<string, unknown> | undefined }) {
  const update = useUpdateCampaignSettings(campaignId)
  const ruleset = rulesetOf(settings)
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="campaign-ruleset">Pravidla kampaně</Label>
        <NativeSelect
          id="campaign-ruleset"
          value={ruleset}
          onChange={(e) =>
            update.mutate(
              { ruleset: e.target.value === '2024' ? '2024' : '2014' },
              { onError: () => toast.error('Nastavení se nepodařilo uložit'), onSuccess: () => toast.success('Pravidla kampaně změněna') },
            )
          }
        >
          {RULESETS.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </NativeSelect>
        <p className="text-sm text-muted-foreground">
          Podle toho engine počítá martial arts kostku mnicha (d6 / d8 na 5. levelu), které zbraně jsou monk zbraně a jak se jmenuje ki (Ki / Focus Points).
          Data pravidel (itemy, kouzla, třídy) jsou zatím jen ze SRD 5.1.
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="campaign-crit">Kritický zásah</Label>
        <NativeSelect
          id="campaign-crit"
          value={settings?.critRule === 'double' ? 'double' : 'max'}
          onChange={(e) =>
            update.mutate(
              { critRule: e.target.value === 'double' ? 'double' : 'max' },
              { onError: () => toast.error('Nastavení se nepodařilo uložit'), onSuccess: () => toast.success('Pravidlo kritického zásahu změněno') },
            )
          }
        >
          <option value="max">Hod + plná kostka (1d8 → hod + 8)</option>
          <option value="double">Kostky dvakrát (pravidla 5e)</option>
        </NativeSelect>
        <p className="text-sm text-muted-foreground">
          Při kritickém zásahu se zranění hodí normálně a přičte se maximum kostek zranění (domácí pravidlo), nebo se kostky hodí podruhé, jak píše Player's Handbook. Bonus se nikdy nezdvojuje.
        </p>
      </div>
    </div>
  )
}
