import { useMemo, useState, type DragEvent } from 'react'
import { ChevronRightIcon, FolderIcon, FolderOpenIcon, InboxIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { LootEntry, LootFolder } from './api'

/**
 * Strom složek lootu (dungeon → místnosti). Klepnutí složku otevře, šipka rozbalí podsložky,
 * přetažená položka se do složky přesune (na telefonu „Přesunout do…“ u položky).
 */
export function FolderTree({
  folders,
  entries,
  selected,
  dragging,
  onSelect,
  onDropEntries,
}: {
  folders: LootFolder[]
  entries: LootEntry[]
  /** Otevřená složka; null = Nezařazené. */
  selected: string | null
  dragging: boolean
  onSelect: (id: string | null) => void
  onDropEntries: (folderId: string | null) => void
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [over, setOver] = useState<string | null | undefined>(undefined)
  const byParent = useMemo(() => {
    const map = new Map<string | null, LootFolder[]>()
    for (const f of [...folders].sort((a, b) => a.position - b.position || a.name.localeCompare(b.name, 'cs'))) {
      map.set(f.parentId, [...(map.get(f.parentId) ?? []), f])
    }
    return map
  }, [folders])
  const counts = useMemo(() => {
    const map = new Map<string | null, number>()
    for (const e of entries) map.set(e.folderId, (map.get(e.folderId) ?? 0) + 1)
    return map
  }, [entries])

  const toggle = (id: string) =>
    setCollapsed((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  // Vykreslovací funkce, ne vnořené komponenty: ty by se při každém překreslení (i během přetahování) připojily znovu.
  const row = (id: string | null, name: string, hasChildren: boolean) => {
    const open = id !== null && !collapsed.has(id)
    const active = selected === id
    const Icon = id === null ? InboxIcon : active ? FolderOpenIcon : FolderIcon
    return (
      <div className="flex items-center gap-1">
        {id !== null && hasChildren ? (
          <button
            type="button"
            aria-expanded={open}
            aria-label={`${open ? 'Sbalit' : 'Rozbalit'} ${name}`}
            onClick={() => toggle(id)}
            className="flex size-11 shrink-0 items-center justify-center rounded-lg hover:bg-muted"
          >
            <ChevronRightIcon aria-hidden className={cn('size-4 transition-transform', open && 'rotate-90')} />
          </button>
        ) : (
          <span aria-hidden className="size-11 shrink-0" />
        )}
        <button
          type="button"
          aria-current={active ? 'true' : undefined}
          onClick={() => onSelect(id)}
          onDragOver={(e: DragEvent) => {
            if (!dragging) return
            e.preventDefault()
            setOver(id)
          }}
          onDragLeave={() => setOver((o) => (o === id ? undefined : o))}
          onDrop={(e: DragEvent) => {
            e.preventDefault()
            setOver(undefined)
            onDropEntries(id)
          }}
          className={cn(
            'flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-lg px-2 text-left text-sm hover:bg-muted',
            active && 'bg-primary/10 font-semibold',
            over === id && 'ring-2 ring-primary',
          )}
        >
          <Icon aria-hidden className="size-4 shrink-0" />
          <span className="min-w-0 flex-1 truncate">{name}</span>
          <span className="shrink-0 text-xs text-muted-foreground">{counts.get(id) ?? 0}</span>
        </button>
      </div>
    )
  }

  const level = (parentId: string | null) => {
    const list = byParent.get(parentId) ?? []
    if (list.length === 0) return null
    return (
      <ul className={cn('space-y-1', parentId !== null && 'ml-5 border-l pl-1')}>
        {list.map((f) => {
          const hasChildren = (byParent.get(f.id)?.length ?? 0) > 0
          return (
            <li key={f.id}>
              {row(f.id, f.name, hasChildren)}
              {hasChildren && !collapsed.has(f.id) && level(f.id)}
            </li>
          )
        })}
      </ul>
    )
  }

  return (
    <nav aria-label="Složky lootu" className="space-y-1">
      {row(null, 'Nezařazené', false)}
      {level(null)}
      {folders.length === 0 && <p className="px-2 text-sm text-muted-foreground">Zatím žádné složky. Založ třeba „Dungeon“ a v něm místnosti.</p>}
    </nav>
  )
}
