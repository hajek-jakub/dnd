import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeftIcon, CopyIcon, UserMinusIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { FullPageSpinner } from '@/components/FullPageSpinner'
import { useAuth } from '@/features/auth/auth-context'
import { RoleBadge } from './RoleBadge'
import {
  useCampaign,
  useCampaignMembers,
  useCreateInvite,
  useDeleteCampaign,
  useInvites,
  useRemoveMember,
  useRevokeInvite,
} from './api'
import type { Invite } from '@/lib/types'
import { buildInviteLink } from './invite'
import { CharactersSection } from '@/features/sheet/CharactersSection'

export function CampaignPage() {
  const { campaignId } = useParams<{ campaignId: string }>()
  const { user } = useAuth()
  const navigate = useNavigate()
  const { data: campaign, isPending } = useCampaign(campaignId)
  const { data: members } = useCampaignMembers(campaignId)
  const myRole = members?.find((m) => m.userId === user?.id)?.role
  const isDm = myRole === 'dm'
  const removeMember = useRemoveMember(campaignId ?? '')
  const deleteCampaign = useDeleteCampaign(campaignId ?? '')

  if (isPending) return <FullPageSpinner />
  // Kampaň neexistuje, nebo k ní nemáme přístup (RLS ji nevrátí).
  if (!campaign) return <Navigate to="/" replace />

  function leave() {
    if (!user || !window.confirm('Opravdu chceš z kampaně odejít? Své postavy v ní už neuvidíš.')) return
    removeMember.mutate(user.id, {
      onSuccess: () => void navigate('/'),
      onError: () => toast.error('Z kampaně se nepodařilo odejít'),
    })
  }

  function removePlayer(userId: string, name: string) {
    if (!window.confirm(`Odebrat hráče ${name} z kampaně?`)) return
    removeMember.mutate(userId, { onError: () => toast.error('Hráče se nepodařilo odebrat') })
  }

  function remove() {
    if (!window.confirm(`Smazat kampaň „${campaign?.name}“ včetně všech dat? Tohle nejde vrátit.`)) return
    deleteCampaign.mutate(undefined, {
      onSuccess: () => void navigate('/'),
      onError: () => toast.error('Kampaň se nepodařilo smazat'),
    })
  }

  return (
    <>
      <div className="space-y-2">
        <Link to="/" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeftIcon aria-hidden className="size-4" /> Všechny kampaně
        </Link>
        <h1 className="text-2xl font-bold">{campaign.name}</h1>
        {myRole && <RoleBadge role={myRole} />}
        {campaign.description && <p className="whitespace-pre-line text-muted-foreground">{campaign.description}</p>}
      </div>

      {campaignId && <CharactersSection campaignId={campaignId} />}

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

        {isDm && campaignId && (
          <InvitesCard campaignId={campaignId} className="lg:col-start-2 lg:row-span-2 lg:row-start-1" />
        )}

        <Card className="lg:col-start-1">
          <CardHeader>
            <CardTitle>Nebezpečná zóna</CardTitle>
          </CardHeader>
          <CardContent>
            {isDm ? (
              <Button
                variant="destructive"
                className="w-full sm:w-auto"
                onClick={remove}
                disabled={deleteCampaign.isPending}
              >
                Smazat kampaň
              </Button>
            ) : (
              <Button
                variant="destructive"
                className="w-full sm:w-auto"
                onClick={leave}
                disabled={removeMember.isPending}
              >
                Odejít z kampaně
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
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
          onClick={() =>
            createInvite.mutate(
              { expiresInDays: 7, maxUses: null },
              { onError: () => toast.error('Pozvánku se nepodařilo vytvořit') },
            )
          }
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
                  <span className={status.active ? 'text-sm font-medium' : 'text-sm text-muted-foreground'}>
                    {status.label}
                  </span>
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
