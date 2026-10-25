import { BackpackIcon, BookOpenIcon, HouseIcon, MapIcon, MessageSquareIcon, ShieldIcon, UserRoundIcon } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'
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
  /** vlastní určení aktivní položky (kdyby se položky lišily jen parametrem v adrese) */
  active?: boolean
  badge?: number
  badgeId?: string
}

/** Stejné pravidlo jako NavLink: adresa položky nebo cokoli pod ní (`end` = jen přesná shoda). */
function isRouteActive(pathname: string, to: string, end?: boolean): boolean {
  const target = to.split('?')[0] ?? to
  return pathname === target || (!end && pathname.startsWith(`${target}/`))
}

/**
 * Stále viditelná dolní lišta: Domů, Postava a Inventář (DM má místo nich Panel DM), Deník, Mapy, Zprávy. Vždy míří do aktivní kampaně,
 * takže se kampaň nemusí pokaždé vybírat. Inventář je zvlášť, protože ho někteří hráči používají nejvíc a nemají se prokliknout přes postavu. Bez kampaně se nezobrazuje.
 */
export function BottomNav() {
  const { user } = useAuth()
  const location = useLocation()
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

  // Postava a Inventář jsou tatáž stránka (`/characters/:id`), liší se záložkou v adrese.
  const sheetPath = own ? `/characters/${own.id}` : null
  const onSheet = sheetPath !== null && (location.pathname === sheetPath || location.pathname.startsWith(`${sheetPath}/`))
  const inventoryOpen = onSheet && location.pathname === sheetPath && new URLSearchParams(location.search).get('tab') === 'inventory'

  const items: Item[] = [
    { to: base, label: 'Domů', icon: HouseIcon, end: true },
    active.role === 'dm'
      ? { to: `${base}/dm`, label: 'Panel DM', icon: ShieldIcon }
      : { to: own ? `/characters/${own.id}` : `${base}/characters/new`, label: own ? 'Postava' : 'Nová postava', icon: UserRoundIcon, ...(own ? { active: onSheet && !inventoryOpen } : {}) },
    ...(active.role !== 'dm' && own ? [{ to: `/characters/${own.id}?tab=inventory`, label: 'Inventář', icon: BackpackIcon, active: inventoryOpen } satisfies Item] : []),
    { to: `${base}/journal`, label: 'Deník', icon: BookOpenIcon, badge: unreadJournal, badgeId: 'unread-journal-badge' },
    { to: `${base}/maps`, label: 'Mapy', icon: MapIcon },
    { to: `${base}/messages`, label: 'Zprávy', icon: MessageSquareIcon, badge: unreadMessages, badgeId: 'unread-messages-badge' },
  ]

  return (
    <nav aria-label="Hlavní navigace" data-testid="bottom-nav" className="fixed inset-x-0 bottom-0 z-30 border-t border-t-gold/40 bg-card/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_16px_rgb(0_0_0/0.06)] backdrop-blur">
      <ul className={cn('mx-auto grid max-w-3xl tab:max-w-6xl xl:max-w-7xl', items.length === 6 ? 'grid-cols-6' : 'grid-cols-5')}>
        {items.map((item) => {
          const isActive = item.active ?? isRouteActive(location.pathname, item.to, item.end)
          return (
            <li key={item.label}>
              <Link
                to={item.to}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'relative flex h-16 flex-col items-center justify-center gap-0.5 px-1 text-xs font-medium transition-colors',
                  isActive ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
                )}
              >
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
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
