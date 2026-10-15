import { BookOpenIcon, HouseIcon, MapIcon, MessageSquareIcon, ShieldIcon, UserRoundIcon } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import { useAuth } from '@/features/auth/auth-context'
import { rememberedCharacter, useActiveCampaign } from '@/features/campaigns/active-campaign'
import { useJournalUnread } from '@/features/journal/api'
import { useUnreadMessages } from '@/features/messages/api'
import { useCharacters } from '@/features/sheet/api'
import { cn } from '@/lib/utils'

interface Item {
  to: string
  label: string
  icon: typeof HouseIcon
  end?: boolean
  badge?: number
  badgeId?: string
}

/**
 * Stále viditelná dolní lišta: Domů, Postava (DM má Panel DM), Deník, Mapy, Zprávy. Vždy míří do aktivní kampaně,
 * takže se kampaň nemusí pokaždé vybírat. Bez kampaně se nezobrazuje.
 */
export function BottomNav() {
  const { user } = useAuth()
  const { active } = useActiveCampaign()
  const { data: characters } = useCharacters(active?.id, { pollMs: 60_000 })
  const { data: messages } = useUnreadMessages()
  const { data: journal } = useJournalUnread()
  if (!active) return null

  const base = `/campaigns/${active.id}`
  const mine = characters?.filter((c) => c.ownerId === user?.id) ?? []
  const own = mine.find((c) => c.id === rememberedCharacter(active.id)) ?? mine[0]
  const unreadMessages = messages?.campaigns.find((c) => c.campaignId === active.id)?.unread ?? 0
  const unreadJournal = journal?.campaigns.find((c) => c.campaignId === active.id)?.unread ?? 0

  const items: Item[] = [
    { to: base, label: 'Domů', icon: HouseIcon, end: true },
    active.role === 'dm'
      ? { to: `${base}/dm`, label: 'Panel DM', icon: ShieldIcon }
      : { to: own ? `/characters/${own.id}` : `${base}/characters/new`, label: own ? 'Postava' : 'Nová postava', icon: UserRoundIcon },
    { to: `${base}/journal`, label: 'Deník', icon: BookOpenIcon, badge: unreadJournal, badgeId: 'unread-journal-badge' },
    { to: `${base}/maps`, label: 'Mapy', icon: MapIcon },
    { to: `${base}/messages`, label: 'Zprávy', icon: MessageSquareIcon, badge: unreadMessages, badgeId: 'unread-messages-badge' },
  ]

  return (
    <nav aria-label="Hlavní navigace" data-testid="bottom-nav" className="fixed inset-x-0 bottom-0 z-30 border-t bg-card/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_16px_rgb(0_0_0/0.06)] backdrop-blur">
      <ul className="mx-auto grid max-w-3xl grid-cols-5 lg:max-w-6xl">
        {items.map((item) => (
          <li key={item.label}>
            <NavLink
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  'relative flex h-16 flex-col items-center justify-center gap-0.5 px-1 text-xs font-medium transition-colors',
                  isActive ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <span className={cn('flex h-7 w-12 items-center justify-center rounded-full transition-colors', isActive && 'bg-primary/12')}>
                    <item.icon aria-hidden className="size-5" />
                  </span>
                  <span className="max-w-full truncate">{item.label}</span>
                  {item.badge ? (
                    <span
                      data-testid={item.badgeId}
                      aria-label={`${item.badge} nepřečtených`}
                      className="absolute right-[calc(50%-1.7rem)] top-1.5 flex min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[0.7rem] font-semibold leading-5 text-white"
                    >
                      {item.badge > 99 ? '99+' : item.badge}
                    </span>
                  ) : null}
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}
