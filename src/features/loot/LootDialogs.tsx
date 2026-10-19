import { useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Modal } from '@/components/ui/modal'
import { NativeSelect } from '@/components/ui/native-select'
import { ApiError } from '@/lib/api'
import { CoinFields } from '@/features/sheet/CoinFields'
import { ItemForm } from '@/features/sheet/ItemForm'
import { ItemSourcePicker } from '@/features/sheet/ItemSourcePicker'
import { formValuesFromInput } from '@/features/sheet/item-form-values'
import { PriceFields, type PriceMode } from '@/features/sheet/PriceFields'
import { COINS, coinsFromFields, cpOf, fieldsFromCp, formatCoins, formatCp, fromCp, type Coin } from '@/features/sheet/money'
import { EnemyEditor } from '@/features/enemies/EnemyForm'
import {
  folderWithDescendants,
  useCreateEntry,
  useCreateFolder,
  useUpdateEntry,
  useUpdateFolder,
  type LootEntry,
  type LootFolder,
} from './api'
import { entryLabel, folderPath } from './labels'

type EnemyEntry = Extract<LootEntry, { kind: 'enemy' }>

export type LootDialog =
  | { type: 'item'; entry?: Extract<LootEntry, { kind: 'item' }>; dropFrom?: string | null }
  | { type: 'gold'; entry?: Extract<LootEntry, { kind: 'gold' }>; dropFrom?: string | null }
  | { type: 'enemy'; entry?: EnemyEntry }
  | { type: 'folder'; folder?: LootFolder; parentId: string | null }
  | { type: 'moveFolder'; folder: LootFolder }

const errorText = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback)

/** Dialogy dílny lootu; `folderId` je otevřená složka, do které se nové položky přidávají. */
export function LootDialogs({
  campaignId,
  dialog,
  folderId,
  folders,
  enemies,
  onClose,
}: {
  campaignId: string
  dialog: LootDialog | null
  folderId: string | null
  folders: LootFolder[]
  /** Nepřátelé v přípravě, ze kterých může item nebo zlato padat. */
  enemies: EnemyEntry[]
  onClose: () => void
}) {
  const where = folderPath(folders, folderId)
  const dropProps = { enemies, folders }
  return (
    <>
      <Modal open={dialog?.type === 'item'} onClose={onClose} title={dialog?.type === 'item' && dialog.entry ? 'Upravit item' : `Nový item: ${where}`}>
        {dialog?.type === 'item' && (
          <ItemEntryForm campaignId={campaignId} folderId={folderId} entry={dialog.entry} initialDrop={dialog.entry?.dropFrom ?? dialog.dropFrom ?? null} {...dropProps} onClose={onClose} />
        )}
      </Modal>
      <Modal open={dialog?.type === 'gold'} onClose={onClose} title={dialog?.type === 'gold' && dialog.entry ? 'Upravit zlato' : `Zlato: ${where}`}>
        {dialog?.type === 'gold' && (
          <GoldForm campaignId={campaignId} folderId={folderId} entry={dialog.entry} initialDrop={dialog.entry?.dropFrom ?? dialog.dropFrom ?? null} {...dropProps} onClose={onClose} />
        )}
      </Modal>
      {dialog?.type === 'enemy' && <EnemyEntryForm campaignId={campaignId} folderId={folderId} where={where} entry={dialog.entry} onClose={onClose} />}
      <Modal open={dialog?.type === 'folder'} onClose={onClose} title={dialog?.type === 'folder' && dialog.folder ? 'Přejmenovat složku' : 'Nová složka'}>
        {dialog?.type === 'folder' && <FolderForm campaignId={campaignId} folder={dialog.folder} parentId={dialog.parentId} folders={folders} onClose={onClose} />}
      </Modal>
      <Modal open={dialog?.type === 'moveFolder'} onClose={onClose} title="Přesunout složku">
        {dialog?.type === 'moveFolder' && <MoveFolderForm campaignId={campaignId} folder={dialog.folder} folders={folders} onClose={onClose} />}
      </Modal>
    </>
  )
}

