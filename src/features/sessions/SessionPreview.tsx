import { Link } from 'react-router-dom'
import { CalendarDaysIcon, ChevronRightIcon } from 'lucide-react'
import { nextSession, useCalendar } from './api'
import { formatLong, relativeDays } from './dates'

/** Další session na úvodní stránce kampaně: datum, čas a odkaz do kalendáře. */
export function SessionPreview({ campaignId, isDm }: { campaignId: string; isDm: boolean }) {
  const { data } = useCalendar(campaignId)
  const next = nextSession(data)
  return (
    <section aria-label="Další session" data-testid="next-session" className="rounded-2xl border bg-card p-4 shadow-sm">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-display text-lg font-semibold">
          <CalendarDaysIcon aria-hidden className="size-5 text-primary" /> Další session
        </h2>
        <Link to={`/campaigns/${campaignId}/calendar`} className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-primary">
          Kalendář <ChevronRightIcon aria-hidden className="size-4" />
        </Link>
      </div>
      {next && data ? (
        <div>
          <p className="text-lg font-semibold first-letter:uppercase">
            {formatLong(next.date)}
            {next.time ? ` v ${next.time}` : ''}
          </p>
          <p className="text-sm text-muted-foreground">
            {relativeDays(data.today, next.date)}
            {next.note ? ` · ${next.note}` : ''}
          </p>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          {isDm ? 'Termín zatím není. Podívej se, kdy můžou hráči, a zadej ho.' : 'Termín zatím není. Označ v kalendáři, kdy můžeš hrát.'}
        </p>
      )}
    </section>
  )
}
