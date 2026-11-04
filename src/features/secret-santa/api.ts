import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

export interface SecretSantaDraw {
  id: string
  campaignId: string
  campaignName: string
  title: string
  /** do kdy se losování ukazuje (UTC, ISO 8601) */
  visibleUntil: string
  /** pod jakým jménem jsem v losování já */
  me: string
  /** ostatní účastníci (pro animaci) */
  names: string[]
  revealed: boolean
  /** komu dávám dárek; server ho pošle až po odkrytí */
  receiver: string | null
}

export const SECRET_SANTA_KEY = ['secret-santa']

/** Losování se mění jen skriptem, takže stačí načíst při otevření aplikace (žádné průběžné dotazování). */
export function useSecretSanta() {
  return useQuery({
    queryKey: SECRET_SANTA_KEY,
    staleTime: 10 * 60_000,
    queryFn: async () => (await api.get<{ draws: SecretSantaDraw[] }>('/secret-santa')).draws,
  })
}

export function useRevealSecretSanta() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => (await api.post<{ draw: SecretSantaDraw }>(`/secret-santa/${id}/reveal`)).draw,
    onSuccess: (draw) => queryClient.setQueryData<SecretSantaDraw[]>(SECRET_SANTA_KEY, (old) => old?.map((d) => (d.id === draw.id ? draw : d))),
  })
}

/** „neděle 13. prosince“: poslední den, kdy se losování ukazuje (`visibleUntil` je půlnoc po něm). */
export function lastDayLabel(visibleUntil: string): string {
  const last = new Date(new Date(visibleUntil).getTime() - 1)
  return new Intl.DateTimeFormat('cs-CZ', { weekday: 'long', day: 'numeric', month: 'long' }).format(last)
}
