import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { JournalUnread } from '@/features/journal/api'
import type { UnreadOverview } from '@/features/messages/api'
import type { NotificationsResponse } from '@/features/notifications/api'

export interface Summary {
  notifications: NotificationsResponse
  messages: UnreadOverview
  journal: JournalUnread
  /** id posledního viditelného hodu v každé kampani uživatele */
  rolls?: Record<string, number>
}

export const SUMMARY_KEY = ['summary']

/**
 * Oznámení, nepřečtené zprávy a nové zápisy v deníku jedním dotazem (dřív to byly tři dotazy na tři trasy, pořád dokola).
 * Dotaz sdílí všechny komponenty (hlavička, dolní lišta, stránky), takže se posílá jen jednou za interval a jen když je okno vidět.
 * Podle `rolls` se stahuje i log kostek, jen když přibyl hod. Hosting (Endora) má limit souběžných procesů, proto co nejméně dotazů.
 */
export function useSummary<T>(select: (s: Summary) => T) {
  return useQuery({
    queryKey: SUMMARY_KEY,
    refetchInterval: 6000,
    refetchIntervalInBackground: false,
    queryFn: () => api.get<Summary>('/summary'),
    select,
  })
}
