import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CheckIcon, ChevronsUpDownIcon, LayoutGridIcon, MailIcon, PlusIcon, XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useJournalUnread } from '@/features/journal/api'
import { useUnreadMessages } from '@/features/messages/api'
import { cn } from '@/lib/utils'
import { RoleBadge } from './RoleBadge'
import { rememberCampaign, useActiveCampaign } from './active-campaign'
import { useMyInvitations } from './api'

const row = 'flex min-h-12 w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-muted'

/**
 * Název aktivní kampaně v horní liště je zároveň přepínač: kdo hraje v jedné kampani jako hráč a v jiné jako DM,
 * přepne jedním klepnutím. Na telefonu se otevře zespodu přes celou šířku, na počítači jako okno pod lištou.
 */
export function CampaignSwitcher() {
  const { campaigns, active } = useActiveCampaign()
  const { data: messages } = useUnreadMessages()
  const { data: journal } = useJournalUnread()
  const { data: invitations } = useMyInvitations()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  const unreadOf = (id: string) =>
    (messages?.campaigns.find((c) => c.campaignId === id)?.unread ?? 0) + (journal?.campaigns.find((c) => c.campaignId === id)?.unread ?? 0)
  const pending = invitations?.length ?? 0
  const elsewhere = (campaigns ?? []).some((c) => c.id !== active?.id && unreadOf(c.id) > 0) || pending > 0

  function go(path: string) {
    setOpen(false)
    void navigate(path)
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label={active ? `Přepnout kampaň (teď ${active.name})` : 'Vybrat kampaň'}
        className="relative flex min-h-11 min-w-0 items-center gap-1 rounded-lg px-2 text-left font-display font-semibold transition-colors hover:bg-muted"
      >
        <span className="truncate">{active?.name ?? 'D&D kampaně'}</span>
        <ChevronsUpDownIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        {elsewhere && <span data-testid="switcher-dot" aria-hidden className="absolute right-0.5 top-1.5 size-2 rounded-full bg-red-600" />}
      </button>
      <dialog
        ref={ref}
        aria-label="Moje kampaně"
        onClose={() => setOpen(false)}
        onClick={(e) => {
          if (e.target === ref.current) setOpen(false)
        }}
        className="mx-0 mb-0 mt-auto w-full max-w-none overflow-hidden rounded-t-2xl border bg-background p-0 text-foreground shadow-xl backdrop:bg-black/50 lg:mx-auto lg:mb-auto lg:mt-16 lg:w-[28rem] lg:rounded-2xl"
      >
        {open && (
          <div className="scroll-area max-h-[80dvh] space-y-3 p-4 pr-2">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-display text-lg font-semibold">Moje kampaně</h2>
              <Button variant="ghost" size="icon" aria-label="Zavřít" onClick={() => setOpen(false)}>
                <XIcon aria-hidden />
              </Button>
            </div>
            {pending > 0 && (
              <button type="button" className={cn(row, 'border border-primary/50')} onClick={() => go('/campaigns')}>
                <MailIcon aria-hidden className="size-5 shrink-0 text-primary" />
                <span className="flex-1">{pending === 1 ? 'Máš pozvánku do kampaně' : `Máš ${pending} pozvánky do kampaní`}</span>
              </button>
            )}
            <ul className="space-y-1">
              {campaigns?.map((c) => {
                const unread = unreadOf(c.id)
                const current = c.id === active?.id
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      aria-current={current ? 'true' : undefined}
                      className={cn(row, current && 'bg-muted')}
                      onClick={() => {
                        rememberCampaign(c.id)
                        go(`/campaigns/${c.id}`)
                      }}
                    >
                      <span className="min-w-0 flex-1 space-y-1">
                        <span className="block truncate font-medium">{c.name}</span>
                        <RoleBadge role={c.role} />
                      </span>
                      {unread > 0 && (
                        <span className="flex min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-xs font-semibold text-white" aria-label={`${unread} nových`}>
                          {unread > 99 ? '99+' : unread}
                        </span>
                      )}
                      {current && <CheckIcon aria-label="Aktivní kampaň" className="size-5 shrink-0 text-primary" />}
                    </button>
                  </li>
                )
              })}
            </ul>
            <div className="space-y-1 border-t pt-3">
              <button type="button" className={row} onClick={() => go('/campaigns')}>
                <LayoutGridIcon aria-hidden className="size-5 shrink-0 text-muted-foreground" /> Všechny kampaně
              </button>
              <button type="button" className={row} onClick={() => go('/campaigns?new=1')}>
                <PlusIcon aria-hidden className="size-5 shrink-0 text-muted-foreground" /> Nová kampaň
              </button>
            </div>
          </div>
        )}
      </dialog>
    </>
  )
}
