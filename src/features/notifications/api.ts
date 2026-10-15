import { useEffect, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/lib/api'

export interface AppNotification {
  id: number
  campaignId: string
  campaignName: string
  characterId: string | null
  kind: string
  text: string
  createdAt: string
  read: boolean
}

interface NotificationsResponse {
  notifications: AppNotification[]
  unread: number
}

const POLL_MS = 5000

/**
 * Průběžně (každých pár sekund) se ptá na nová oznámení. Nová oznámení, která přijdou, zatímco je aplikace otevřená,
 * se hned ukážou jako toast; oznámení, která tu už byla při otevření, se jen započítají do nepřečtených.
 */
export function useNotifications() {
  const query = useQuery({
    queryKey: ['notifications'],
    refetchInterval: POLL_MS,
    refetchIntervalInBackground: false,
    queryFn: () => api.get<NotificationsResponse>('/notifications'),
  })
  const seen = useRef<number | null>(null)

  useEffect(() => {
    const list = query.data?.notifications
    if (!list) return
    const maxId = list.reduce((m, n) => Math.max(m, n.id), 0)
    if (seen.current === null) {
      seen.current = maxId
      return
    }
    const fresh = list.filter((n) => n.id > (seen.current ?? 0)).sort((a, b) => a.id - b.id)
    for (const n of fresh) toast(n.text, { description: n.campaignName })
    seen.current = Math.max(seen.current, maxId)
  }, [query.data])

  return query
}

export function useMarkNotificationsRead() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => api.post<{ unread: number }>('/notifications/read', {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  })
}
