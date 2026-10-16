import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeftIcon, LanguagesIcon, LockIcon, MessageSquareIcon, SendIcon, UsersIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { FullPageSpinner } from '@/components/FullPageSpinner'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useAuth } from '@/features/auth/auth-context'
import { useCampaign, useCampaignMembers } from '@/features/campaigns/api'
import { ApiError } from '@/lib/api'
import { cn } from '@/lib/utils'
import { LANGUAGE_CATALOG, languageLabel } from '@/features/sheet/languages'
import { useMarkThreadRead, useMessages, useSendMessage, type ChatMessage } from './api'
import { usePageTitle } from '@/lib/page-title'

interface ThreadInfo {
  id: string
  label: string
  hint: string
  icon: 'group' | 'private' | 'secret' | 'language'
  /** název jazyka u vlákna `lang:<jazyk>` */
  language?: string
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  const time = d.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' })
  return d.toDateString() === today.toDateString() ? time : `${d.toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric' })} ${time}`
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
    } else {
      if (dmMember) list.push({ id: `dm:${me}`, label: `${dmMember.displayName} (DM)`, hint: 'Soukromě jen mezi tebou a DM', icon: 'private' })
      if (messages.some((m) => m.thread === 'secret')) list.push({ id: 'secret', label: 'Tajné zprávy', hint: 'Zprávy od DM jen pro vybrané', icon: 'secret' })
      // Jazyky, které umím a umí je ještě někdo další, plus vlákna, kde už nějaké zprávy jsou.
      const shown = new Set<string>()
      for (const l of languages) {
        if (l.speakers.length === 0 && !messages.some((m) => m.thread === `lang:${l.slug}`)) continue
        shown.add(l.slug)
        list.push({ id: `lang:${l.slug}`, label: languageLabel(l.name), hint: `Jen hráči, kteří umí tento jazyk (${l.speakers.map((s) => s.name).join(', ') || 'nikdo další'}). DM to nevidí.`, icon: 'language', language: l.name })
      }
      for (const t of new Set(messages.filter((m) => m.thread.startsWith('lang:')).map((m) => m.thread))) {
        if (shown.has(t.slice(5))) continue
        const name = languageLabel(LANGUAGE_CATALOG.find((l) => l.name.toLowerCase().replace(/[^a-z]+/g, '-') === t.slice(5))?.name ?? t.slice(5).replace(/^./u, (c) => c.toUpperCase()))
        list.push({ id: t, label: name, hint: 'Jazyk, který už nemáš na postavě (staré zprávy zůstávají)', icon: 'language' })
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
    if (selected && unreadHere > 0 && !markPending && (threadOpen || window.matchMedia('(min-width: 1024px)').matches)) markMutate(selected.id)
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

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)] lg:items-start">
        <nav aria-label="Vlákna zpráv" className={cn('min-w-0', threadOpen && 'hidden lg:block')}>
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
                      selected?.id === t.id && 'lg:border-primary lg:ring-2 lg:ring-primary/30',
                    )}
                  >
                    {t.icon === 'group' ? (
                      <UsersIcon aria-hidden className="size-5 shrink-0" />
                    ) : t.icon === 'secret' ? (
                      <LockIcon aria-hidden className="size-5 shrink-0" />
                    ) : t.icon === 'language' ? (
                      <LanguagesIcon aria-hidden className="size-5 shrink-0" />
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
              Znáš s jiným hráčem společný jazyk? Přidej ho postavě (Postava → Jazyky) a objeví se tu vlákno, které nikdo jiný (ani DM) neuvidí.
            </p>
          )}
        </nav>

        {selected && (
          <section aria-label={`Vlákno: ${selected.label}`} className={cn('min-w-0', !threadOpen && 'hidden lg:block')}>
            <Card>
              <CardContent className="space-y-4 p-4">
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Zpět na vlákna" onClick={back}>
                    <ArrowLeftIcon aria-hidden />
                  </Button>
                  <div className="min-w-0">
                    <h2 className="truncate font-semibold">{selected.label}</h2>
                    <p className="truncate text-xs text-muted-foreground">{selected.hint}</p>
                  </div>
                </div>
                <MessageList messages={threadMessages} me={me} />
                <Composer
                  campaignId={campaignId}
                  thread={selected}
                  isDm={isDm}
                  recipientsForDm={members?.filter((m) => m.role === 'player') ?? []}
                  dmId={dmMember?.userId}
                />
              </CardContent>
            </Card>
          </section>
        )}
      </div>
    </>
  )
}

