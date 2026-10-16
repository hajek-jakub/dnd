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
import { COINS, formatCoins, type Coin } from '@/features/sheet/money'
import {
  folderWithDescendants,
  useCreateEntry,
  useCreateFolder,
  useUpdateEntry,
  useUpdateFolder,
  type LootEntry,
  type LootFolder,
} from './api'
import { folderPath } from './labels'

export type LootDialog =
  | { type: 'item'; entry?: Extract<LootEntry, { kind: 'item' }> }
  | { type: 'gold'; entry?: Extract<LootEntry, { kind: 'gold' }> }
  | { type: 'folder'; folder?: LootFolder; parentId: string | null }
  | { type: 'moveFolder'; folder: LootFolder }

const errorText = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback)

/** Dialogy dílny lootu; `folderId` je otevřená složka, do které se nové položky přidávají. */
export function LootDialogs({
  campaignId,
  dialog,
  folderId,
  folders,
  onClose,
}: {
  campaignId: string
  dialog: LootDialog | null
  folderId: string | null
  folders: LootFolder[]
  onClose: () => void
}) {
  const where = folderPath(folders, folderId)
  return (
    <>
      <Modal open={dialog?.type === 'item'} onClose={onClose} title={dialog?.type === 'item' && dialog.entry ? 'Upravit item' : `Nový item: ${where}`}>
        {dialog?.type === 'item' && <ItemEntryForm campaignId={campaignId} folderId={folderId} entry={dialog.entry} onClose={onClose} />}
      </Modal>
      <Modal open={dialog?.type === 'gold'} onClose={onClose} title={dialog?.type === 'gold' && dialog.entry ? 'Upravit zlato' : `Zlato: ${where}`}>
        {dialog?.type === 'gold' && <GoldForm campaignId={campaignId} folderId={folderId} entry={dialog.entry} onClose={onClose} />}
      </Modal>
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
  onClose,
}: {
  campaignId: string
  folderId: string | null
  entry?: Extract<LootEntry, { kind: 'item' }>
  onClose: () => void
}) {
  const create = useCreateEntry(campaignId)
  const update = useUpdateEntry(campaignId)

  if (entry) {
    return (
      <ItemForm
        dm
        item={formValuesFromInput(entry.data)}
        pending={update.isPending}
        submitLabel="Uložit"
        onSubmit={(item) =>
          update.mutate(
            { id: entry.id, item },
            {
              onSuccess: () => {
                toast.success('Uloženo')
                onClose()
              },
              onError: (e) => toast.error(errorText(e, 'Item se nepodařilo uložit.')),
            },
          )
        }
      />
    )
  }
  return (
    <ItemSourcePicker
      campaignId={campaignId}
      dm
      pending={create.isPending}
      pickLabel="Přidat"
      submitLabel="Přidat do lootu"
      note="Item z pravidel se uloží jako kopie: můžeš ho pak upravit (popis, kletbu, bonusy) a rozdat."
      onPick={(item, label) =>
        create.mutate(
          { folderId, kind: 'item', item },
          {
            onSuccess: () => {
              toast.success(`Přidáno do lootu: ${label}`)
              if (!item.ruleId) onClose()
            },
            onError: (e) => toast.error(errorText(e, 'Item se nepodařilo přidat.')),
          },
        )
      }
    />
  )
}

function GoldForm({ campaignId, folderId, entry, onClose }: { campaignId: string; folderId: string | null; entry?: Extract<LootEntry, { kind: 'gold' }>; onClose: () => void }) {
  const [name, setName] = useState(entry?.data.name ?? '')
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
    if (entry) update.mutate({ id: entry.id, name: name.trim(), currency }, done)
    else create.mutate({ folderId, kind: 'gold', name: name.trim(), currency }, done)
  }

  return (
    <form className="space-y-4" onSubmit={submit}>
      <div className="space-y-2">
        <Label htmlFor="loot-gold-name">Název (nepovinné)</Label>
        <Input id="loot-gold-name" value={name} maxLength={120} placeholder="Truhla v hrobce, měšec banditů…" onChange={(e) => setName(e.target.value)} />
      </div>
      <CoinFields idPrefix="loot-coin" values={values} onChange={(c, v) => setValues((s) => ({ ...s, [c]: v }))} />
      <p className="text-sm text-muted-foreground" aria-live="polite">
        {valid ? `Celkem: ${formatCoins(currency)}. Při rozdání víc postavám se rozdělí rovným dílem.` : 'Zadej aspoň jednu minci.'}
      </p>
      <Button type="submit" size="lg" className="w-full" disabled={!valid || pending}>
        {entry ? 'Uložit' : 'Přidat do lootu'}
      </Button>
    </form>
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