/** Nový item (z pravidel včetně základu magické zbroje, nebo vlastní s kletbou a tučným popisem), nebo úprava připraveného. */
function ItemEntryForm({
  campaignId,
  folderId,
  entry,
  initialDrop,
  enemies,
  folders,
  onClose,
}: {
  campaignId: string
  folderId: string | null
  entry?: Extract<LootEntry, { kind: 'item' }>
  initialDrop: string | null
  enemies: EnemyEntry[]
  folders: LootFolder[]
  onClose: () => void
}) {
  const create = useCreateEntry(campaignId)
  const update = useUpdateEntry(campaignId)
  const [mode, setMode] = useState<PriceMode>(entry?.priceCp ? 'sale' : 'found')
  const [price, setPrice] = useState(() => fieldsFromCp(entry?.priceCp ?? null))
  const [dropFrom, setDropFrom] = useState<string | null>(initialDrop)
  const priceFields = (
    <>
      <PriceFields idPrefix="loot-price" mode={mode} onMode={setMode} values={price} onValues={setPrice} />
      <DropSelect id="loot-item-drop" value={dropFrom} onChange={setDropFrom} enemies={enemies} folders={folders} />
    </>
  )

  /** Cena v mědácích (null = nalezené zdarma); bez zadané ceny vezme cenu z pravidel (za kus nebo balení, krát počet). `undefined` = chybí cena. */
  function priceCp(rulePriceGp?: number | null, quantity = 1): number | null | undefined {
    if (mode === 'found') return null
    const typed = cpOf(coinsFromFields(price))
    if (typed > 0) return typed
    return rulePriceGp ? Math.round(rulePriceGp * 100) * Math.max(1, quantity) : undefined
  }

  if (entry) {
    return (
      <div className="space-y-4">
        {priceFields}
        <ItemForm
          dm
          item={formValuesFromInput(entry.data)}
          pending={update.isPending}
          submitLabel="Uložit"
          onSubmit={(item) => {
            const cp = priceCp()
            if (cp === undefined) return void toast.error('Zadej cenu, nebo zvol Nalezené.')
            update.mutate(
              { id: entry.id, item, price: cp === null ? null : fromCp(cp), dropFrom },
              {
                onSuccess: () => {
                  toast.success('Uloženo')
                  onClose()
                },
                onError: (e) => toast.error(errorText(e, 'Item se nepodařilo uložit.')),
              },
            )
          }}
        />
      </div>
    )
  }
  return (
    <div className="space-y-4">
      {priceFields}
      <ItemSourcePicker
        campaignId={campaignId}
        dm
        pending={create.isPending}
        pickLabel="Přidat"
        submitLabel="Přidat do lootu"
        note="Item z pravidel se uloží jako kopie: můžeš ho pak upravit (popis, kletbu, bonusy, cenu) a rozdat."
        onPick={(item, label, rule) => {
          const cp = priceCp(rule?.priceGp, item.quantity)
          if (cp === undefined) return void toast.error('Zadej cenu (item nemá cenu v pravidlech), nebo zvol Nalezené.')
          create.mutate(
            { folderId, kind: 'item', item, dropFrom, ...(cp !== null ? { price: fromCp(cp) } : {}) },
            {
              onSuccess: () => {
                toast.success(`Přidáno do lootu: ${label}${cp !== null ? ` (na prodej za ${formatCp(cp)})` : ''}`)
                if (!item.ruleId) onClose()
              },
              onError: (e) => toast.error(errorText(e, 'Item se nepodařilo přidat.')),
            },
          )
        }}
      />
    </div>
  )
}

function GoldForm({
  campaignId,
  folderId,
  entry,
  initialDrop,
  enemies,
  folders,
  onClose,
}: {
  campaignId: string
  folderId: string | null
  entry?: Extract<LootEntry, { kind: 'gold' }>
  initialDrop: string | null
  enemies: EnemyEntry[]
  folders: LootFolder[]
  onClose: () => void
}) {
  const [name, setName] = useState(entry?.data.name ?? '')
  const [dropFrom, setDropFrom] = useState<string | null>(initialDrop)
  const [values, setValues] = useState<Record<Coin, string>>(
    () => Object.fromEntries(COINS.map((c) => [c, entry?.data.currency[c] ? String(entry.data.currency[c]) : ''])) as Record<Coin, string>,
  )
  const create = useCreateEntry(campaignId)
  const update = useUpdateEntry(campaignId)
  const currency = Object.fromEntries(COINS.map((c) => [c, Math.max(0, Number.parseInt(values[c], 10) || 0)])) as Record<Coin, number>
  const valid = COINS.some((c) => currency[c] > 0)
  const pending = create.isPending || update.isPending

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!valid) return
    const done = {
      onSuccess: () => {
        toast.success(entry ? 'Uloženo' : `Přidáno do lootu: ${name.trim() || formatCoins(currency)}`)
        onClose()
      },
      onError: (err: unknown) => toast.error(errorText(err, 'Zlato se nepodařilo uložit.')),
    }
    if (entry) update.mutate({ id: entry.id, name: name.trim(), currency, dropFrom }, done)
    else create.mutate({ folderId, kind: 'gold', name: name.trim(), currency, dropFrom }, done)
  }

  return (
    <form className="space-y-4" onSubmit={submit}>
      <div className="space-y-2">
        <Label htmlFor="loot-gold-name">Název (nepovinné)</Label>
        <Input id="loot-gold-name" value={name} maxLength={120} placeholder="Truhla v hrobce, měšec banditů…" onChange={(e) => setName(e.target.value)} />
      </div>
      <CoinFields idPrefix="loot-coin" values={values} onChange={(c, v) => setValues((s) => ({ ...s, [c]: v }))} />
      <DropSelect id="loot-gold-drop" value={dropFrom} onChange={setDropFrom} enemies={enemies} folders={folders} />
      <p className="text-sm text-muted-foreground" aria-live="polite">
        {valid ? `Celkem: ${formatCoins(currency)}. Při rozdání víc postavám se rozdělí rovným dílem.` : 'Zadej aspoň jednu minci.'}
      </p>
      <Button type="submit" size="lg" className="w-full" disabled={!valid || pending}>
        {entry ? 'Uložit' : 'Přidat do lootu'}
      </Button>
    </form>
  )
}

