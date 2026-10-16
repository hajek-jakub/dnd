import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useRefreshCharacters } from '@/features/dm/api'
import type { ItemInput } from '@/features/sheet/api'
import type { Currency } from '@/features/sheet/types'

export interface LootFolder {
  id: string
  parentId: string | null
  name: string
  position: number
}

/** Item v lootu: samostatná kopie ve tvaru vstupu vlastního itemu (i s kletbou), rozdá se stejně jako vlastní item. */
export type LootItemData = ItemInput & { name: string }
export interface LootGoldData {
  name: string
  currency: Partial<Currency>
}

interface EntryBase {
  id: string
  folderId: string | null
  position: number
  /** Komu už byla položka rozdána (jen pro DM, položka zůstává k dalšímu použití). */
  givenTo: string
}
export type LootEntry = (EntryBase & { kind: 'item'; data: LootItemData }) | (EntryBase & { kind: 'gold'; data: LootGoldData })

export interface LootTree {
  folders: LootFolder[]
  entries: LootEntry[]
}

export interface LootAssignment {
  entryId: string
  characterIds: string[]
  split?: boolean
}

const lootKey = (campaignId: string) => ['loot', campaignId] as const

export function useLoot(campaignId: string, enabled: boolean) {
  return useQuery({
    queryKey: lootKey(campaignId),
    enabled,
    queryFn: () => api.get<LootTree>(`/campaigns/${campaignId}/loot`),
  })
}

/** Id složky a všech jejích podsložek. */
export function folderWithDescendants(folders: LootFolder[], id: string): Set<string> {
  const out = new Set([id])
  let grew = true
  while (grew) {
    grew = false
    for (const f of folders) {
      if (f.parentId !== null && out.has(f.parentId) && !out.has(f.id)) {
        out.add(f.id)
        grew = true
      }
    }
  }
  return out
}

function useTreeCache(campaignId: string) {
  const queryClient = useQueryClient()
  const key = lootKey(campaignId)
  return {
    queryClient,
    key,
    /** Optimistická změna stromu; vrací původní stav pro návrat při chybě. */
    async patch(fn: (tree: LootTree) => LootTree) {
      await queryClient.cancelQueries({ queryKey: key })
      const previous = queryClient.getQueryData<LootTree>(key)
      if (previous) queryClient.setQueryData<LootTree>(key, fn(previous))
      return { previous }
    },
    restore(context: { previous?: LootTree } | undefined) {
      if (context?.previous) queryClient.setQueryData(key, context.previous)
    },
    set(fn: (tree: LootTree) => LootTree) {
      queryClient.setQueryData<LootTree>(key, (old) => (old ? fn(old) : old))
    },
  }
}

export function useCreateFolder(campaignId: string) {
  const cache = useTreeCache(campaignId)
  return useMutation({
    mutationFn: async (input: { name: string; parentId: string | null }) => (await api.post<{ folder: LootFolder }>(`/campaigns/${campaignId}/loot/folders`, input)).folder,
    onSuccess: (folder) => cache.set((t) => ({ ...t, folders: [...t.folders, folder] })),
  })
}

export function useUpdateFolder(campaignId: string) {
  const cache = useTreeCache(campaignId)
  return useMutation({
    mutationFn: async ({ id, ...patch }: { id: string; name?: string; parentId?: string | null }) =>
      (await api.patch<{ folder: LootFolder }>(`/loot/folders/${id}`, patch)).folder,
    onSuccess: (folder) => cache.set((t) => ({ ...t, folders: t.folders.map((f) => (f.id === folder.id ? folder : f)) })),
  })
}

/** Smaže složku i s podsložkami a položkami v nich (hned v UI, při chybě se vrátí). */
export function useDeleteFolder(campaignId: string) {
  const cache = useTreeCache(campaignId)
  return useMutation({
    mutationFn: (id: string) => api.delete(`/loot/folders/${id}`),
    onMutate: (id) =>
      cache.patch((t) => {
        const gone = folderWithDescendants(t.folders, id)
        return { folders: t.folders.filter((f) => !gone.has(f.id)), entries: t.entries.filter((e) => e.folderId === null || !gone.has(e.folderId)) }
      }),
    onError: (_e, _id, context) => cache.restore(context),
    onSettled: () => cache.queryClient.invalidateQueries({ queryKey: cache.key }),
  })
}

export type NewLootEntry =
  | { folderId: string | null; kind: 'item'; item: ItemInput }
  | { folderId: string | null; kind: 'gold'; name: string; currency: Partial<Currency> }

export function useCreateEntry(campaignId: string) {
  const cache = useTreeCache(campaignId)
  return useMutation({
    mutationFn: async (input: NewLootEntry) => (await api.post<{ entry: LootEntry }>(`/campaigns/${campaignId}/loot/entries`, input)).entry,
    onSuccess: (entry) => cache.set((t) => ({ ...t, entries: [...t.entries, entry] })),
  })
}

export interface LootEntryPatch {
  id: string
  folderId?: string | null
  item?: ItemInput
  name?: string
  currency?: Partial<Currency>
  /** '' smaže poznámku „rozdáno“. */
  givenTo?: ''
}

/** Úprava položky; přesun do jiné složky a smazání poznámky „rozdáno“ se ukážou hned. */
export function useUpdateEntry(campaignId: string) {
  const cache = useTreeCache(campaignId)
  return useMutation({
    mutationFn: async ({ id, ...patch }: LootEntryPatch) => (await api.patch<{ entry: LootEntry }>(`/loot/entries/${id}`, patch)).entry,
    onMutate: (patch) =>
      cache.patch((t) => ({
        ...t,
        entries: t.entries.map((e) =>
          e.id === patch.id
            ? { ...e, ...(patch.folderId !== undefined ? { folderId: patch.folderId } : {}), ...(patch.givenTo === '' ? { givenTo: '' } : {}) }
            : e,
        ),
      })),
    onError: (_e, _patch, context) => cache.restore(context),
    onSuccess: (entry) => cache.set((t) => ({ ...t, entries: t.entries.map((e) => (e.id === entry.id ? entry : e)) })),
  })
}

export function useDeleteEntry(campaignId: string) {
  const cache = useTreeCache(campaignId)
  return useMutation({
    mutationFn: (id: string) => api.delete(`/loot/entries/${id}`),
    onMutate: (id) => cache.patch((t) => ({ ...t, entries: t.entries.filter((e) => e.id !== id) })),
    onError: (_e, _id, context) => cache.restore(context),
  })
}

/** Rozdá přiřazený loot v jedné transakci; strom (s poznámkami „rozdáno“) vrátí server, postavy se přenačtou. */
export function useGiveLoot(campaignId: string) {
  const cache = useTreeCache(campaignId)
  const refresh = useRefreshCharacters(campaignId)
  return useMutation({
    mutationFn: (assignments: LootAssignment[]) =>
      api.post<LootTree & { given: { entryId: string; label: string; to: string[] }[] }>(`/campaigns/${campaignId}/loot/give`, { assignments }),
    onSuccess: (res) => {
      cache.queryClient.setQueryData<LootTree>(cache.key, { folders: res.folders, entries: res.entries })
      void refresh()
    },
  })
}
