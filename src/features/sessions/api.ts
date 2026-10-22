import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

export interface GameSession {
  id: string
  /** místní datum RRRR-MM-DD */
  date: string
  /** HH:MM nebo null */
  time: string | null
  note: string
}

export interface Calendar {
  /** dnešní místní datum podle serveru */
  today: string
  sessions: GameSession[]
  members: { userId: string; name: string; role: 'dm' | 'player' }[]
  /** dny, kdy může který člen hrát (jen dnešek a dál) */
  availability: Record<string, string[]>
}

export const calendarKey = (campaignId: string) => ['calendar', campaignId]

export function useCalendar(campaignId: string | undefined) {
  return useQuery({
    queryKey: calendarKey(campaignId ?? ''),
    enabled: !!campaignId,
    refetchInterval: 30_000,
    queryFn: () => api.get<Calendar>(`/campaigns/${campaignId}/calendar`),
  })
}

/** Nejbližší session od dneška (včetně), nebo null. */
export function nextSession(calendar: Calendar | undefined): GameSession | null {
  return calendar?.sessions.find((s) => s.date >= calendar.today) ?? null
}

/** Označení dnů, kdy můžu hrát. Cache se změní hned (kliknutí na den je okamžité), při chybě se vrátí. */
export function useSetAvailability(campaignId: string, myId: string) {
  const queryClient = useQueryClient()
  const key = calendarKey(campaignId)
  return useMutation({
    mutationFn: (input: { days: string[]; available: boolean }) => api.post<{ days: string[] }>(`/campaigns/${campaignId}/availability`, input),
    onMutate: async ({ days, available }) => {
      await queryClient.cancelQueries({ queryKey: key })
      const previous = queryClient.getQueryData<Calendar>(key)
      if (previous) {
        const set = new Set(previous.availability[myId] ?? [])
        for (const d of days) {
          if (available) set.add(d)
          else set.delete(d)
        }
        queryClient.setQueryData<Calendar>(key, { ...previous, availability: { ...previous.availability, [myId]: [...set].sort() } })
      }
      return { previous }
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(key, ctx.previous)
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  })
}

export interface SessionInput {
  date?: string
  time?: string | null
  note?: string
}

export function useCreateSession(campaignId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: SessionInput) => (await api.post<{ session: GameSession }>(`/campaigns/${campaignId}/sessions`, input)).session,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: calendarKey(campaignId) }),
  })
}

export function useUpdateSession(campaignId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...patch }: SessionInput & { id: string }) => (await api.patch<{ session: GameSession }>(`/sessions/${id}`, patch)).session,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: calendarKey(campaignId) }),
  })
}

export function useDeleteSession(campaignId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.delete(`/sessions/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: calendarKey(campaignId) }),
  })
}
