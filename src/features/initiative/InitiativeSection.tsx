import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronDownIcon, ChevronUpIcon, ChevronsRightIcon, DicesIcon, GripVerticalIcon, ListPlusIcon, SkullIcon, Trash2Icon, XIcon } from 'lucide-react'
import { toast } from 'sonner'
import { SectionHeader } from '@/components/SectionHeader'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { api, ApiError } from '@/lib/api'
import { d20 } from '@/features/dice/format'
import type { Enemy } from '@/features/enemies/api'
import { Avatar } from '@/features/sheet/Avatar'
import { cn } from '@/lib/utils'
import {
  initiativeKey,
  useClearInitiative,
  useInitiative,
  useNextTurn,
  useRemoveInitiative,
  useReorderInitiative,
  useSetInitiative,
  type InitiativeEntry,
} from './api'

export interface InitiativeCharacter {
  id: string
  name: string
  photoVersion: string | null
  npc: boolean
  /** bonus k iniciativě podle sheetu (kvůli hodu za NPC) */
  bonus: number
}

/**
 * Iniciativa v boji (vidí ji jen DM): hody hráčů se zapisují sama, NPC a nepřátele hodí jedno tlačítko, pořadí jde přetáhnout
 * (nebo posunout šipkami) a „Další tah“ hlídá, kdo je na řadě a které je kolo.
 */
