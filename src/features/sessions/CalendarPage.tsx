import { useMemo, useState, type FormEvent } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { CalendarDaysIcon, CheckIcon, ChevronLeftIcon, ChevronRightIcon, DicesIcon, PencilIcon, PlusIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { FullPageSpinner } from '@/components/FullPageSpinner'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Modal } from '@/components/ui/modal'
import { useAuth } from '@/features/auth/auth-context'
import { useCampaign } from '@/features/campaigns/api'
import { ApiError } from '@/lib/api'
import { usePageTitle } from '@/lib/page-title'
import { cn } from '@/lib/utils'
import { useCalendar, useCreateSession, useDeleteSession, useSetAvailability, useUpdateSession, type Calendar, type GameSession } from './api'
import { WEEKDAYS_SHORT, formatLong, formatMonth, formatShort, monthWeeks, relativeDays, toIso, weekendsOfMonth } from './dates'

const errorText = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback)

/** Kalendář kampaně: každý označí dny, kdy může hrát, DM podle toho zadá termín další session. */
export function CalendarPage() {
  const { campaignId = '' } = useParams<{ campaignId: string }>()
  const { user } = useAuth()
  const { data: campaign, isPending } = useCampaign(campaignId)
  usePageTitle('Kalendář', campaign?.name)
  const { data: calendar, isPending: calendarPending } = useCalendar(campaignId)
  const myId = user?.id ?? ''
  const mark = useSetAvailability(campaignId, myId)
  const [view, setView] = useState<{ year: number; month: number } | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [dialog, setDialog] = useState<{ session: GameSession | null; date: string } | null>(null)

  const total = calendar?.members.length ?? 0
  const sessionsByDate = useMemo(() => new Map((calendar?.sessions ?? []).map((s) => [s.date, s])), [calendar])
  const countByDate = useMemo(() => {
    const counts = new Map<string, string[]>()
    for (const [userId, days] of Object.entries(calendar?.availability ?? {})) {
      for (const d of days) counts.set(d, [...(counts.get(d) ?? []), userId])
    }
    return counts
  }, [calendar])

  if (isPending || calendarPending) return <FullPageSpinner />
  if (!campaign || !calendar) return <Navigate to="/" replace />

  const today = calendar.today
  const [ty = 1970, tm = 1] = today.split('-').map(Number)
  const current = view ?? { year: ty, month: tm }
  const isDm = calendar.members.find((m) => m.userId === myId)?.role === 'dm'
  const mine = new Set(calendar.availability[myId] ?? [])
  const upcoming = calendar.sessions.filter((s) => s.date >= today)
  const focus = selected ?? upcoming[0]?.date ?? null
  const monthsAhead = (current.year - ty) * 12 + (current.month - tm)

  function shift(delta: number) {
    const index = current.year * 12 + (current.month - 1) + delta
    setView({ year: Math.floor(index / 12), month: (index % 12) + 1 })
  }

  function toggle(day: string) {
    mark.mutate({ days: [day], available: !mine.has(day) }, { onError: (e) => toast.error(errorText(e, 'Označení se nepodařilo uložit.')) })
  }

  function markMonth(available: boolean) {
    const days = weekendsOfMonth(current.year, current.month, today)
    if (days.length === 0) return
    mark.mutate(
      { days, available },
      { onSuccess: () => toast.success(available ? 'Víkendy označeny' : 'Označení víkendů zrušeno'), onError: (e) => toast.error(errorText(e, 'Označení se nepodařilo uložit.')) },
    )
  }

  // Nejlepší dny pro DM: nejvíc označených hlasů, bez dnů, kdy už session je.
  const best = [...countByDate.entries()]
    .filter(([d]) => d >= today && !sessionsByDate.has(d))
    .map(([d, who]) => ({ date: d, count: who.length }))
    .sort((a, b) => b.count - a.count || a.date.localeCompare(b.date))
    .slice(0, 5)

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h1 className="flex items-center gap-2 font-display text-3xl font-bold">
          <CalendarDaysIcon aria-hidden className="size-7 text-primary" /> Kalendář
        </h1>
        <p className="text-muted-foreground">
          {isDm ? 'Podívej se, kdy můžou hráči, a zadej termín další session. Hráči dostanou oznámení a den předem připomínku.' : 'Označ dny, kdy můžeš hrát. DM podle toho vybere termín další session.'}
        </p>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Card>
          <CardHeader>
            <CardTitle className="sr-only">Měsíc</CardTitle>
            <div className="flex items-center justify-between gap-2">
              <Button variant="outline" size="icon" aria-label="Předchozí měsíc" disabled={monthsAhead <= 0} onClick={() => shift(-1)}>
                <ChevronLeftIcon aria-hidden />
              </Button>
              <h2 data-testid="calendar-month" className="font-display text-xl font-semibold capitalize">
                {formatMonth(current.year, current.month)}
              </h2>
              <Button variant="outline" size="icon" aria-label="Další měsíc" disabled={monthsAhead >= 12} onClick={() => shift(1)}>
                <ChevronRightIcon aria-hidden />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-7 gap-1 text-center text-xs font-medium text-muted-foreground" aria-hidden>
              {WEEKDAYS_SHORT.map((d) => (
                <span key={d}>{d}</span>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1" data-testid="calendar-grid">
              {monthWeeks(current.year, current.month)
                .flat()
                .map((day) => (
                  <DayCell
                    key={day}
                    day={day}
                    inMonth={day.startsWith(toIso(current.year, current.month, 1).slice(0, 7))}
                    past={day < today}
                    isToday={day === today}
                    selected={focus === day}
                    mine={mine.has(day)}
                    count={countByDate.get(day)?.length ?? 0}
                    total={total}
                    session={sessionsByDate.get(day) ?? null}
                    onSelect={() => setSelected(day)}
                  />
                ))}
            </div>
            <Legend />
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" className="min-h-11" onClick={() => markMonth(true)} disabled={mark.isPending}>
                Označit všechny víkendy v měsíci
              </Button>
              <Button variant="outline" size="sm" className="min-h-11" onClick={() => markMonth(false)} disabled={mark.isPending}>
                Zrušit víkendy v měsíci
              </Button>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          {focus && (
            <DayPanel
              day={focus}
              calendar={calendar}
              mine={mine.has(focus)}
              past={focus < today}
              isDm={isDm}
              session={sessionsByDate.get(focus) ?? null}
              onToggle={() => toggle(focus)}
              onEdit={(session) => setDialog({ session, date: session?.date ?? focus })}
            />
          )}

          <Card size="sm">
            <CardHeader>
              <CardTitle>Nadcházející session</CardTitle>
            </CardHeader>
            <CardContent>
              {upcoming.length === 0 ? (
                <p className="text-sm text-muted-foreground">{isDm ? 'Zatím žádný termín. Vyber den v kalendáři a zadej ho.' : 'DM zatím nezadal termín další session.'}</p>
              ) : (
                <ul className="divide-y" data-testid="upcoming-sessions">
                  {upcoming.map((s) => (
                    <li key={s.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setSelected(s.date)
                          setView({ year: Number(s.date.slice(0, 4)), month: Number(s.date.slice(5, 7)) })
                        }}
                        className="flex min-h-12 w-full flex-col items-start justify-center py-2 text-left"
                      >
                        <span className="font-medium">
                          {formatShort(s.date)}
                          {s.time ? ` v ${s.time}` : ''} <span className="font-normal text-muted-foreground">· {relativeDays(today, s.date)}</span>
                        </span>
                        {s.note && <span className="text-sm text-muted-foreground">{s.note}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {isDm && (
            <Card size="sm">
              <CardHeader>
                <CardTitle>Nejlepší dny</CardTitle>
                <CardDescription>Dny s nejvíc označenými členy kampaně (z {total}).</CardDescription>
              </CardHeader>
              <CardContent>
                {best.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Zatím nikdo nic neoznačil.</p>
                ) : (
                  <ul className="divide-y" data-testid="best-days">
                    {best.map((b) => (
                      <li key={b.date}>
                        <button
                          type="button"
                          onClick={() => {
                            setSelected(b.date)
                            setView({ year: Number(b.date.slice(0, 4)), month: Number(b.date.slice(5, 7)) })
                          }}
                          className="flex min-h-11 w-full items-center justify-between gap-2 py-2 text-left"
                        >
                          <span>{formatShort(b.date)}</span>
                          <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', b.count === total ? 'bg-primary text-primary-foreground' : 'bg-muted')}>
                            {b.count} z {total}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <SessionDialog campaignId={campaignId} today={today} state={dialog} onClose={() => setDialog(null)} onSaved={(date) => setSelected(date)} />
    </div>
  )
}

function Legend() {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label="Legenda">
      <li className="flex items-center gap-1">
        <span aria-hidden className="inline-flex size-4 items-center justify-center rounded bg-primary text-primary-foreground">
          <CheckIcon className="size-3" />
        </span>
        můžu hrát
      </li>
      <li className="flex items-center gap-1">
        <span aria-hidden className="size-4 rounded border border-primary/40 bg-primary/30" />
        čím sytější, tím víc lidí může
      </li>
      <li className="flex items-center gap-1">
        <DicesIcon aria-hidden className="size-4 text-primary" /> session
      </li>
    </ul>
  )
}

interface DayCellProps {
  day: string
  inMonth: boolean
  past: boolean
  isToday: boolean
  selected: boolean
  mine: boolean
  count: number
  total: number
  session: GameSession | null
  onSelect: () => void
}

function DayCell({ day, inMonth, past, isToday, selected, mine, count, total, session, onSelect }: DayCellProps) {
  const heat = total > 0 && count > 0 ? 12 + Math.round((38 * count) / total) : 0
  const label = [
    formatLong(day),
    session ? `session${session.time ? ` v ${session.time}` : ''}` : '',
    past ? 'minulost' : `můžou ${count} z ${total}`,
    mine && !past ? 'ty můžeš' : '',
  ]
    .filter(Boolean)
    .join(', ')
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-label={label}
      aria-pressed={selected}
      data-day={day}
      data-count={count}
      data-mine={mine || undefined}
      style={heat > 0 && !past ? { backgroundColor: `color-mix(in oklab, var(--primary) ${heat}%, transparent)` } : undefined}
      className={cn(
        'relative flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-lg border text-sm text-foreground transition-colors',
        !inMonth && 'opacity-40',
        past && 'opacity-40',
        isToday && 'font-bold',
        session ? 'border-gold border-2' : 'border-border',
        selected && 'ring-2 ring-ring ring-offset-1 ring-offset-background',
      )}
    >
      <span className="leading-none tabular-nums">{Number(day.slice(8, 10))}</span>
      {!past && total > 0 && count > 0 && <span className="text-[0.65rem] leading-none tabular-nums">{count}/{total}</span>}
      {mine && !past && (
        <span aria-hidden className="absolute top-0.5 left-0.5 flex size-4 items-center justify-center rounded bg-primary text-primary-foreground">
          <CheckIcon className="size-3" />
        </span>
      )}
      {session && <DicesIcon aria-hidden className="absolute top-0.5 right-0.5 size-3.5 text-primary" />}
    </button>
  )
}

interface DayPanelProps {
  day: string
  calendar: Calendar
  mine: boolean
  past: boolean
  isDm: boolean
  session: GameSession | null
  onToggle: () => void
  onEdit: (session: GameSession | null) => void
}

function DayPanel({ day, calendar, mine, past, isDm, session, onToggle, onEdit }: DayPanelProps) {
  const who = new Set(Object.entries(calendar.availability).filter(([, days]) => days.includes(day)).map(([id]) => id))
  return (
    <Card size="sm" data-testid="day-panel">
      <CardHeader>
        <CardTitle className="first-letter:uppercase">{formatLong(day)}</CardTitle>
        {session && (
          <CardDescription>
            Session{session.time ? ` v ${session.time}` : ''}
            {session.note ? ` · ${session.note}` : ''}
          </CardDescription>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {past ? (
          <p className="text-sm text-muted-foreground">Tento den už je minulost.</p>
        ) : (
          <Button variant={mine ? 'default' : 'outline'} className="w-full" aria-pressed={mine} onClick={onToggle}>
            <CheckIcon aria-hidden /> {mine ? 'Můžu hrát' : 'Mohu hrát tento den'}
          </Button>
        )}
        {!past && (
          <div>
            <p className="mb-1 text-sm font-medium">
              Může hrát: <span data-testid="day-count">{who.size}</span> z {calendar.members.length}
            </p>
            <ul className="space-y-1 text-sm" data-testid="day-members">
              {calendar.members.map((m) => (
                <li key={m.userId} className={cn('flex items-center gap-2', !who.has(m.userId) && 'text-muted-foreground')}>
                  <span aria-hidden className={cn('flex size-4 items-center justify-center rounded', who.has(m.userId) ? 'bg-primary text-primary-foreground' : 'border')}>
                    {who.has(m.userId) && <CheckIcon className="size-3" />}
                  </span>
                  <span>
                    {m.name}
                    {m.role === 'dm' ? ' (DM)' : ''}
                    <span className="sr-only">{who.has(m.userId) ? ': může' : ': neoznačil'}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {isDm && !past && (
          <Button variant={session ? 'outline' : 'default'} className="w-full" onClick={() => onEdit(session)}>
            {session ? (
              <>
                <PencilIcon aria-hidden /> Upravit session
              </>
            ) : (
              <>
                <PlusIcon aria-hidden /> Zadat session na tento den
              </>
            )}
          </Button>
        )}
      </CardContent>
    </Card>
  )
}

function SessionDialog({
  campaignId,
  today,
  state,
  onClose,
  onSaved,
}: {
  campaignId: string
  today: string
  state: { session: GameSession | null; date: string } | null
  onClose: () => void
  onSaved: (date: string) => void
}) {
  return (
    <Modal open={state !== null} onClose={onClose} title={state?.session ? 'Upravit session' : 'Zadat session'}>
      {state && <SessionForm key={`${state.session?.id ?? 'new'}-${state.date}`} campaignId={campaignId} today={today} state={state} onClose={onClose} onSaved={onSaved} />}
    </Modal>
  )
}

function SessionForm({
  campaignId,
  today,
  state,
  onClose,
  onSaved,
}: {
  campaignId: string
  today: string
  state: { session: GameSession | null; date: string }
  onClose: () => void
  onSaved: (date: string) => void
}) {
  const create = useCreateSession(campaignId)
  const update = useUpdateSession(campaignId)
  const remove = useDeleteSession(campaignId)
  const [date, setDate] = useState(state.date)
  const [time, setTime] = useState(state.session?.time ?? '18:00')
  const [note, setNote] = useState(state.session?.note ?? '')
  const busy = create.isPending || update.isPending || remove.isPending
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= today

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!valid) return
    const body = { date, time: time || null, note: note.trim() }
    const done = {
      onSuccess: () => {
        toast.success(state.session ? 'Session uložena' : `Session zadána, hráči dostanou oznámení (${formatShort(date)})`)
        onSaved(date)
        onClose()
      },
      onError: (err: unknown) => toast.error(errorText(err, 'Session se nepodařilo uložit.')),
    }
    if (state.session) update.mutate({ id: state.session.id, ...body }, done)
    else create.mutate(body, done)
  }

  function cancelSession() {
    if (!state.session || !window.confirm(`Zrušit session ${formatShort(state.session.date)}? Hráči dostanou oznámení.`)) return
    remove.mutate(state.session.id, {
      onSuccess: () => {
        toast.success('Session zrušena')
        onClose()
      },
      onError: (err) => toast.error(errorText(err, 'Session se nepodařilo zrušit.')),
    })
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="session-date">Datum</Label>
        <Input id="session-date" type="date" min={today} required value={date} onChange={(e) => setDate(e.target.value)} />
        {state.session && date !== state.session.date && <p className="text-xs text-muted-foreground">Přesunutí session pošle hráčům oznámení a připomínka se pošle znovu.</p>}
      </div>
      <div className="space-y-2">
        <Label htmlFor="session-time">Čas (nepovinné)</Label>
        <Input id="session-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="session-note">Poznámka (nepovinné)</Label>
        <Input id="session-note" maxLength={200} placeholder="Třeba u koho hrajeme" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <Button type="submit" size="lg" className="w-full" disabled={!valid || busy}>
        {state.session ? 'Uložit' : 'Zadat session'}
      </Button>
      {state.session && (
        <Button type="button" variant="destructive" className="w-full" disabled={busy} onClick={cancelSession}>
          Zrušit session
        </Button>
      )}
    </form>
  )
}
