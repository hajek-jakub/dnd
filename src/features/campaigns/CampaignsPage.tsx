import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { CalendarDaysIcon, ChevronRightIcon, CrownIcon, MailIcon, UsersIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { Avatar } from '@/features/sheet/Avatar'
import { useJournalUnread } from '@/features/journal/api'
import { useUnreadMessages } from '@/features/messages/api'
import { formatShort, relativeDays, toIso } from '@/features/sessions/dates'
import type { CampaignSummary, MyInvitation } from '@/lib/types'
import { RoleBadge } from './RoleBadge'
import { rememberCampaign, rememberedCampaign } from './active-campaign'
import { useAnswerInvitation, useCreateCampaign, useMyCampaigns, useMyInvitations } from './api'
import { extractInviteCode, isValidInviteCode } from './invite'
import type { Ruleset } from '@/engine'
import { RULESETS } from './ruleset'
import { usePageTitle } from '@/lib/page-title'

function localToday(): string {
  const now = new Date()
  return toIso(now.getFullYear(), now.getMonth() + 1, now.getDate())
}

/** Výběr kampaně: na co klepnout, když chci zrovna hrát. Plus pozvánky, založení nové kampaně a připojení kódem. */
export function CampaignsPage() {
  usePageTitle('Kampaně')
  const navigate = useNavigate()
  // Z přepínače „Nová kampaň“ (?new=1) se rovnou píše název.
  const wantsNew = useSearchParams()[0].get('new') === '1'
  const { data: campaigns, isPending, error } = useMyCampaigns()
  const { data: invitations } = useMyInvitations()
  const { data: messages } = useUnreadMessages()
  const { data: journal } = useJournalUnread()
  const createCampaign = useCreateCampaign()
  const [name, setName] = useState('')
  const [ruleset, setRuleset] = useState<Ruleset>('2014')
  const [codeInput, setCodeInput] = useState('')
  const [codeError, setCodeError] = useState<string | null>(null)
  const last = rememberedCampaign()
  const today = localToday()

  function onCreate(event: FormEvent) {
    event.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    createCampaign.mutate(
      { name: trimmed, settings: { ruleset } },
      {
        onSuccess: (campaign) => {
          setName('')
          rememberCampaign(campaign.id)
          void navigate(`/campaigns/${campaign.id}`)
        },
        onError: () => toast.error('Kampaň se nepodařilo založit'),
      },
    )
  }

  function onJoin(event: FormEvent) {
    event.preventDefault()
    const code = extractInviteCode(codeInput)
    if (!isValidInviteCode(code)) {
      setCodeError('Kód pozvánky má 10 znaků (písmena a číslice). Zkontroluj ho prosím.')
      return
    }
    setCodeError(null)
    void navigate(`/join/${code}`)
  }

  const unreadOf = (id: string) =>
    (messages?.campaigns.find((c) => c.campaignId === id)?.unread ?? 0) + (journal?.campaigns.find((c) => c.campaignId === id)?.unread ?? 0)

  return (
    // Telefon: vše pod sebou. Počítač: kampaně vlevo, založení a připojení vpravo.
    <div className="grid gap-6 tab:grid-cols-3 tab:items-start">
      <section className="space-y-4 tab:col-span-2">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold">Moje kampaně</h1>
          {(campaigns?.length ?? 0) > 1 && <p className="text-muted-foreground">Vyber kampaň, kterou chceš zrovna hrát.</p>}
        </div>
        {invitations && invitations.length > 0 && <InvitationList invitations={invitations} />}
        {isPending && <p className="text-muted-foreground">Načítám…</p>}
        {error && (
          <p role="alert" className="text-destructive">
            Kampaně se nepodařilo načíst.
          </p>
        )}
        {campaigns?.length === 0 && (
          <p className="text-muted-foreground">Zatím nejsi v žádné kampani. Založ novou (budeš v ní DM), nebo se připoj kódem od DM.</p>
        )}
        <ul className="grid grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-2">
          {campaigns?.map((campaign) => (
            <li key={campaign.id}>
              <CampaignTile campaign={campaign} last={campaign.id === last} unread={unreadOf(campaign.id)} today={today} />
            </li>
          ))}
        </ul>
      </section>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Nová kampaň</CardTitle>
            <CardDescription>Budeš v ní DM (s Panelem DM, lootem a AI pomocníkem) a hned po založení pozveš hráče.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onCreate} className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="campaign-name">Název kampaně</Label>
                <Input id="campaign-name" value={name} maxLength={100} required autoFocus={wantsNew} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-campaign-ruleset">Pravidla</Label>
                <NativeSelect id="new-campaign-ruleset" value={ruleset} onChange={(e) => setRuleset(e.target.value === '2024' ? '2024' : '2014')}>
                  {RULESETS.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <Button type="submit" disabled={createCampaign.isPending || !name.trim()} className="w-full">
                Založit kampaň
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Připojit se kódem</CardTitle>
            <CardDescription>Vlož kód nebo celý odkaz, který ti poslal DM.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onJoin} className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="invite-code">Kód pozvánky</Label>
                <Input
                  id="invite-code"
                  value={codeInput}
                  autoCapitalize="characters"
                  autoComplete="off"
                  spellCheck={false}
                  required
                  onChange={(e) => setCodeInput(e.target.value)}
                />
                {codeError && (
                  <p role="alert" className="text-sm text-destructive">
                    {codeError}
                  </p>
                )}
              </div>
              <Button type="submit" variant="secondary" className="w-full">
                Pokračovat
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function CampaignTile({ campaign, last, unread, today }: { campaign: CampaignSummary; last: boolean; unread: number; today: string }) {
  const character = campaign.myCharacter
  const session = campaign.nextSession
  return (
    <Link
      to={`/campaigns/${campaign.id}`}
      onClick={() => rememberCampaign(campaign.id)}
      data-testid="campaign-tile"
      className="flex min-h-24 items-center gap-3 rounded-xl border bg-card p-4 transition-colors hover:bg-muted"
    >
      {character ? (
        <Avatar id={character.id} name={character.name} version={character.photoVersion} className="size-12 text-base" />
      ) : (
        <span aria-hidden className="flex size-12 shrink-0 items-center justify-center rounded-full border bg-muted text-muted-foreground">
          {campaign.role === 'dm' ? <CrownIcon className="size-5" /> : <UsersIcon className="size-5" />}
        </span>
      )}
      <span className="min-w-0 flex-1 space-y-1">
        <span className="flex items-center gap-2">
          <span className="truncate font-display font-semibold">{campaign.name}</span>
          {unread > 0 && (
            <span className="flex min-w-5 shrink-0 items-center justify-center rounded-full bg-red-600 px-1 text-xs font-semibold text-white" aria-label={`${unread} nových`}>
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </span>
        <span className="flex flex-wrap items-center gap-1.5">
          <RoleBadge role={campaign.role} />
          {last && <span className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium">Naposledy</span>}
        </span>
        <span className="block truncate text-sm text-muted-foreground">
          {character ? character.name : campaign.role === 'dm' ? 'Jsi DM' : 'Zatím bez postavy'}
          {campaign.memberCount !== undefined && ` · ${campaign.memberCount} ${campaign.memberCount === 1 ? 'člen' : campaign.memberCount <= 4 ? 'členové' : 'členů'}`}
        </span>
        {session && (
          <span className="flex items-center gap-1 text-sm text-muted-foreground">
            <CalendarDaysIcon aria-hidden className="size-4 shrink-0" />
            <span className="truncate">
              Session {relativeDays(today, session.date)} ({formatShort(session.date)}
              {session.time ? ` v ${session.time}` : ''})
            </span>
          </span>
        )}
      </span>
      <ChevronRightIcon aria-hidden className="shrink-0 text-muted-foreground" />
    </Link>
  )
}

function InvitationList({ invitations }: { invitations: MyInvitation[] }) {
  const navigate = useNavigate()
  const answer = useAnswerInvitation()
  return (
    <section aria-label="Pozvánky do kampaní" className="space-y-2">
      {invitations.map((inv) => (
        <Card key={inv.id} size="sm" className="border-primary/50">
          <CardContent className="flex flex-wrap items-center gap-3">
            <MailIcon aria-hidden className="size-5 shrink-0 text-primary" />
            <p className="min-w-0 flex-1">
              <strong>{inv.invitedBy}</strong> tě zve do kampaně <strong>{inv.campaignName}</strong>
              {inv.dmName && inv.dmName !== inv.invitedBy && <span className="text-muted-foreground"> (DM {inv.dmName})</span>}
            </p>
            <div className="flex gap-2">
              <Button
                disabled={answer.isPending}
                // mutateAsync: seznam po optimistickém odebrání pozvánky zmizí a callbacky mutate by se už nezavolaly
                onClick={() =>
                  void answer.mutateAsync({ id: inv.id, accept: true }).then(
                    (campaignId) => {
                      if (!campaignId) return
                      rememberCampaign(campaignId)
                      toast.success(`Jsi v kampani ${inv.campaignName}`)
                      void navigate(`/campaigns/${campaignId}`)
                    },
                    () => toast.error('Pozvánku se nepodařilo přijmout'),
                  )
                }
              >
                Přijmout
              </Button>
              <Button
                variant="ghost"
                disabled={answer.isPending}
                onClick={() => void answer.mutateAsync({ id: inv.id, accept: false }).catch(() => toast.error('Pozvánku se nepodařilo odmítnout'))}
              >
                Odmítnout
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </section>
  )
}
