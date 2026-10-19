import { useState, type FormEvent } from 'react'
import { BookOpenIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Modal } from '@/components/ui/modal'
import { Textarea } from '@/components/ui/textarea'
import { ApiError } from '@/lib/api'
import type { EnemyTemplate } from '@/lib/types'
import { useCreateEnemy, useDuplicateEnemy, useUpdateEnemy, type Enemy, type EnemyAttack } from './api'
import { MonsterPicker } from './MonsterPicker'

interface AttackRow {
  name: string
  toHit: string
  damage: string
}

const toRow = (a: EnemyAttack): AttackRow => ({ name: a.name, toHit: String(a.toHit), damage: a.damage })

/** Hodnoty z formuláře nepřítele; `count` je počet kusů (nový nepřítel v boji nebo šablona v přípravě). */
export type EnemyDraft = EnemyTemplate & { count: number }

/** Přidání (volitelně víc kusů najednou) nebo úprava nepřítele v boji (Panel DM). */
export function EnemyForm({ campaignId, enemy, onClose }: { campaignId: string; enemy?: Enemy; onClose: () => void }) {
  const create = useCreateEnemy(campaignId)
  const duplicate = useDuplicateEnemy(campaignId)
  const update = useUpdateEnemy(campaignId)
  return (
    <EnemyEditor
      title={enemy ? `Upravit: ${enemy.name}` : 'Přidat nepřítele'}
      initial={enemy ? { ...enemy, cr: null, xp: null } : undefined}
      withCount={!enemy}
      onClose={onClose}
      onSubmit={async ({ count, cr: _cr, xp: _xp, ...input }) => {
        if (enemy) {
          await update.mutateAsync({ id: enemy.id, ...input })
        } else {
          const first = await create.mutateAsync(input)
          for (let i = 0; i < Math.min(19, count - 1); i++) await duplicate.mutateAsync(first.id)
        }
      }}
    />
  )
}

/**
 * Formulář nepřítele: jméno, HP, AC, iniciativa, útoky s kostkami a poznámka; „Z pravidel“ je předvyplní nestvůrou ze SRD.
 * Používá ho Panel DM (nepřítel v boji) i příprava v Lootu (šablona s počtem kusů).
 */
