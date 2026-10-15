import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '@/lib/api'
import { buildRulesBundle, type RawClass, type RawLevel, type RulesBundle } from '@/engine'
import { applyOps } from './model'
import type { AdjustOp, CharacterFull, CharacterListItem, CharacterState } from './types'

export function characterPhotoUrl(id: string, version: string | null): string | null {
  if (!version) return null
  return `${import.meta.env.BASE_URL.replace(/\/$/, '')}/api/characters/${id}/photo?v=${version}`
}

/** Pravidla pro engine (třídy a tabulky levelů). Mění se jen novým seedem, proto se drží v paměti celou relaci. */
export function useEngineBundle() {
  return useQuery<RulesBundle>({
    queryKey: ['engine'],
    staleTime: Infinity,
    gcTime: Infinity,
    queryFn: async () => {
      const raw = await api.get<{ classes: RawClass[]; levels: RawLevel[] }>('/rules/engine')
      return buildRulesBundle(raw.classes, raw.levels)
    },
  })
}

export function useCharacters(campaignId: string | undefined) {
  return useQuery({
    queryKey: ['characters', campaignId],
    enabled: Boolean(campaignId),
    refetchInterval: 15_000,
    queryFn: async () => (await api.get<{ characters: CharacterListItem[] }>(`/campaigns/${campaignId}/characters`)).characters,
  })
}

export function useCharacter(id: string | undefined) {
  return useQuery({
    queryKey: ['character', id],
    enabled: Boolean(id),
    retry: false,
    refetchInterval: 10_000,
    queryFn: async () => (await api.get<{ character: CharacterFull }>(`/characters/${id}`)).character,
  })
}

export interface CreateCharacterInput {
  name: string
  race: string
  subrace?: string
  background: string
  alignment: string
  abilityScores: CharacterFull['abilityScores']
  baseSpeed: number
  levels: { classIndex: string; hpRoll: number | null }[]
  subclasses: Record<string, string>
  skillProficiencies: CharacterFull['skillProficiencies']
  extraProficiencies?: string[]
  /** Počáteční HP spočítané enginem (plné HP). */
  state?: Partial<CharacterState>
}

export function useCreateCharacter(campaignId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: CreateCharacterInput) =>
      (await api.post<{ character: CharacterFull }>(`/campaigns/${campaignId}/characters`, input)).character,
    onSuccess: (character) => {
      queryClient.setQueryData(['character', character.id], character)
      void queryClient.invalidateQueries({ queryKey: ['characters', campaignId] })
    },
  })
}

type Patch = Partial<
  Pick<
    CharacterFull,
    | 'name'
    | 'race'
    | 'subrace'
    | 'background'
    | 'alignment'
    | 'description'
    | 'personality'
    | 'notes'
    | 'abilityScores'
    | 'baseSpeed'
    | 'skillProficiencies'
    | 'extraSaveProficiencies'
    | 'extraProficiencies'
    | 'overrides'
    | 'customResources'
    | 'xp'
    | 'inspiration'
    | 'currency'
    | 'state'
    | 'visibility'
  >
>

/** Úprava údajů sheetu s okamžitou změnou v UI; při chybě se vrátí původní stav. */
export function useUpdateCharacter(id: string) {
  const queryClient = useQueryClient()
  const key = ['character', id]
  return useMutation({
    mutationKey: ['update', id],
    mutationFn: async (patch: Patch) => {
      try {
        return (await api.patch<{ character: CharacterFull }>(`/characters/${id}`, patch)).character
      } catch (e) {
        // 409: mezitím to někdo změnil; použije se aktuální verze ze serveru
        if (e instanceof ApiError && e.code === 'conflict') await queryClient.invalidateQueries({ queryKey: key })
        throw e
      }
    },
    onMutate: async (patch) => {
      await queryClient.cancelQueries({ queryKey: key })
      const previous = queryClient.getQueryData<CharacterFull>(key)
      if (previous) queryClient.setQueryData<CharacterFull>(key, { ...previous, ...patch } as CharacterFull)
      return { previous }
    },
    onError: (_e, _patch, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(key, ctx.previous)
    },
    onSuccess: (character) => {
      // Jen když neběží další úprava; jinak by odpověď přepsala novější optimistický stav.
      if (queryClient.isMutating({ mutationKey: ['update', id] }) <= 1 && queryClient.isMutating({ mutationKey: ['adjust', id] }) === 0) {
        queryClient.setQueryData(key, character)
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['characters'] })
    },
  })
}