/** Volba nepřítele, ze kterého item nebo zlato padá (v Panelu DM ho DM uvidí na kartě nepřítele, až padne). */
function DropSelect({
  id,
  value,
  onChange,
  enemies,
  folders,
}: {
  id: string
  value: string | null
  onChange: (id: string | null) => void
  enemies: EnemyEntry[]
  folders: LootFolder[]
}) {
  if (enemies.length === 0) return null
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>Padá z nepřítele</Label>
      <NativeSelect id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}>
        <option value="">Z nikoho (leží ve složce)</option>
        {enemies.map((e) => (
          <option key={e.id} value={e.id}>
            {entryLabel(e)} ({folderPath(folders, e.folderId)})
          </option>
        ))}
      </NativeSelect>
    </div>
  )
}

/** Nepřítel v přípravě: šablona s počtem kusů (z nestvůry SRD nebo vlastní), „Do boje“ ji pošle do Panelu DM. */
function EnemyEntryForm({ campaignId, folderId, where, entry, onClose }: { campaignId: string; folderId: string | null; where: string; entry?: EnemyEntry; onClose: () => void }) {
  const create = useCreateEntry(campaignId)
  const update = useUpdateEntry(campaignId)
  return (
    <EnemyEditor
      title={entry ? `Upravit: ${entry.data.name}` : `Nový nepřítel: ${where}`}
      initial={entry?.data}
      withCount
      note={entry ? undefined : 'Nepřítel se zatím jen připraví. Do Panelu DM ho pošleš tlačítkem Do boje, až na něj družina narazí.'}
      onClose={onClose}
      onSubmit={async (enemy) => {
        if (entry) await update.mutateAsync({ id: entry.id, enemy })
        else await create.mutateAsync({ folderId, kind: 'enemy', enemy })
        toast.success(entry ? 'Uloženo' : `Přidáno do přípravy: ${enemy.count > 1 ? `${enemy.count}× ` : ''}${enemy.name}`)
      }}
    />
  )
}

function FolderForm({
  campaignId,
  folder,
  parentId,
  folders,
  onClose,
}: {
  campaignId: string
  folder?: LootFolder
  parentId: string | null
  folders: LootFolder[]
  onClose: () => void
}) {
  const [name, setName] = useState(folder?.name ?? '')
  const create = useCreateFolder(campaignId)
  const update = useUpdateFolder(campaignId)

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    const done = {
      onSuccess: () => onClose(),
      onError: (err: unknown) => toast.error(errorText(err, 'Složku se nepodařilo uložit.')),
    }
    if (folder) update.mutate({ id: folder.id, name: name.trim() }, done)
    else create.mutate({ name: name.trim(), parentId }, done)
  }

  return (
    <form className="space-y-4" onSubmit={submit}>
      {!folder && <p className="text-sm text-muted-foreground">Umístění: {parentId === null ? 'nejvyšší úroveň' : folderPath(folders, parentId)}</p>}
      <div className="space-y-2">
        <Label htmlFor="loot-folder-name">Název složky</Label>
        <Input id="loot-folder-name" autoFocus required maxLength={120} value={name} placeholder="Dungeon, Místnost 1…" onChange={(e) => setName(e.target.value)} />
      </div>
      <Button type="submit" size="lg" className="w-full" disabled={!name.trim() || create.isPending || update.isPending}>
        {folder ? 'Přejmenovat' : 'Založit složku'}
      </Button>
    </form>
  )
}

function MoveFolderForm({ campaignId, folder, folders, onClose }: { campaignId: string; folder: LootFolder; folders: LootFolder[]; onClose: () => void }) {
  const blocked = folderWithDescendants(folders, folder.id) // do sebe ani do své podsložky nejde
  const [parentId, setParentId] = useState(folder.parentId ?? '')
  const update = useUpdateFolder(campaignId)
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault()
        update.mutate(
          { id: folder.id, parentId: parentId === '' ? null : parentId },
          { onSuccess: () => onClose(), onError: (err) => toast.error(errorText(err, 'Složku se nepodařilo přesunout.')) },
        )
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="loot-folder-parent">Kam přesunout „{folder.name}“</Label>
        <NativeSelect id="loot-folder-parent" value={parentId} onChange={(e) => setParentId(e.target.value)}>
          <option value="">Nejvyšší úroveň</option>
          {folders
            .filter((f) => !blocked.has(f.id))
            .map((f) => (
              <option key={f.id} value={f.id}>
                {folderPath(folders, f.id)}
              </option>
            ))}
        </NativeSelect>
      </div>
      <Button type="submit" size="lg" className="w-full" disabled={update.isPending}>
        Přesunout
      </Button>
    </form>
  )
}
