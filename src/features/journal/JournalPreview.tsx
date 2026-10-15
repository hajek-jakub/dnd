import { Link } from 'react-router-dom'
import { BookOpenIcon, ChevronRightIcon, PinIcon } from 'lucide-react'
import { useJournal } from './api'

/** Nejnovější a připnuté zápisy z deníku na úvodní stránce kampaně. */
export function JournalPreview({ campaignId }: { campaignId: string }) {
  const { data } = useJournal(campaignId)
  const entries = data?.entries ?? []
  const shown = [...entries.filter((e) => e.pinned), ...entries.filter((e) => !e.pinned)].slice(0, 3)
  const unread = data?.unread ?? 0

  return (
    <section aria-label="Deník v kampani" className="rounded-2xl border bg-card p-4 shadow-sm">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-display text-lg font-semibold">
          <BookOpenIcon aria-hidden className="size-5 text-primary" /> Deník
          {unread > 0 && <span className="rounded-full bg-red-600 px-2 py-0.5 text-xs font-semibold text-white">{unread} nové</span>}
        </h2>
        <Link to={`/campaigns/${campaignId}/journal`} className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-primary">
          Otevřít <ChevronRightIcon aria-hidden className="size-4" />
        </Link>
      </div>
      {shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">Zatím tu nejsou žádné zápisy od DM.</p>
      ) : (
        <ul className="divide-y">
          {shown.map((e) => (
            <li key={e.id}>
              <Link to={`/campaigns/${campaignId}/journal`} className="flex min-h-12 items-center gap-2 py-2">
                {e.pinned && <PinIcon aria-label="Připnuto" className="size-4 shrink-0 text-primary" />}
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{e.title}</span>
                  <span className="block truncate text-xs text-muted-foreground">{e.topic}</span>
                </span>
                {e.isNew && <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground">nové</span>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
