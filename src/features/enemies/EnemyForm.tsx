import { useState, type FormEvent } from 'react'
import { PlusIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Modal } from '@/components/ui/modal'
import { Textarea } from '@/components/ui/textarea'
import { ApiError } from '@/lib/api'
import { useCreateEnemy, useDuplicateEnemy, useUpdateEnemy, type Enemy, type EnemyAttack } from './api'

interface AttackRow {
  name: string
  toHit: string
  damage: string
}

const toRow = (a: EnemyAttack): AttackRow => ({ name: a.name, toHit: String(a.toHit), damage: a.damage })

/** Přidání (volitelně víc kusů najednou) nebo úprava nepřítele. */
export function EnemyForm({ campaignId, enemy, onClose }: { campaignId: string; enemy?: Enemy; onClose: () => void }) {
  const create = useCreateEnemy(campaignId)
  const duplicate = useDuplicateEnemy(campaignId)
  const update = useUpdateEnemy(campaignId)
  const [name, setName] = useState(enemy?.name ?? '')
  const [hpMax, setHpMax] = useState(String(enemy?.hpMax ?? ''))
  const [ac, setAc] = useState(enemy?.ac === null || enemy?.ac === undefined ? '' : String(enemy.ac))
  const [initiative, setInitiative] = useState(String(enemy?.initiative ?? 0))
  const [count, setCount] = useState('1')
  const [notes, setNotes] = useState(enemy?.notes ?? '')
  const [attacks, setAttacks] = useState<AttackRow[]>(enemy ? enemy.attacks.map(toRow) : [])
  const [busy, setBusy] = useState(false)

  const setAttack = (i: number, patch: Partial<AttackRow>) => setAttacks((rows) => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))

  async function submit(e: FormEvent) {
    e.preventDefault()
    const max = Number.parseInt(hpMax, 10)
    if (!name.trim() || !Number.isInteger(max) || max < 1) return
    const input = {
      name: name.trim(),
      hpMax: max,
      ac: ac.trim() === '' ? null : Number.parseInt(ac, 10),
      initiative: Number.parseInt(initiative, 10) || 0,
      notes,
      attacks: attacks
        .filter((a) => a.name.trim() !== '')
        .map((a) => ({ name: a.name.trim(), toHit: Number.parseInt(a.toHit, 10) || 0, damage: a.damage.trim() })),
    }
    setBusy(true)
    try {
      if (enemy) {
        await update.mutateAsync({ id: enemy.id, ...input })
      } else {
        const first = await create.mutateAsync(input)
        const extra = Math.min(19, Math.max(1, Number.parseInt(count, 10) || 1) - 1)
        for (let i = 0; i < extra; i++) await duplicate.mutateAsync(first.id)
      }
      onClose()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Nepřítele se nepodařilo uložit.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={enemy ? `Upravit: ${enemy.name}` : 'Přidat nepřítele'}>
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="en-name">Jméno</Label>
          <Input id="en-name" required maxLength={100} autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Goblin" />
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
          {!enemy && (
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
