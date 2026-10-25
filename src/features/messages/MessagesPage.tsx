import { useEffect, useMemo } from 'react'
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeftIcon, ClipboardListIcon, LanguagesIcon, LockIcon, MessageSquareIcon, UsersIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { FullPageSpinner } from '@/components/FullPageSpinner'
import { useAuth } from '@/features/auth/auth-context'
import { useCampaign, useCampaignMembers } from '@/features/campaigns/api'
import { cn } from '@/lib/utils'
import { LANGUAGE_CATALOG, languageLabel } from '@/features/sheet/languages'
import { DraftsPanel } from './DraftsPanel'
import { useMarkThreadRead, useMessages } from './api'
import type { ThreadInfo } from './Composer'
import { ThreadChat } from './ThreadChat'
import { usePageTitle } from '@/lib/page-title'

/** Popisek vlákna `lang:<slug>` podle číselníku (pro vlákna, kde jazyk neznám: DM, nebo jazyk už postava nemá). */
function languageThreadLabel(thread: string): string {
  const slug = thread.slice(5)
  return languageLabel(LANGUAGE_CATALOG.find((l) => l.name.toLowerCase().replace(/[^a-z]+/g, '-') === slug)?.name ?? slug.replace(/^./u, (c) => c.toUpperCase()))
}

