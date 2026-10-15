import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '@/lib/api'
import { buildRulesBundle, type RawClass, type RawLevel, type RulesBundle } from '@/engine'
import { applyOps } from './model'
import type { AdjustOp, CharacterFull, CharacterItem, CharacterListItem, CharacterSpell, CharacterState, Currency } from './types'

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

// ---------------------------------------------------------------- inventář

export type ItemInput = Partial<
  Pick<
    CharacterItem,
    | 'name'
    | 'description'
    | 'kind'
    | 'quantity'
    | 'weight'
    | 'equipped'
    | 'attuned'
    | 'requiresAttunement'
    | 'rarity'
    | 'effects'
    | 'notes'
    | 'armor'
    | 'weapon'
  >
> & { ruleId?: string }

export function useAddItem(characterId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: ItemInput) => (await api.post<{ item: CharacterItem }>(`/characters/${characterId}/items`, input)).item,
    onSuccess: (item) => {
      queryClient.setQueryData<CharacterFull>(['character', characterId], (old) => (old ? { ...old, items: [...old.items, item] } : old))
    },
  })
}

/** Equip, attunement, množství a úpravy itemu: UI se změní hned, server může attunement odmítnout (pak se vrátí zpět). */
export function useUpdateItem(characterId: string) {
  const queryClient = useQueryClient()
  const key = ['character', characterId]
  return useMutation({
    mutationKey: ['item', characterId],
    mutationFn: async ({ itemId, patch }: { itemId: string; patch: ItemInput }) =>
      (await api.patch<{ item: CharacterItem }>(`/characters/${characterId}/items/${itemId}`, patch)).item,
    onMutate: async ({ itemId, patch }) => {
      await queryClient.cancelQueries({ queryKey: key })
      const previous = queryClient.getQueryData<CharacterFull>(key)
      if (previous) {
        const target = previous.items.find((i) => i.id === itemId)
        queryClient.setQueryData<CharacterFull>(key, {
          ...previous,
          items: previous.items.map((i) => {
            if (i.id === itemId) return { ...i, ...patch } as CharacterItem
            // Nosí se jen jedna zbroj a jeden štít (stejné pravidlo jako na serveru).
            if (patch.equipped && target && (target.kind === 'armor' || target.kind === 'shield') && i.kind === target.kind)
              return { ...i, equipped: false }
            return i
          }),
        })
      }
      return { previous }
    },
    onError: (_e, _vars, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(key, ctx.previous)
    },
    onSettled: () => {
      // Server je zdroj pravdy (např. po automatickém sundání jiné zbroje), proto po dokončení poslední změny načteme znovu.
      if (queryClient.isMutating({ mutationKey: ['item', characterId] }) <= 1) void queryClient.invalidateQueries({ queryKey: key })
    },
  })
}

export function useDeleteItem(characterId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (itemId: string) => api.delete(`/characters/${characterId}/items/${itemId}`),
    onSuccess: (_r, itemId) => {
      queryClient.setQueryData<CharacterFull>(['character', characterId], (old) =>
        old ? { ...old, items: old.items.filter((i) => i.id !== itemId) } : old,
      )
    },
  })
}

export function useTransfer(characterId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { toCharacterId: string; itemId?: string; quantity?: number; currency?: Partial<Currency> }) =>
      api.post<{ items: CharacterItem[]; currency: Currency }>(`/characters/${characterId}/transfer`, input),
    onSuccess: (res) => {
      queryClient.setQueryData<CharacterFull>(['character', characterId], (old) => (old ? { ...old, items: res.items, currency: res.currency } : old))
      void queryClient.invalidateQueries({ queryKey: ['character'] })
    },
  })
}

// ---------------------------------------------------------------- kouzla

export function useAddSpell(characterId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { ruleId: string; classIdx: string; prepared?: boolean }) =>
      (await api.post<{ spells: CharacterSpell[] }>(`/characters/${characterId}/spells`, input)).spells,
    onSuccess: (spells) => queryClient.setQueryData<CharacterFull>(['character', characterId], (old) => (old ? { ...old, spells } : old)),
  })
}

export function useUpdateSpell(characterId: string) {
  const queryClient = useQueryClient()
  const key = ['character', characterId]
  return useMutation({
    mutationFn: async ({ spellId, patch }: { spellId: string; patch: { prepared?: boolean; alwaysPrepared?: boolean } }) =>
      (await api.patch<{ spells: CharacterSpell[] }>(`/characters/${characterId}/spells/${spellId}`, patch)).spells,
    onMutate: async ({ spellId, patch }) => {
      await queryClient.cancelQueries({ queryKey: key })
      const previous = queryClient.getQueryData<CharacterFull>(key)
      if (previous)
        queryClient.setQueryData<CharacterFull>(key, { ...previous, spells: previous.spells.map((s) => (s.id === spellId ? { ...s, ...patch } : s)) })
      return { previous }
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(key, ctx.previous)
    },
  })
}

export function useDeleteSpell(characterId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (spellId: string) => api.delete(`/characters/${characterId}/spells/${spellId}`),
    onSuccess: (_r, spellId) => {
      queryClient.setQueryData<CharacterFull>(['character', characterId], (old) =>
        old ? { ...old, spells: old.spells.filter((s) => s.id !== spellId) } : old,
      )
    },
  })
}
