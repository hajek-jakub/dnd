import { useState, type DragEvent } from 'react'
import { ChevronDownIcon, CoinsIcon, CopyIcon, GemIcon, GripVerticalIcon, PencilIcon, ShieldIcon, SkullIcon, SwordIcon, Trash2Icon, UndoIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { NativeSelect } from '@/components/ui/native-select'
import { RichText } from '@/components/RichText'
import { DescriptionText } from '@/features/rules/DescriptionText'
import { formatCp } from '@/features/sheet/money'
import { cn } from '@/lib/utils'
import type { LootEntry, LootFolder } from './api'
import { entryLabel, entryMeta, folderPath } from './labels'

function EntryIcon({ entry }: { entry: LootEntry }) {
  const kind = entry.kind === 'item' ? entry.data.kind : entry.kind
  const Icon = kind === 'gold' ? CoinsIcon : kind === 'weapon' ? SwordIcon : kind === 'armor' || kind === 'shield' ? ShieldIcon : GemIcon
  return <Icon aria-hidden className={cn('mt-0.5 size-4 shrink-0', kind === 'gold' ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground')} />
}

/** Položka lootu: zaškrtnutím se vybírá k rozdání, tahem jde na postavu nebo do složky, v podrobnostech úpravy. */
export function LootEntryRow({
  entry,
  folders,
  ticked,
  assignedTo,
  onTick,
  onDragStart,
  onDragEnd,
  onEdit,
  onDuplicate,
  onMove,
  onClearGiven,
  onDelete,
  dropLabel,
}: {
  entry: LootEntry
  folders: LootFolder[]
  ticked: boolean
  /** Jména postav, kterým je položka připravená k rozdání. */
  assignedTo: string[]
  onTick: (ticked: boolean) => void
  onDragStart: (e: DragEvent) => void
  onDragEnd: () => void
  onEdit: () => void
  onDuplicate: () => void
  onMove: (folderId: string | null) => void
  onClearGiven: () => void
  onDelete: () => void
  /** Jméno nepřítele, ze kterého položka padá, když řádek není přímo pod ním (nepřítel je v jiné složce). */
  dropLabel?: string
}) {
  const [open, setOpen] = useState(false)
  const label = entryLabel(entry)
  const given = entry.givenTo !== ''
  const data = entry.kind === 'item' ? entry.data : null

  return (
    <li
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={cn('rounded-xl border bg-card', given && 'opacity-70', ticked && 'border-primary ring-2 ring-primary/40')}
      data-testid={`loot-entry-${label}`}
    >
      <div className="flex items-start gap-1 p-1 pr-2">
        <label className="flex min-h-11 min-w-11 shrink-0 cursor-pointer items-center justify-center">
          <input type="checkbox" className="size-5" aria-label={`Vybrat ${label}`} checked={ticked} onChange={(e) => onTick(e.target.checked)} />
        </label>
        <GripVerticalIcon aria-hidden className="mt-3.5 hidden size-4 shrink-0 cursor-grab text-muted-foreground lg:block" />
        <div className="min-w-0 flex-1 py-2">
          <p className="flex items-start gap-2 font-medium break-words">
            <EntryIcon entry={entry} />
            <span className="min-w-0">{label}</span>
            {data?.curse && <SkullIcon aria-label="má kletbu" className="mt-0.5 size-4 shrink-0 text-red-600 dark:text-red-400" />}
          </p>
          <p className="text-xs text-muted-foreground">{entryMeta(entry)}</p>
          {entry.priceCp !== null && <p className="text-xs font-medium text-amber-700 dark:text-amber-400">Na prodej za {formatCp(entry.priceCp)} (kupující zaplatí)</p>}
          {dropLabel && <p className="text-xs font-medium text-red-700 dark:text-red-400">Padá z: {dropLabel}</p>}
          {given && <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400">Rozdáno: {entry.givenTo}</p>}
          {assignedTo.length > 0 && <p className="text-xs font-medium text-primary">Připraveno pro: {assignedTo.join(', ')}</p>}
        </div>
        <Button variant="ghost" size="icon" aria-expanded={open} aria-label={`Podrobnosti: ${label}`} onClick={() => setOpen((o) => !o)}>
          <ChevronDownIcon aria-hidden className={cn('transition-transform', open && 'rotate-180')} />
        </Button>
      </div>

      {open && (
        <div className="space-y-3 border-t p-3 text-sm">
          {data?.description && <DescriptionText text={data.description} />}
          {data?.curse && (
            <div className="space-y-1 rounded-lg border border-red-500/50 bg-red-500/5 p-3">
              <p className="flex items-center gap-1 font-semibold text-red-700 dark:text-red-400">
                <SkullIcon aria-hidden className="size-4" /> Kletba {data.curseRevealed ? '(hráč ji uvidí hned)' : '(skrytá, odhalíš ji na sheetu postavy)'}
              </p>
              <RichText text={data.curse} />
            </div>
          )}
          {data?.notes && <p className="whitespace-pre-line text-muted-foreground">{data.notes}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={onEdit}>
              <PencilIcon aria-hidden /> Upravit
            </Button>
            <Button variant="outline" onClick={onDuplicate}>
              <CopyIcon aria-hidden /> Kopírovat
            </Button>
            {given && (
              <Button variant="outline" onClick={onClearGiven}>
                <UndoIcon aria-hidden /> Zrušit „rozdáno“
              </Button>
            )}
            <Button variant="destructive" onClick={onDelete}>
              <Trash2Icon aria-hidden /> Smazat
            </Button>
          </div>
          <div className="max-w-xs">
            <NativeSelect aria-label={`Přesunout ${label} do složky`} value={entry.folderId ?? ''} onChange={(e) => onMove(e.target.value === '' ? null : e.target.value)}>
              <option value="">Přesunout do: Nezařazené</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>
                  Přesunout do: {folderPath(folders, f.id)}
                </option>
              ))}
            </NativeSelect>
          </div>
        </div>
      )}
    </li>
  )
}