/** Rychlé úpravy stavu (HP, sloty, zdroje, ...): UI se změní hned, na server jde změna o hodnotu. */
export function useAdjust(id: string) {
  const queryClient = useQueryClient()
  const key = ['character', id]
  return useMutation({
    mutationKey: ['adjust', id],
    mutationFn: (ops: AdjustOp[]) => api.post<{ state: CharacterState; xp: number; inspiration: boolean }>(`/characters/${id}/adjust`, { ops }),
    onMutate: async (ops) => {
      await queryClient.cancelQueries({ queryKey: key })
      const previous = queryClient.getQueryData<CharacterFull>(key)
      if (previous) {
        const next = applyOps(previous.state, ops, { xp: previous.xp, inspiration: previous.inspiration })
        queryClient.setQueryData<CharacterFull>(key, { ...previous, state: next.state, xp: next.xp, inspiration: next.inspiration })
      }
      return { previous }
    },
    onError: (_e, _ops, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(key, ctx.previous)
      void queryClient.invalidateQueries({ queryKey: key })
    },
    onSuccess: (res) => {
      // Při rychlém klikání platí jen odpověď poslední změny, ostatní by přepsaly novější lokální stav.
      if (queryClient.isMutating({ mutationKey: ['adjust', id] }) <= 1) {
        queryClient.setQueryData<CharacterFull>(key, (old) => (old ? { ...old, state: res.state, xp: res.xp, inspiration: res.inspiration } : old))
      }
    },
  })
}

export function useUploadPhoto(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (blob: Blob) => {
      const form = new FormData()
      form.append('photo', blob, 'foto.jpg')
      const response = await fetch(`${import.meta.env.BASE_URL.replace(/\/$/, '')}/api/characters/${id}/photo`, {
        method: 'POST',
        body: form,
        credentials: 'same-origin',
      })
      const payload = (await response.json().catch(() => null)) as { photoVersion?: string; error?: { message?: string } } | null
      if (!response.ok) throw new Error(payload?.error?.message ?? 'Nahrání fotky se nepodařilo.')
      return payload?.photoVersion ?? null
    },
    onSuccess: (version) => {
      queryClient.setQueryData<CharacterFull>(['character', id], (old) => (old ? { ...old, photoVersion: version } : old))
      void queryClient.invalidateQueries({ queryKey: ['characters'] })
    },
  })
}

export function useDeletePhoto(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => api.delete(`/characters/${id}/photo`),
    onSuccess: () => {
      queryClient.setQueryData<CharacterFull>(['character', id], (old) => (old ? { ...old, photoVersion: null } : old))
      void queryClient.invalidateQueries({ queryKey: ['characters'] })
    },
  })
}

export function useDeleteCharacter(id: string, campaignId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => api.delete(`/characters/${id}`),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: ['character', id] })
      void queryClient.invalidateQueries({ queryKey: ['characters', campaignId] })
    },
  })
}

export interface ClassFeature {
  id: string
  idx: string
  name: string
  level: number
  source: 'class' | 'subclass'
  className: string
  description: string
}

export function useClassFeatures(classIndex: string, level: number, subclassIndex?: string) {
  const params = new URLSearchParams({ class: classIndex, level: String(level) })
  if (subclassIndex) params.set('subclass', subclassIndex)
  return useQuery({
    queryKey: ['class-features', params.toString()],
    staleTime: 10 * 60_000,
    queryFn: async () => (await api.get<{ features: ClassFeature[] }>(`/rules/class-features?${params.toString()}`)).features,
  })
}
