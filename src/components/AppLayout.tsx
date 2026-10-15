import { Link, Outlet } from 'react-router-dom'
import { LogOutIcon, SwordsIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ThemeToggle } from '@/components/ThemeToggle'
import { useAuth } from '@/features/auth/auth-context'

export function AppLayout() {
  const { user, logout } = useAuth()

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-3xl items-center lg:max-w-6xl justify-between gap-2 px-4">
          <Link to="/" className="flex min-h-11 items-center gap-2 font-semibold">
            <SwordsIcon aria-hidden className="size-5" />
            D&amp;D kampaně
          </Link>
          <div className="flex items-center gap-1">
            {user && (
              <Link to="/profile" className="inline-flex min-h-11 min-w-11 max-w-32 items-center truncate text-sm text-muted-foreground hover:text-foreground">
                {user.displayName}
              </Link>
            )}
            <ThemeToggle />
            <Button
              variant="ghost"
              size="icon"
              aria-label="Odhlásit se"
              title="Odhlásit se"
              onClick={() => void logout()}
            >
              <LogOutIcon aria-hidden />
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl space-y-6 lg:max-w-6xl p-4 pb-16">
        <Outlet />
      </main>
    </div>
  )
}
