import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { useMarkNotificationsRead, useNotifications } from './api'
import { usePageTitle } from '@/lib/page-title'

export function NotificationsPage() {
  usePageTitle('Oznámení')
  const { data, isPending } = useNotifications()
  const markRead = useMarkNotificationsRead()
  const unread = data?.unread ?? 0

  // Otevření stránky = přečteno (po krátké chvíli, ať je nepřečtené ještě vidět zvýrazněné).
  useEffect(() => {
    if (unread === 0) return
    const t = setTimeout(() => markRead.mutate(), 1500)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unread])

  return (
    <Card>
      <CardHeader>
        <CardTitle>Oznámení</CardTitle>
      </CardHeader>
      <CardContent>
        {isPending && <p className="text-muted-foreground">Načítám…</p>}
        {data?.notifications.length === 0 && <p className="text-muted-foreground">Zatím nic nového. Až ti DM něco dá nebo změní, ukáže se to tady.</p>}
        <ul className="divide-y">
          {data?.notifications.map((n) => (
            <li key={n.id} className={cn('flex flex-wrap items-baseline justify-between gap-2 py-3', !n.read && 'font-medium')}>
              <span>
                {!n.read && <span aria-label="Nepřečtené" className="mr-2 inline-block size-2 rounded-full bg-primary" />}
                {n.characterId ? (
                  <Link to={`/characters/${n.characterId}`} className="underline-offset-4 hover:underline">
                    {n.text}
                  </Link>
                ) : (
                  n.text
                )}
              </span>
              <span className="text-xs font-normal text-muted-foreground">
                {n.campaignName} · {new Date(n.createdAt).toLocaleString('cs-CZ', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