export function EnemyEditor({
  title,
  initial,
  withCount,
  note,
  onSubmit,
  onClose,
}: {
  title: string
  initial?: Partial<EnemyDraft>
  withCount: boolean
  note?: string
  onSubmit: (draft: EnemyDraft) => Promise<void>
  onClose: () => void
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [hpMax, setHpMax] = useState(initial?.hpMax ? String(initial.hpMax) : '')
  const [ac, setAc] = useState(initial?.ac === null || initial?.ac === undefined ? '' : String(initial.ac))
  const [initiative, setInitiative] = useState(String(initial?.initiative ?? 0))
  const [count, setCount] = useState(String(initial?.count ?? 1))
  const [notes, setNotes] = useState(initial?.notes ?? '')
  const [attacks, setAttacks] = useState<AttackRow[]>((initial?.attacks ?? []).map(toRow))
  const [rating, setRating] = useState<{ cr: string | null; xp: number | null }>({ cr: initial?.cr ?? null, xp: initial?.xp ?? null })
  const [picking, setPicking] = useState(false)
  const [busy, setBusy] = useState(false)

  const setAttack = (i: number, patch: Partial<AttackRow>) => setAttacks((rows) => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))

  function applyTemplate(t: EnemyTemplate) {
    setName(t.name)
    setHpMax(String(t.hpMax))
    setAc(t.ac === null ? '' : String(t.ac))
    setInitiative(String(t.initiative))
    setAttacks(t.attacks.map(toRow))
    setNotes(t.notes)
    setRating({ cr: t.cr, xp: t.xp })
    setPicking(false)
    toast.success(`Hodnoty z pravidel: ${t.name}${t.cr ? ` (CR ${t.cr})` : ''}. Můžeš je upravit.`)
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    const max = Number.parseInt(hpMax, 10)
    if (!name.trim() || !Number.isInteger(max) || max < 1) return
    setBusy(true)
    try {
      await onSubmit({
        name: name.trim(),
        hpMax: max,
        ac: ac.trim() === '' ? null : Number.parseInt(ac, 10),
        initiative: Number.parseInt(initiative, 10) || 0,
        notes,
        attacks: attacks
          .filter((a) => a.name.trim() !== '')
          .map((a) => ({ name: a.name.trim(), toHit: Number.parseInt(a.toHit, 10) || 0, damage: a.damage.trim() })),
        count: Math.min(20, Math.max(1, Number.parseInt(count, 10) || 1)),
        ...rating,
      })
      onClose()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Nepřítele se nepodařilo uložit.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={title}>
      <form onSubmit={submit} className="space-y-4">
        {note && <p className="text-sm text-muted-foreground">{note}</p>}
        <div className="space-y-2">
          <Button type="button" variant="outline" aria-expanded={picking} onClick={() => setPicking((p) => !p)}>
            <BookOpenIcon aria-hidden /> Z pravidel (nestvůry SRD)
          </Button>
          {picking && <MonsterPicker onPick={applyTemplate} />}
          {rating.cr && !picking && <p className="text-xs text-muted-foreground">CR {rating.cr}{rating.xp !== null ? ` · ${rating.xp} XP` : ''}</p>}
        </div>
        <div className="space-y-2">
          <Label htmlFor="en-name">Jméno</Label>
          <Input id="en-name" required maxLength={100} autoFocus={!picking} value={name} onChange={(e) => setName(e.target.value)} placeholder="Goblin" />
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="space-y-2">
            <Label htmlFor="en-hp">Max HP</Label>
            <Input id="en-hp" type="number" inputMode="numeric" min={1} max={100000} required value={hpMax} onChange={(e) => setHpMax(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="en-ac">AC</Label>
            <Input id="en-ac" type="number" inputMode="numeric" min={0} max={50} value={ac} onChange={(e) => setAc(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="en-init">Iniciativa +</Label>
            <Input id="en-init" type="number" inputMode="numeric" min={-10} max={30} value={initiative} onChange={(e) => setInitiative(e.target.value)} />
          </div>
          {withCount && (
            <div className="space-y-2">
              <Label htmlFor="en-count">Kusů</Label>
              <Input id="en-count" type="number" inputMode="numeric" min={1} max={20} value={count} onChange={(e) => setCount(e.target.value)} />
            </div>
          )}
        </div>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Útoky</legend>
          {attacks.map((a, i) => (
            <div key={i} className="grid grid-cols-[minmax(0,1fr)_4.5rem_minmax(0,6.5rem)_auto] items-end gap-2">
              <div className="space-y-1">
                <Label htmlFor={`en-a-name-${i}`} className="text-xs">
                  Název
                </Label>
                <Input id={`en-a-name-${i}`} maxLength={60} value={a.name} onChange={(e) => setAttack(i, { name: e.target.value })} placeholder="Scimitar" />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`en-a-hit-${i}`} className="text-xs">
                  Útok +
                </Label>
                <Input id={`en-a-hit-${i}`} type="number" inputMode="numeric" className="px-2" value={a.toHit} onChange={(e) => setAttack(i, { toHit: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`en-a-dmg-${i}`} className="text-xs">
                  Zranění
                </Label>
                <Input id={`en-a-dmg-${i}`} maxLength={40} className="px-2" value={a.damage} onChange={(e) => setAttack(i, { damage: e.target.value })} placeholder="1d6+2" />
              </div>
              <Button type="button" variant="ghost" size="icon" aria-label={`Odebrat útok ${a.name || i + 1}`} onClick={() => setAttacks((rows) => rows.filter((_, j) => j !== i))}>
                <Trash2Icon aria-hidden />
              </Button>
            </div>
          ))}
          {attacks.length < 12 && (
            <Button type="button" variant="outline" onClick={() => setAttacks((rows) => [...rows, { name: '', toHit: '0', damage: '' }])}>
              <PlusIcon aria-hidden /> Přidat útok
            </Button>
          )}
        </fieldset>

        <div className="space-y-2">
          <Label htmlFor="en-notes">Poznámka (vidíš jen ty)</Label>
          <Textarea id="en-notes" className="min-h-20" maxLength={4000} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Zrušit
          </Button>
          <Button type="submit" disabled={busy}>
            Uložit
          </Button>
        </div>
      </form>
    </Modal>
  )
}
