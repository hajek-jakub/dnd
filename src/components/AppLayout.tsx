import { Link, NavLink, Outlet } from 'react-router-dom'
import { BellIcon, LogOutIcon, MessageSquareIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ThemeToggle } from '@/components/ThemeToggle'
import { useAuth } from '@/features/auth/auth-context'
import { useNewMessageToasts, useUnreadMessages } from '@/features/messages/api'
import { useNotifications } from '@/features/notifications/api'
import { cn } from '@/lib/utils'

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    'inline-flex min-h-11 items-center border-b-2 px-3 text-sm font-medium transition-colors',
    isActive ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
  )

export function AppLayout() {
  const { user, logout } = useAuth()
  const { data: notifications } = useNotifications()
  const unread = notifications?.unread ?? 0
  const { data: messageUnread } = useUnreadMessages()
  useNewMessageToasts(messageUnread)
  const unreadMessages = messageUnread?.total ?? 0
  // Odznak vede do první kampaně s nepřečtenou zprávou, jinak na seznam kampaní.
  const messagesTarget = messageUnread?.campaigns[0] ? `/campaigns/${messageUnread.campaigns[0].campaignId}/messages` : '/'

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-3xl items-center justify-between gap-2 px-4 lg:max-w-6xl">
          <Link to="/" className="flex min-h-11 items-center gap-2 font-semibold">
            <img src={`${import.meta.env.BASE_URL}logo.svg`} alt="" className="size-7" />
            D&amp;D kampaně
          </Link>
          <div className="flex items-center gap-1">
            {user && (
              <Link
                to="/profile"
                className="inline-flex min-h-11 min-w-11 max-w-32 items-center truncate text-sm text-muted-foreground hover:text-foreground"
              >
                {user.displayName}
              </Link>
            )}
            {unreadMessages > 0 && (
              <Link
                to={messagesTarget}
                className="relative inline-flex size-11 items-center justify-center rounded-lg hover:bg-muted"
                aria-label={`Zprávy (${unreadMessages} nepřečtených)`}
                title="Nepřečtené zprávy"
              >
                <MessageSquareIcon aria-hidden className="size-5" />
                <span
                  data-testid="unread-messages-badge"
                  className="absolute right-1 top-1 flex min-w-5 items-center justify-center rounded-full bg-primary px-1 text-xs font-semibold text-primary-foreground"
                >
                  {unreadMessages > 99 ? '99+' : unreadMessages}
                </span>
              </Link>
            )}
            <Link
              to="/notifications"
              className="relative inline-flex size-11 items-center justify-center rounded-lg hover:bg-muted"
              aria-label={unread > 0 ? `Oznámení (${unread} nepřečtených)` : 'Oznámení'}
              title="Oznámení"
            >
              <BellIcon aria-hidden className="size-5" />
              {unread > 0 && (
                <span
                  data-testid="unread-badge"
                  className="absolute right-1 top-1 flex min-w-5 items-center justify-center rounded-full bg-primary px-1 text-xs font-semibold text-primary-foreground"
                >
                  {unread > 99 ? '99+' : unread}
                </span>
              )}
            </Link>
            <ThemeToggle />
            <Button variant="ghost" size="icon" aria-label="Odhlásit se" title="Odhlásit se" onClick={() => void logout()}>
              <LogOutIcon aria-hidden />
            </Button>
          </div>
        </div>
        <nav aria-label="Hlavní navigace" className="mx-auto flex w-full max-w-3xl px-1 lg:max-w-6xl">
          <NavLink to="/" end className={navLinkClass}>
            Kampaně
          </NavLink>
          <NavLink to="/rules" className={navLinkClass}>
            Pravidla
          </NavLink>
        </nav>
      </header>
      <main className="mx-auto w-full max-w-3xl space-y-6 p-4 pb-8 lg:max-w-6xl">
        <Outlet />
      </main>
      <footer className="mx-auto w-full max-w-3xl px-4 pb-10 text-sm text-muted-foreground lg:max-w-6xl">
        <Link to="/about" className="inline-flex min-h-11 items-center underline underline-offset-4 hover:text-foreground">
          O aplikaci a licence SRD 5.1
        </Link>
      </footer>
    </div>
  )
}
