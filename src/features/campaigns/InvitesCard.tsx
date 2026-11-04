import { useState, type FormEvent } from 'react'
import { CopyIcon, Share2Icon, UserPlusIcon, XIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ApiError } from '@/lib/api'
import type { Invite } from '@/lib/types'
import { useCampaignInvitations, useCancelInvitation, useCreateInvite, useInviteSuggestions, useInviteUser, useInvites, useRevokeInvite } from './api'
import { buildInviteLink } from './invite'

function inviteStatus(invite: Invite): { label: string; active: boolean } {
  if (invite.revoked) return { label: 'Zrušená', active: false }
  if (invite.expiresAt && new Date(invite.expiresAt) <= new Date()) return { label: 'Vypršela', active: false }
  if (invite.maxUses !== null && invite.uses >= invite.maxUses) return { label: 'Vyčerpaná', active: false }
  return { label: 'Platná', active: true }
}

async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(`${what} zkopírován`)
  } catch {
    toast.error('Kopírování se nepodařilo, označ text a zkopíruj ho ručně')
  }
}

/** Telefon nabídne sdílení (WhatsApp, Messenger…), jinde se odkaz zkopíruje. */
async function share(link: string, campaignName: string) {
  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({ title: campaignName, text: `Přidej se do kampaně ${campaignName}`, url: link })
      return
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return
    }
  }
  await copy(link, 'Odkaz')
}

/**
 * Pozvání hráčů (jen DM) třemi způsoby: lidé, se kterými už DM hraje jinde (jedno klepnutí), přihlašovací jméno
 * existujícího uživatele (pozvánku přijme v aplikaci) a odkaz s kódem pro nové hráče, kteří účet ještě nemají.
 */
export function InvitesCard({ campaignId, campaignName, className }: { campaignId: string; campaignName: string; className?: string }) {
  return (
    <Card id="invite-players" className={className}>
      <CardHeader>
        <CardTitle>Pozvánky</CardTitle>
        <CardDescription>Pozvi hráče, kteří už aplikaci mají, nebo pošli odkaz novým. Každý se připojí jako hráč.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <InviteUsers campaignId={campaignId} />
        <InviteLinks campaignId={campaignId} campaignName={campaignName} />
      </CardContent>
    </Card>
  )
}

function InviteUsers({ campaignId }: { campaignId: string }) {
  const { data: pending } = useCampaignInvitations(campaignId)
  const { data: suggestions } = useInviteSuggestions(campaignId)
  const invite = useInviteUser(campaignId)
  const cancel = useCancelInvitation(campaignId)
  const [username, setUsername] = useState('')
  const [error, setError] = useState<string | null>(null)

  function onError(e: unknown) {
    setError(e instanceof ApiError ? e.message : 'Pozvánku se nepodařilo poslat')
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    const name = username.trim()
    if (!name) return
    setError(null)
    invite.mutate(
      { username: name },
      {
        onSuccess: () => {
          setUsername('')
          toast.success(`Pozvánka pro ${name} odeslána`)
        },
        onError,
      },
    )
  }

  return (
    <div className="space-y-4">
      {suggestions && suggestions.length > 0 && (
        <section aria-label="Lidé, se kterými už hraješ" className="space-y-2">
          <h3 className="text-sm font-medium">Lidé, se kterými už hraješ</h3>
          <ul className="flex flex-wrap gap-2">
            {suggestions.map((s) => (
              <li key={s.userId}>
                <Button
                  variant="secondary"
                  disabled={invite.isPending}
                  aria-label={`Pozvat ${s.displayName}`}
                  onClick={() => {
                    setError(null)
                    invite.mutate({ userId: s.userId }, { onSuccess: () => toast.success(`Pozvánka pro ${s.displayName} odeslána`), onError })
                  }}
                >
                  <UserPlusIcon aria-hidden /> {s.displayName}
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <form onSubmit={submit} className="space-y-2">
        <Label htmlFor="invite-username">Pozvat podle přihlašovacího jména</Label>
        <div className="flex gap-2">
          <Input
            id="invite-username"
            value={username}
            maxLength={30}
            autoCapitalize="none"
            autoComplete="off"
            spellCheck={false}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'invite-username-error' : undefined}
            onChange={(e) => setUsername(e.target.value)}
          />
          <Button type="submit" disabled={invite.isPending || !username.trim()}>
            Pozvat
          </Button>
        </div>
        {error && (
          <p id="invite-username-error" role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </form>

      {pending && pending.length > 0 && (
        <section aria-label="Čekající pozvánky" className="space-y-2">
          <h3 className="text-sm font-medium">Čeká na přijetí</h3>
          <ul className="divide-y rounded-lg border">
            {pending.map((p) => (
              <li key={p.id} className="flex min-h-12 items-center justify-between gap-2 py-1 pl-3 pr-1">
                <span className="min-w-0 truncate">
                  {p.displayName} <span className="text-sm text-muted-foreground">({p.username})</span>
                </span>
                <Button variant="ghost" size="icon" aria-label={`Zrušit pozvánku pro ${p.displayName}`} onClick={() => cancel.mutate(p.id)}>
                  <XIcon aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

function InviteLinks({ campaignId, campaignName }: { campaignId: string; campaignName: string }) {
  const { data: invites } = useInvites(campaignId, true)
  const createInvite = useCreateInvite(campaignId)
  const revoke = useRevokeInvite(campaignId)

  return (
    <section aria-label="Odkaz pro nové hráče" className="space-y-3">
      <h3 className="text-sm font-medium">Odkaz pro nové hráče (bez účtu)</h3>
      <Button
        className="w-full"
        variant="secondary"
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
                  <Button variant="secondary" onClick={() => void share(link, campaignName)}>
                    <Share2Icon aria-hidden /> Sdílet odkaz
                  </Button>
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
    </section>
  )
}