export function MessagesPage() {
  const { campaignId = '' } = useParams<{ campaignId: string }>()
  const { user } = useAuth()
  const { data: campaign, isPending } = useCampaign(campaignId)
  usePageTitle('Zprávy', campaign?.name)
  const { data: members } = useCampaignMembers(campaignId)
  const { data: state } = useMessages(campaignId)
  const markRead = useMarkThreadRead(campaignId)
  const [params, setParams] = useSearchParams()

  const me = user?.id ?? ''
  const isDm = campaign?.role === 'dm'
  const dmMember = members?.find((m) => m.role === 'dm')
  const messages = useMemo(() => state?.messages ?? [], [state?.messages])
  const unread = state?.unread ?? {}
  const languages = useMemo(() => state?.languages ?? [], [state?.languages])

  const threads = useMemo<ThreadInfo[]>(() => {
    const list: ThreadInfo[] = [{ id: 'group', label: 'Skupina', hint: 'Vidí všichni v kampani', icon: 'group' }]
    if (isDm) {
      for (const m of members?.filter((x) => x.role === 'player') ?? []) {
        list.push({ id: `dm:${m.userId}`, label: m.displayName, hint: 'Soukromě mezi tebou a hráčem', icon: 'private' })
      }
      list.push({ id: 'secret', label: 'Tajné zprávy', hint: 'Jen vybraní hráči', icon: 'secret' })
      // Vlákna v jazycích, kde už hráči něco napsali; DM je jen čte.
      for (const t of new Set(messages.filter((m) => m.thread.startsWith('lang:')).map((m) => m.thread))) {
        list.push({ id: t, label: languageThreadLabel(t), hint: 'Hráči, kteří umí tento jazyk. Ty jen čteš.', icon: 'language' })
      }
      list.push({ id: 'drafts', label: 'Připravené zprávy', hint: 'Nachystej předem, odešli jedním klepnutím', icon: 'draft' })
    } else {
      if (dmMember) list.push({ id: `dm:${me}`, label: `${dmMember.displayName} (DM)`, hint: 'Soukromě jen mezi tebou a DM', icon: 'private' })
      if (messages.some((m) => m.thread === 'secret')) list.push({ id: 'secret', label: 'Tajné zprávy', hint: 'Zprávy od DM jen pro vybrané', icon: 'secret' })
      // Jazyky, které umím a umí je ještě někdo další, plus vlákna, kde už nějaké zprávy jsou.
      const shown = new Set<string>()
      for (const l of languages) {
        if (l.speakers.length === 0 && !messages.some((m) => m.thread === `lang:${l.slug}`)) continue
        shown.add(l.slug)
        list.push({ id: `lang:${l.slug}`, label: languageLabel(l.name), hint: `Hráči, kteří umí tento jazyk (${l.speakers.map((s) => s.name).join(', ') || 'nikdo další'}), a DM.`, icon: 'language', language: l.name })
      }
      for (const t of new Set(messages.filter((m) => m.thread.startsWith('lang:')).map((m) => m.thread))) {
        if (shown.has(t.slice(5))) continue
        list.push({ id: t, label: languageThreadLabel(t), hint: 'Jazyk, který už nemáš na postavě (staré zprávy zůstávají)', icon: 'language' })
      }
    }
    return list
  }, [isDm, members, dmMember, me, messages, languages])

  const selectedParam = params.get('t')
  const selected = threads.find((t) => t.id === (selectedParam ?? 'group')) ?? threads[0]
  // Na telefonu se ukazuje buď seznam vláken, nebo jedno vlákno; na počítači vedle sebe.
  const threadOpen = selectedParam !== null

  const threadMessages = useMemo(() => messages.filter((m) => m.thread === selected?.id), [messages, selected?.id])
  const unreadHere = selected ? (unread[selected.id] ?? 0) : 0

  // Otevřené vlákno s novými zprávami se označí jako přečtené.
  const markPending = markRead.isPending
  const markMutate = markRead.mutate
  useEffect(() => {
    if (selected && unreadHere > 0 && !markPending && (threadOpen || window.matchMedia('(min-width: 704px)').matches)) markMutate(selected.id)
  }, [selected, unreadHere, markPending, markMutate, threadOpen])

  if (isPending) return <FullPageSpinner />
  if (!campaign) return <Navigate to="/" replace />

  const open = (id: string) => setParams({ t: id })
  const back = () => setParams({})

  return (
    <>
      <div className="space-y-2">
        <Link to={`/campaigns/${campaignId}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeftIcon aria-hidden className="size-4" /> {campaign.name}
        </Link>
        <h1 className="text-2xl font-bold">Zprávy</h1>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 tab:grid-cols-[minmax(0,16rem)_minmax(0,1fr)] tab:items-start lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
        <nav aria-label="Vlákna zpráv" className={cn('min-w-0', threadOpen && 'hidden tab:block')}>
          <ul className="space-y-2">
            {threads.map((t) => {
              const n = unread[t.id] ?? 0
              return (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => open(t.id)}
                    aria-current={selected?.id === t.id ? 'true' : undefined}
                    className={cn(
                      'flex min-h-14 w-full items-center gap-3 rounded-xl border bg-card px-3 py-2 text-left hover:bg-muted/50',
                      selected?.id === t.id && 'tab:border-primary tab:ring-2 tab:ring-primary/30',
                    )}
                  >
                    {t.icon === 'group' ? (
                      <UsersIcon aria-hidden className="size-5 shrink-0" />
                    ) : t.icon === 'secret' ? (
                      <LockIcon aria-hidden className="size-5 shrink-0" />
                    ) : t.icon === 'language' ? (
                      <LanguagesIcon aria-hidden className="size-5 shrink-0" />
                    ) : t.icon === 'draft' ? (
                      <ClipboardListIcon aria-hidden className="size-5 shrink-0" />
                    ) : (
                      <MessageSquareIcon aria-hidden className="size-5 shrink-0" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{t.label}</span>
                      <span className="block truncate text-xs text-muted-foreground">{t.hint}</span>
                    </span>
                    {n > 0 && (
                      <span data-testid={`unread-${t.id}`} aria-label={`${n} nepřečtených`} className="flex min-w-6 items-center justify-center rounded-full bg-primary px-1.5 text-xs font-semibold text-primary-foreground">
                        {n}
                      </span>
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
          {!isDm && !threads.some((t) => t.icon === 'language') && (
            <p className="mt-3 text-xs text-muted-foreground">
              Znáš s jiným hráčem společný jazyk? Přidej ho postavě (Postava → Jazyky) a objeví se tu vlákno, které uvidí jen hráči s tím jazykem a DM.
            </p>
          )}
        </nav>

        {selected && (
          <section aria-label={`Vlákno: ${selected.label}`} className={cn('min-w-0', !threadOpen && 'hidden tab:block')}>
            <Card>
              <CardContent className="space-y-4 p-4">
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="icon" className="tab:hidden" aria-label="Zpět na vlákna" onClick={back}>
                    <ArrowLeftIcon aria-hidden />
                  </Button>
                  <div className="min-w-0">
                    <h2 className="truncate font-semibold">{selected.label}</h2>
                    <p className="truncate text-xs text-muted-foreground">{selected.hint}</p>
                  </div>
                </div>
                {selected.id === 'drafts' ? (
                  <DraftsPanel campaignId={campaignId} players={members?.filter((m) => m.role === 'player') ?? []} />
                ) : (
                  <>
                    <ThreadChat
                      key={selected.id}
                      campaignId={campaignId}
                      thread={selected}
                      messages={threadMessages}
                      me={{ id: me, name: user?.displayName ?? '' }}
                      isDm={isDm}
                      recipientsForDm={members?.filter((m) => m.role === 'player') ?? []}
                      dmId={dmMember?.userId}
                    />
                  </>
                )}
              </CardContent>
            </Card>
          </section>
        )}
      </div>
    </>
  )
}