function MessageList({ messages, me }: { messages: ChatMessage[]; me: string }) {
  const end = useRef<HTMLDivElement>(null)
  const count = messages.length
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' })
  }, [count])

  return (
    <div role="log" aria-label="Zprávy" aria-live="polite" className="scroll-area max-h-[50dvh] min-h-40 space-y-3 pr-2">
      {messages.length === 0 && <p className="text-sm text-muted-foreground">Zatím tu nic není. Napiš první zprávu.</p>}
      {messages.map((m) => {
        const mine = m.senderId === me
        return (
          <div key={m.id} className={cn('flex flex-col', mine ? 'items-end' : 'items-start')}>
            <p className="text-xs text-muted-foreground">
              {mine ? 'Ty' : m.senderName} · {formatTime(m.createdAt)}
              {(m.thread === 'secret' || m.thread.startsWith('lang:')) && m.recipients.length > 0 && ` · pro: ${m.recipients.map((r) => (r.id === me ? 'tebe' : r.name)).join(', ')}`}
            </p>
            <p className={cn('max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2', mine ? 'bg-primary text-primary-foreground' : 'bg-muted')}>{m.body}</p>
          </div>
        )
      })}
      <div ref={end} />
    </div>
  )
}

function Composer({
  campaignId,
  thread,
  isDm,
  recipientsForDm,
  dmId,
}: {
  campaignId: string
  thread: ThreadInfo
  isDm: boolean
  recipientsForDm: { userId: string; displayName: string }[]
  dmId: string | undefined
}) {
  const send = useSendMessage(campaignId)
  const [text, setText] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())

  // Příjemci podle vlákna: skupina všem, soukromé jednomu, tajné vybraným (jen DM).
  const secret = thread.id === 'secret'
  const to: 'all' | string[] | { language: string } | null =
    thread.id === 'group' ? 'all' : thread.language ? { language: thread.language } : secret ? (isDm && picked.size >= 2 ? [...picked] : null) : thread.id.startsWith('dm:') ? [isDm ? thread.id.slice(3) : (dmId ?? '')] : null
  const canWrite = !secret || isDm
  const valid = text.trim().length > 0 && to !== null && !(Array.isArray(to) && to[0] === '')
  const readOnly = thread.id.startsWith('lang:') && !thread.language

  function submit() {
    if (!valid || to === null || send.isPending) return
    send.mutate(
      { to, body: text.trim() },
      {
        onSuccess: () => setText(''),
        onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Zprávu se nepodařilo odeslat.'),
      },
    )
  }

  if (readOnly) return <p className="text-sm text-muted-foreground">Tenhle jazyk už tvoje postava neumí, nové zprávy v něm psát nejde.</p>
  if (!canWrite) return <p className="text-sm text-muted-foreground">Tajné zprávy posílá jen DM. Odpovědět mu můžeš soukromě ve vlákně s DM.</p>

  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      {secret && (
        <fieldset className="space-y-1">
          <legend className="text-sm font-medium">Komu (vyber aspoň dva hráče)</legend>
          <div className="flex flex-wrap gap-2">
            {recipientsForDm.map((m) => (
              <label key={m.userId} className="flex min-h-11 items-center gap-2 rounded-lg border px-3">
                <input
                  type="checkbox"
                  className="size-5"
                  checked={picked.has(m.userId)}
                  onChange={(e) =>
                    setPicked((p) => {
                      const next = new Set(p)
                      if (e.target.checked) next.add(m.userId)
                      else next.delete(m.userId)
                      return next
                    })
                  }
                />
                {m.displayName}
              </label>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">Jednomu hráči piš soukromě v jeho vlákně.</p>
        </fieldset>
      )}
      <Label htmlFor="message-body" className="sr-only">
        Zpráva
      </Label>
      <Textarea
        id="message-body"
        rows={2}
        maxLength={4000}
        className="min-h-20"
        placeholder="Napiš zprávu…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            submit()
          }
        }}
      />
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">Ctrl+Enter odešle</span>
        <Button type="submit" disabled={!valid || send.isPending}>
          <SendIcon aria-hidden /> Odeslat
        </Button>
      </div>
    </form>
  )
}
