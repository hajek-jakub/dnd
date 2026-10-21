import { Suspense, useState } from 'react'
import { BellIcon, LibraryBigIcon, UserRoundCogIcon } from 'lucide-react'
import { Link, Outlet } from 'react-router-dom'
import { BottomNav } from '@/components/BottomNav'
import { OfflineBanner } from '@/components/OfflineBanner'
import { AiButton } from '@/features/ai/AiButton'
import { DiceSlotContext } from '@/features/dice/dice-slot-context'
import { RollOverlayProvider } from '@/features/dice/RollOverlay'
import { RollSettingsProvider } from '@/features/dice/roll-settings'
import { useActiveCampaign } from '@/features/campaigns/active-campaign'
import { useNewMessageToasts, useUnreadMessages } from '@/features/messages/api'
import { useNotifications } from '@/features/notifications/api'

const iconLink = 'relative inline-flex size-11 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'

export function AppLayout() {
  const { data: notifications } = useNotifications()
  const { data: messageUnread } = useUnreadMessages()
  const { active } = useActiveCampaign()
  useNewMessageToasts(messageUnread)
  const unread = notifications?.unread ?? 0
  const [diceSlot, setDiceSlot] = useState<HTMLElement | null>(null)

  return (
    <div className="min-h-dvh">
      <OfflineBanner />
      <header className="sticky top-0 z-20 border-b bg-card/90 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-3xl items-center justify-between gap-2 px-4 tab:max-w-6xl xl:max-w-7xl">
          <div className="flex min-w-0 items-center gap-2">
            <Link to="/" aria-label="Úvodní stránka" className="flex size-11 shrink-0 items-center justify-center">
              <img src={`${import.meta.env.BASE_URL}logo.svg`} alt="" className="size-8" />
            </Link>
            <span className="truncate font-display font-semibold">{active?.name ?? 'D&D kampaně'}</span>
          </div>
          <div className="flex shrink-0 items-center">
            {/* Sem se vykreslí tlačítko kostek stránky (DiceDock), ať nic neplave nad obsahem. */}
            <div ref={setDiceSlot} className="contents" />
            <AiButton className={iconLink} />
            <Link to="/rules" className={iconLink} aria-label="Pravidla" title="Pravidla a obsah (SRD, homebrew)">
              <LibraryBigIcon aria-hidden className="size-5" />
            </Link>
            <Link to="/notifications" className={iconLink} aria-label={unread > 0 ? `Oznámení (${unread} nepřečtených)` : 'Oznámení'} title="Oznámení">
              <BellIcon aria-hidden className="size-5" />
              {unread > 0 && (
                <span data-testid="unread-badge" className="absolute right-1 top-1 flex min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-xs font-semibold text-white">
                  {unread > 99 ? '99+' : unread}
                </span>
              )}
            </Link>
            <Link to="/profile" className={iconLink} aria-label="Profil a nastavení" title="Profil a nastavení">
              <UserRoundCogIcon aria-hidden className="size-5" />
            </Link>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl space-y-6 p-4 pb-28 tab:max-w-6xl tab:p-6 tab:pb-28 xl:max-w-7xl">
        <DiceSlotContext.Provider value={diceSlot}>
          <RollSettingsProvider>
            <RollOverlayProvider>
              <Suspense fallback={<div className="py-16 text-center text-muted-foreground">Načítám…</div>}>
                <Outlet />
              </Suspense>
            </RollOverlayProvider>
          </RollSettingsProvider>
        </DiceSlotContext.Provider>
      </main>
      <BottomNav />
    </div>
  )
}