export function InitiativeSection({ campaignId, characters, enemies }: { campaignId: string; characters: InitiativeCharacter[]; enemies: Enemy[] }) {
  const queryClient = useQueryClient()
  const { data } = useInitiative(campaignId, true)
  const set = useSetInitiative(campaignId)
  const reorder = useReorderInitiative(campaignId)
  const next = useNextTurn(campaignId)
  const remove = useRemoveInitiative(campaignId)
  const clear = useClearInitiative(campaignId)
  const [dragKey, setDragKey] = useState<string | null>(null)
  const [overKey, setOverKey] = useState<string | null>(null)

  const subjects = useMemo(() => {
    const m = new Map<string, { name: string; character?: InitiativeCharacter; enemy?: Enemy }>()
    for (const c of characters) m.set(`character:${c.id}`, { name: c.name, character: c })
    for (const e of enemies) m.set(`enemy:${e.id}`, { name: e.name, enemy: e })
    return m
  }, [characters, enemies])

  const entries = (data?.entries ?? []).filter((e) => subjects.has(initiativeKey(e)))
  const fail = (fallback: string) => (e: Error) => toast.error(e instanceof ApiError ? e.message : fallback)

  // Hod za NPC (podle jejich sheetu) a za všechny nepřátele, kteří ještě stojí. Hráči si hází sami na svém sheetu.
  const rollNpcAndEnemies = useMutation({
    mutationFn: async () => {
      const npcs = characters.filter((c) => c.npc)
      await Promise.all(
        npcs.map((c) => api.post(`/campaigns/${campaignId}/rolls`, { expression: d20(c.bonus), label: 'Iniciativa', characterId: c.id, hidden: true, initiative: true })),
      )
      const { results } = await api.post<{ results: unknown[] }>(`/campaigns/${campaignId}/enemies/initiative`, {})
      return npcs.length + results.length
    },
    onSuccess: (n) => {
      void queryClient.invalidateQueries({ queryKey: ['initiative', campaignId] })
      void queryClient.invalidateQueries({ queryKey: ['rolls', campaignId] })
      toast.success(n === 0 ? 'Není kdo by hodil (žádné NPC ani nepřátelé na nohou).' : `Iniciativa hozena: ${n}`)
    },
    onError: fail('Hod na iniciativu se nepodařil.'),
  })

  function addAll() {
    const present = new Set(entries.map(initiativeKey))
    const missing = [
      ...characters.map((c) => ({ kind: 'character' as const, id: c.id })),
      ...enemies.filter((e) => e.hpCurrent > 0).map((e) => ({ kind: 'enemy' as const, id: e.id })),
    ].filter((s) => !present.has(initiativeKey(s)))
    if (missing.length === 0) return toast('Všichni už v iniciativě jsou.')
    set.mutate({ subjects: missing }, { onError: fail('Přidání se nepodařilo.') })
  }

  function move(key: string, to: number) {
    const keys = entries.map(initiativeKey)
    const from = keys.indexOf(key)
    if (from < 0 || to < 0 || to >= keys.length || from === to) return
    keys.splice(to, 0, ...keys.splice(from, 1))
    reorder.mutate(keys, { onError: fail('Pořadí se nepodařilo uložit.') })
  }

  const activeKey = data?.active ? initiativeKey(data.active) : null

  return (
    <section aria-label="Iniciativa" className="space-y-3">
      <SectionHeader
        title={
          <>
            Iniciativa
            {entries.length > 0 && <span className="ml-3 align-middle text-sm font-normal text-muted-foreground" data-testid="initiative-round">Kolo {data?.round ?? 1}</span>}
          </>
        }
        actions={
          <>
            <Button variant="outline" disabled={rollNpcAndEnemies.isPending} onClick={() => rollNpcAndEnemies.mutate()}>
              <DicesIcon aria-hidden /> Hodit za NPC a nepřátele
            </Button>
            <Button variant="outline" onClick={addAll} disabled={set.isPending}>
              <ListPlusIcon aria-hidden /> Přidat všechny
            </Button>
            <Button onClick={() => next.mutate(undefined, { onError: fail('Další tah se nepodařil.') })} disabled={entries.length === 0 || next.isPending}>
              <ChevronsRightIcon aria-hidden /> Další tah
            </Button>
            <Button
              variant="ghost"
              disabled={entries.length === 0 || clear.isPending}
              onClick={() => {
                if (window.confirm('Ukončit souboj a smazat celé pořadí iniciativy?')) clear.mutate(undefined, { onError: fail('Pořadí se nepodařilo smazat.') })
              }}
            >
              <Trash2Icon aria-hidden /> Nový souboj
            </Button>
          </>
        }
      />
      <Card>
        <CardContent>
          {entries.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Zatím prázdno. Hráči si iniciativu hodí na svém sheetu a zapíše se sem sama, NPC a nepřátele hodíš tlačítkem nahoře. Pořadí pak jde přetáhnout.
            </p>
          ) : (
            <ol aria-label="Pořadí iniciativy" className="space-y-2">
              {entries.map((e, i) => (
                <InitiativeRow
                  key={initiativeKey(e)}
                  entry={e}
                  index={i}
                  last={i === entries.length - 1}
                  subject={subjects.get(initiativeKey(e))!}
                  active={activeKey === initiativeKey(e)}
                  dragging={dragKey === initiativeKey(e)}
                  over={overKey === initiativeKey(e) && dragKey !== initiativeKey(e)}
                  onDragStart={() => setDragKey(initiativeKey(e))}
                  onDragOver={() => setOverKey(initiativeKey(e))}
                  onDrop={() => {
                    if (dragKey) move(dragKey, i)
                    setDragKey(null)
                    setOverKey(null)
                  }}
                  onDragEnd={() => {
                    setDragKey(null)
                    setOverKey(null)
                  }}
                  onMove={(delta) => move(initiativeKey(e), i + delta)}
                  onValue={(value) => set.mutate({ subjects: [{ kind: e.kind, id: e.id, value }] }, { onError: fail('Hodnotu se nepodařilo uložit.') })}
                  onRemove={() => remove.mutate(e, { onError: fail('Odebrání se nepodařilo.') })}
                />
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </section>
  )
}

function InitiativeRow({
  entry,
  index,
  last,
  subject,
  active,
  dragging,
  over,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  onMove,
  onValue,
  onRemove,
}: {
  entry: InitiativeEntry
  index: number
  last: boolean
  subject: { name: string; character?: InitiativeCharacter; enemy?: Enemy }
  active: boolean
  dragging: boolean
  over: boolean
  onDragStart: () => void
  onDragOver: () => void
  onDrop: () => void
  onDragEnd: () => void
  onMove: (delta: -1 | 1) => void
  onValue: (value: number) => void
  onRemove: () => void
}) {
  const enemy = subject.enemy !== undefined
  const [draft, setDraft] = useState<string | null>(null)
  const shown = draft ?? (entry.value === null ? '' : String(entry.value))
  const commit = () => {
    const n = Number.parseInt(draft ?? '', 10)
    setDraft(null)
    if (Number.isInteger(n) && n !== entry.value && n >= -20 && n <= 60) onValue(n)
  }

  return (
    <li
      draggable
      data-testid={`initiative-${subject.name}`}
      data-active={active}
      aria-current={active ? 'step' : undefined}
      onDragStart={onDragStart}
      onDragOver={(e) => {
        e.preventDefault()
        onDragOver()
      }}
      onDrop={(e) => {
        e.preventDefault()
        onDrop()
      }}
      onDragEnd={onDragEnd}
      className={cn(
        'flex items-center gap-2 rounded-xl border bg-card px-2 py-1',
        enemy && 'border-l-4 border-l-red-600 bg-red-500/5',
        active && 'ring-2 ring-primary',
        dragging && 'opacity-50',
        over && 'border-t-4 border-t-primary',
      )}
    >
      <span className="w-6 shrink-0 text-center text-sm tabular-nums text-muted-foreground">{index + 1}.</span>
      <GripVerticalIcon aria-hidden className="size-5 shrink-0 cursor-grab text-muted-foreground" />
      {subject.character ? (
        <Avatar id={subject.character.id} name={subject.name} version={subject.character.photoVersion} className="size-9 shrink-0 text-sm" />
      ) : (
        <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-full bg-red-600 text-white">
          <SkullIcon className="size-5" />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className={cn('block truncate font-medium', enemy && 'underline decoration-red-500 decoration-2 underline-offset-4')}>{subject.name}</span>
        <span className="block text-xs text-muted-foreground">
          {enemy ? 'Nepřítel' : subject.character?.npc ? 'NPC' : 'Hráč'}
          {active && <strong className="ml-2 text-primary">Na tahu</strong>}
        </span>
      </span>
      <input
        type="number"
        inputMode="numeric"
        aria-label={`Iniciativa: ${subject.name}`}
        placeholder="–"
        value={shown}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
        }}
        className="h-11 w-16 rounded-lg border bg-background px-2 text-center text-lg font-semibold tabular-nums"
      />
      <span className="flex shrink-0">
        <Button variant="ghost" size="icon" disabled={index === 0} aria-label={`${subject.name}: posunout výš`} onClick={() => onMove(-1)}>
          <ChevronUpIcon aria-hidden />
        </Button>
        <Button variant="ghost" size="icon" disabled={last} aria-label={`${subject.name}: posunout níž`} onClick={() => onMove(1)}>
          <ChevronDownIcon aria-hidden />
        </Button>
        <Button variant="ghost" size="icon" aria-label={`Odebrat z iniciativy: ${subject.name}`} onClick={onRemove}>
          <XIcon aria-hidden />
        </Button>
      </span>
    </li>
  )
}
