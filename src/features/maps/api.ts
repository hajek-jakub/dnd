import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

export interface MapInfo {
  id: string
  campaignId: string
  name: string
  width: number
  height: number
  visible: boolean
  imageVersion: string
  createdAt: string
}

export interface MapPin {
  id: string
  mapId: string
  /** pixely obrázku mapy, levý horní roh = 0,0 */
  x: number
  y: number
  title: string
  description: string
  icon: string
  visibility: 'all' | 'selected' | 'dm' | 'owner'
  createdBy: string
  createdByName: string
  mine: boolean
  canEdit: boolean
  viewerIds?: string[]
  createdAt: string
}

export interface PinInput {
  x?: number
  y?: number
  title?: string
  description?: string
  icon?: string
  visibility?: MapPin['visibility']
  viewerIds?: string[]
}

const base = () => import.meta.env.BASE_URL.replace(/\/$/, '')

export const mapImageUrl = (m: Pick<MapInfo, 'id' | 'imageVersion'>) => `${base()}/api/maps/${m.id}/image?v=${m.imageVersion}`

export function useMaps(campaignId: string) {
  return useQuery({
    queryKey: ['maps', campaignId],
    refetchInterval: 60_000,
    queryFn: async () => (await api.get<{ maps: MapInfo[] }>(`/campaigns/${campaignId}/maps`)).maps,
  })
}

export function useUploadMap(campaignId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { name: string; image: Blob; filename: string }) => {
      const form = new FormData()
      form.append('name', input.name)
      form.append('image', input.image, input.filename)
      const response = await fetch(`${base()}/api/campaigns/${campaignId}/maps`, { method: 'POST', body: form, credentials: 'same-origin' })
      const payload = (await response.json().catch(() => null)) as { map?: MapInfo; error?: { message?: string } } | null
      if (!response.ok || !payload?.map) throw new Error(payload?.error?.message ?? 'Nahrání mapy se nepodařilo.')
      return payload.map
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['maps', campaignId] }),
  })
}

export function useUpdateMap(campaignId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { id: string; name?: string; visible?: boolean }) => {
      const { id, ...patch } = input
      return (await api.patch<{ map: MapInfo }>(`/maps/${id}`, patch)).map
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['maps', campaignId] }),
  })
}

export function useDeleteMap(campaignId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.delete(`/maps/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['maps', campaignId] }),
  })
}

export function useMapPins(mapId: string) {
  return useQuery({
    queryKey: ['map-pins', mapId],
    refetchInterval: 20_000,
    queryFn: async () => (await api.get<{ pins: MapPin[] }>(`/maps/${mapId}/pins`)).pins,
  })
}

export function useCreatePin(mapId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: PinInput) => (await api.post<{ pin: MapPin }>(`/maps/${mapId}/pins`, input)).pin,
    onSuccess: (pin) => queryClient.setQueryData<MapPin[]>(['map-pins', mapId], (old) => (old ? [...old, pin] : [pin])),
  })
}

export function useUpdatePin(mapId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: PinInput & { id: string }) => {
      const { id, ...patch } = input
      return (await api.patch<{ pin: MapPin }>(`/pins/${id}`, patch)).pin
    },
    onSuccess: (pin) => queryClient.setQueryData<MapPin[]>(['map-pins', mapId], (old) => old?.map((p) => (p.id === pin.id ? pin : p))),
  })
}

export function useDeletePin(mapId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.delete(`/pins/${id}`),
    onSuccess: (_r, id) => queryClient.setQueryData<MapPin[]>(['map-pins', mapId], (old) => old?.filter((p) => p.id !== id)),
  })
}
