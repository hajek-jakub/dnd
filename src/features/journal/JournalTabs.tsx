import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { BookOpenIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

/** Hlavička deníku: nadpis, akce vpravo a přepínač Zápisy / NPC (obojí je jedna stránka deníku, každá záložka má vlastní adresu). */
export function JournalHeader({ campaignId, active, npcCount, actions }: { campaignId: string; active: 'entries' | 'npcs'; npcCount?: number; actions?: ReactNode }) {
  const tabs = [
    { id: 'entries', label: 'Zápisy', to: `/campaigns/${campaignId}/journal` },
    { id: 'npcs', label: npcCount ? `NPC (${npcCount})` : 'NPC', to: `/campaigns/${campaignId}/journal/npcs` },
  ] as const
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <BookOpenIcon aria-hidden className="size-6 text-primary" /> Deník
        </h1>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
      <nav aria-label="Části deníku">
        <ul className="flex gap-2">
          {tabs.map((t) => (
            <li key={t.id}>
              <Link
                to={t.to}
                aria-current={active === t.id ? 'page' : undefined}
                className={cn(
                  'inline-flex min-h-11 items-center rounded-full border px-5 text-sm font-medium',
                  active === t.id ? 'border-primary bg-primary text-primary-foreground' : 'bg-card hover:bg-muted',
                )}
              >
                {t.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </>
  )
}
