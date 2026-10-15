import { lazy, Suspense, useState } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { CopyIcon, UserMinusIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { FullPageSpinner } from '@/components/FullPageSpinner'
import { useAuth } from '@/features/auth/auth-context'
import { RoleBadge } from './RoleBadge'
import {
  useCampaign,
  useCampaignMembers,
  useCreateInvite,
  useInvites,
  useRemoveMember,
  useRevokeInvite,
  useUpdateCampaignSettings,
} from './api'
import type { Invite } from '@/lib/types'
import { buildInviteLink } from './invite'
import { RULESETS, rulesetOf } from './ruleset'
import { DiceDock } from '@/features/dice/DiceDock'
import { CharactersSection } from '@/features/sheet/CharactersSection'
import { JournalPreview } from '@/features/journal/JournalPreview'

// Karta s postavou počítá sheet enginem, proto se načítá až po úvodní stránce.
const MyCharacterCard = lazy(() => import('./MyCharacterCard'))

export function CampaignPage() {
  const { campaignId } = useParams<{ campaignId: string }>()
  const { user } = useAuth()
  const { data: campaign, isPending } = useCampaign(campaignId)
  const { data: members } = useCampaignMembers(campaignId)
  const myRole = members?.find((m) => m.userId === user?.id)?.role
  const isDm = myRole === 'dm'
  const removeMember = useRemoveMember(campaignId ?? '')

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

      {campaignId && (
        <Suspense fallback={null}>
          <MyCharacterCard campaignId={campaignId} />
        </Suspense>
      )}
      {campaignId && <JournalPreview campaignId={campaignId} />}
      {campaignId && <CharactersSection campaignId={campaignId} />}
      <h2 className="pt-2 font-display text-xl font-semibold">Správa kampaně</h2>

      {/* Telefon: jeden sloupec (členové, pozvánky, nebezpečná zóna).
          Počítač (DM): členové a nebezpečná zóna vlevo, pozvánky vpravo přes obě řady. */}
      <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
        <Card className="lg:col-start-1">
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

        {isDm && campaignId && <InvitesCard campaignId={campaignId} className="lg:col-start-2 lg:row-span-2 lg:row-start-1" />}

        {isDm && campaignId && (
          <Card className="lg:col-start-1">
            <CardHeader>
              <CardTitle>Nastavení kampaně</CardTitle>
            </CardHeader>
            <CardContent>
              <SettingsForm campaignId={campaignId} settings={campaign.settings} />
            </CardContent>
          </Card>
        )}

      </div>
      {campaignId && <DiceDock campaignId={campaignId} />}
    </>
  )
}

function inviteStatus(invite: Invite): { label: string; active: boolean } {
  if (invite.revoked) return { label: 'Zrušená', active: false }
  if (invite.expiresAt && new Date(invite.expiresAt) <= new Date()) return { label: 'Vypršela', active: false }
  if (invite.maxUses !== null && invite.uses >= invite.maxUses) return { label: 'Vyčerpaná', active: false }
  return { label: 'Platná', active: true }
}

function InvitesCard({ campaignId, className }: { campaignId: string; className?: string }) {
  const { data: invites } = useInvites(campaignId, true)
  const createInvite = useCreateInvite(campaignId)
  const revoke = useRevokeInvite(campaignId)

  async function copy(text: string, what: string) {
    try {
      await navigator.clipboard.writeText(text)
      toast.success(`${what} zkopírován`)
    } catch {
      toast.error('Kopírování se nepodařilo, označ text a zkopíruj ho ručně')
    }
  }

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>Pozvánky</CardTitle>
        <CardDescription>Pošli hráčům odkaz nebo kód. Každý, kdo ho otevře, se připojí jako hráč.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Button
          className="w-full"
          disabled={createInvite.isPending}
          onClick={() => createInvite.mutate({ expiresInDays: 7, maxUses: null }, { onError: () => toast.error('Pozvánku se nepodařilo vytvořit') })}
        >
          Vytvořit pozvánku (platí 7 dní)
        </Button>

        <ul className="space-y-3">
          {invites?.map((invite) => {
            const status = inviteStatus(invite)
            const link = buildInviteLink(invite.code)
            return (
              <li key={invite.id} className="space-y-2 rounded-lg border p-3">
                <div className="flex items-center justify-between gap-2">
                  <code className="text-lg font-semibold tracking-widest">{invite.code}</code>
                  <span className={status.active ? 'text-sm font-medium' : 'text-sm text-muted-foreground'}>{status.label}</span>
                </div>
                <p className="text-sm text-muted-foreground">
                  Použito: {invite.uses}
                  {invite.maxUses !== null && ` z ${invite.maxUses}`}
                  {invite.expiresAt && ` · platí do ${new Date(invite.expiresAt).toLocaleDateString('cs-CZ')}`}
                </p>
                {status.active && (
                  <div className="flex flex-wrap gap-2">
                    <Button variant="secondary" onClick={() => void copy(link, 'Odkaz')}>
                      <CopyIcon aria-hidden /> Kopírovat odkaz
                    </Button>
                    <Button variant="secondary" onClick={() => void copy(invite.code, 'Kód')}>
                      <CopyIcon aria-hidden /> Kopírovat kód
                    </Button>
                    <Button variant="ghost" onClick={() => revoke.mutate(invite.id)}>
                      Zrušit
                    </Button>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      </CardContent>
    </Card>
  )
}

function SettingsForm({ campaignId, settings }: { campaignId: string; settings: Record<string, unknown> | undefined }) {
  const update = useUpdateCampaignSettings(campaignId)
  // Přepínač se přepne okamžitě (synchronně), server se dozví změnu na pozadí; při chybě se vrátí.
  const [optimistic, setOptimistic] = useState<boolean | null>(null)
  const checked = optimistic ?? settings?.encumbrance === true
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
      <label className="flex min-h-11 cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          className="mt-1 size-5 shrink-0 accent-primary"
          checked={checked}
          onChange={(e) => {
            setOptimistic(e.target.checked)
            update.mutate(
              { encumbrance: e.target.checked },
              {
                onError: () => toast.error('Nastavení se nepodařilo uložit'),
                onSettled: () => setOptimistic(null),
              },
            )
          }}
        />
        <span>
          Sledovat nosnost a přetížení
          <span className="block text-sm text-muted-foreground">Nad 5× STR liber −10 ft rychlosti, nad 10× STR −20 ft (volitelné pravidlo z PHB).</span>
        </span>
      </label>
    </div>
  )
}
