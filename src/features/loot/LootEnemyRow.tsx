import { useState, type ReactNode } from 'react'
import { ChevronDownIcon, CoinsIcon, CopyIcon, PackagePlusIcon, PencilIcon, SkullIcon, SwordsIcon, Trash2Icon } from 'lucide-react'
import { RichText } from '@/components/RichText'
import { Button } from '@/components/ui/button'
import { NativeSelect } from '@/components/ui/native-select'
import { cn } from '@/lib/utils'
import type { LootEntry, LootFolder } from './api'
import { entryLabel, entryMeta, folderPath } from './labels'

type EnemyEntry = Extract<LootEntry, { kind: 'enemy' }>

/**
 * Nepřítel v přípravě (červená karta jako v Panelu DM) a pod ním loot, který z něj padá (běžné řádky lootu, dají se rozdat).
 * „Do boje“ ho pošle do Panelu DM; „+ Item“ a „+ Zlato“ přidají loot, který z něj padá.
 */
export function LootEnemyRow({
  entry,
  folders,
  drops,
  deploying,
  onDeploy,
  onEdit,
  onDuplicate,
  onMove,
  onDelete,
  onAddItem,
  onAddGold,
}: {
  entry: EnemyEntry
  folders: LootFolder[]
  /** Vykreslené řádky lootu, který z nepřítele padá. */
  drops: ReactNode[]
  deploying: boolean
  onDeploy: () => void
  onEdit: () => void
  onDuplicate: () => void
  onMove: (folderId: string | null) => void
  onDelete: () => void
  onAddItem: () => void
  onAddGold: () => void
}) {
  const [open, setOpen] = useState(false)
  const label = entryLabel(entry)
  return (
    <li className="rounded-xl border border-l-4 border-red-500/40 border-l-red-600 bg-red-500/5" data-testid={`loot-enemy-${entry.data.name}`}>
      <div className="flex items-start gap-2 p-3 pb-2">
        <SkullIcon aria-hidden className="mt-1 size-4 shrink-0 text-red-600 dark:text-red-400" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold break-words">{label}</p>
          <p className="text-xs text-muted-foreground">{entryMeta(entry)}</p>
        </div>
        <Button variant="ghost" size="icon" aria-expanded={open} aria-label={`Podrobnosti: ${label}`} onClick={() => setOpen((o) => !o)}>
          <ChevronDownIcon aria-hidden className={cn('transition-transform', open && 'rotate-180')} />
        </Button>
      </div>

      <div className="flex flex-wrap gap-2 px-3 pb-3">
        <Button variant="secondary" disabled={deploying} onClick={onDeploy} aria-label={`Do boje: ${label}`}>
          <SwordsIcon aria-hidden /> Do boje
        </Button>
        <Button variant="outline" onClick={onAddItem} aria-label={`Přidat item, který padá z: ${entry.data.name}`}>
          <PackagePlusIcon aria-hidden /> Item
        </Button>
        <Button variant="outline" onClick={onAddGold} aria-label={`Přidat zlato, které padá z: ${entry.data.name}`}>
          <CoinsIcon aria-hidden /> Zlato
        </Button>
      </div>

      {open && (
        <div className="space-y-3 border-t border-red-500/20 p-3 text-sm">
          {entry.data.notes && <RichText text={entry.data.notes} className="break-words text-muted-foreground" />}
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={onEdit}>
              <PencilIcon aria-hidden /> Upravit
            </Button>
            <Button variant="outline" onClick={onDuplicate}>
              <CopyIcon aria-hidden /> Kopírovat
            </Button>
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

      <div className="space-y-2 border-t border-red-500/20 p-2">
        <p className="px-1 text-xs font-medium text-muted-foreground">{drops.length > 0 ? 'Padá z něj:' : 'Nic z něj nepadá. Přidej item nebo zlato.'}</p>
        {drops.length > 0 && (
          <ul className="space-y-2" aria-label={`Loot z: ${entry.data.name}`}>
            {drops}
          </ul>
        )}
      </div>
    </li>
  )
}
