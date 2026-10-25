import { useState, type FormEvent } from 'react'
import { PlusIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Modal } from '@/components/ui/modal'
import { NativeSelect } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { ApiError } from '@/lib/api'
import { useCreateTactic, useUpdateTactic } from './api'
import { parseCost } from './cost'
import type { CharacterItem } from '@/features/sheet/types'
import { ACTION_LABELS, KIND_LABELS, type ActionType, type Tactic, type TacticKind } from './types'


type Values = Record<string, string | boolean>

const ACTION_KEYS = Object.keys(ACTION_LABELS) as ActionType[]

/** Výchozí hodnoty formuláře: z existující položky, jinak prázdné. */
function initial(kind: TacticKind, tactic?: Tactic): Values {
  const d = (tactic?.data ?? {}) as unknown as Record<string, unknown>
  const s = (k: string, fallback = '') => (typeof d[k] === 'string' ? (d[k] as string) : fallback)
  const b = (k: string, fallback: boolean) => (typeof d[k] === 'boolean' ? (d[k] as boolean) : fallback)
  const title = tactic?.title ?? ''
  switch (kind) {
    case 'attack':
      return { title, actionType: s('actionType', 'action'), toHit: s('toHit'), damage: s('damage'), roll: s('roll'), range: s('range'), usage: s('usage'), note: s('note'), cost: s('cost', 'free'), hex: b('hex', true), rage: b('rage', false), sneak: b('sneak', false), count: String(typeof d.count === 'number' ? d.count : 1), ammo: s('ammo') }
    case 'spell':
      return { title, level: String(typeof d.level === 'number' ? d.level : 1), actionType: s('actionType', 'action'), range: s('range'), duration: s('duration'), concentration: b('concentration', false), save: s('save'), effect: s('effect'), roll: s('roll'), cost: s('cost', 'free'), toHit: s('toHit'), count: String(typeof d.count === 'number' ? d.count : 1) }
    case 'ki':
      return { title, actionType: s('actionType', 'bonus'), cost: s('cost', 'ki:1'), description: s('description'), toHit: s('toHit'), damage: s('damage'), roll: s('roll'), count: String(typeof d.count === 'number' ? d.count : 1), hex: b('hex', false), rage: b('rage', false), sneak: b('sneak', false) }
    case 'passive':
      return { title, type: s('type', 'passive'), description: s('description'), cost: s('cost', 'free') }
    case 'combo':
      return { title, steps: Array.isArray(d.steps) ? (d.steps as string[]).join('\n') : '', expectedDamage: s('expectedDamage'), cost: s('cost', 'free'), highlight: b('highlight', false), description: s('description') }
    case 'rule':
      return { title, text: s('text') }
  }
}

/** Hodnoty formuláře -> tělo požadavku (kroky komba po řádcích, úroveň kouzla jako číslo). */
function payload(kind: TacticKind, v: Values): Record<string, unknown> {
  const out: Record<string, unknown> = { ...v, title: String(v.title).trim() }
  if (kind === 'spell') out.level = Number(v.level)
  if (kind === 'attack' || kind === 'spell' || kind === 'ki') out.count = Math.min(10, Math.max(1, Number.parseInt(String(v.count), 10) || 1))
  if (kind === 'combo') out.steps = String(v.steps).split('\n').map((x) => x.trim()).filter(Boolean)
  return out
}

/** Přidání nebo úprava jedné položky taktik; druh se po vytvoření nemění. */
export function TacticForm({
  characterId,
  kind,
  tactic,
  all,
  items,
  onClose,
}: {
  characterId: string
  kind: TacticKind
  tactic?: Tactic
  /** všechny taktiky postavy (kombo z nich skládá, co provede) */
  all: Tactic[]
  /** inventář postavy (z něj se vybírá munice) */
  items: CharacterItem[]
  onClose: () => void
}) {
  const create = useCreateTactic(characterId)
  const update = useUpdateTactic(characterId)
  const [values, setValues] = useState<Values>(() => initial(kind, tactic))
  const [uses, setUses] = useState<{ id: string; count: string }[]>(() => (tactic?.kind === 'combo' ? (tactic.data.uses ?? []).map((u) => ({ id: u.id, count: String(u.count) })) : []))
  const usable = all.filter((t) => (t.kind === 'attack' || t.kind === 'spell' || t.kind === 'ki') && t.id !== tactic?.id)
  const set = (key: string, value: string | boolean) => setValues((v) => ({ ...v, [key]: value }))
  const pending = create.isPending || update.isPending
  const text = (key: string) => String(values[key] ?? '')

  function submit(e: FormEvent) {
    e.preventDefault()
    const body = payload(kind, values) as { title: string } & Record<string, unknown>
    if (kind === 'combo') body.uses = uses.filter((u) => u.id !== '').map((u) => ({ id: u.id, count: Math.min(10, Math.max(1, Number.parseInt(u.count, 10) || 1)) }))
    const done = { onSuccess: onClose, onError: (err: Error) => toast.error(err instanceof ApiError ? err.message : 'Položku se nepodařilo uložit.') }
    if (tactic) update.mutate({ ...body, id: tactic.id }, done)
    else create.mutate({ ...body, kind }, done)
  }

  const field = (key: string, label: string, opts: { area?: boolean; placeholder?: string; required?: boolean; max?: number } = {}) => (
    <div className="space-y-1">
      <Label htmlFor={`tactic-${key}`}>{label}</Label>
      {opts.area ? (
        <Textarea id={`tactic-${key}`} className="min-h-24" value={text(key)} onChange={(e) => set(key, e.target.value)} placeholder={opts.placeholder} maxLength={opts.max} />
      ) : (
        <Input id={`tactic-${key}`} value={text(key)} onChange={(e) => set(key, e.target.value)} placeholder={opts.placeholder} required={opts.required} maxLength={opts.max} />
      )}
    </div>
  )
  const action = () => (
    <div className="space-y-1">
      <Label htmlFor="tactic-actionType">Typ akce</Label>
      <NativeSelect id="tactic-actionType" value={text('actionType')} onChange={(e) => set('actionType', e.target.value)}>
        {ACTION_KEYS.map((a) => (
          <option key={a} value={a}>
            {ACTION_LABELS[a]}
          </option>
        ))}
      </NativeSelect>
    </div>
  )
  const check = (key: string, label: string) => (
    <label className="flex min-h-11 items-center gap-3 text-sm">
      <input type="checkbox" className="size-5" checked={Boolean(values[key])} onChange={(e) => set(key, e.target.checked)} />
      {label}
    </label>
  )

  return (
    <Modal open onClose={onClose} title={tactic ? `Upravit: ${tactic.title}` : `Přidat: ${KIND_LABELS[kind].toLowerCase()}`}>
      <form onSubmit={submit} className="space-y-3">
        <div className="space-y-1">
          <Label htmlFor="tactic-title">Název</Label>
          <Input id="tactic-title" value={text('title')} onChange={(e) => set('title', e.target.value)} required maxLength={120} autoFocus />
        </div>

        {kind === 'attack' && (
          <>
            {action()}
            <div className="grid grid-cols-2 gap-3">
              {field('toHit', 'Útok', { placeholder: 'd20+8' })}
              {field('range', 'Dostřel', { placeholder: '5 ft' })}
            </div>
            {field('damage', 'Zranění (text)', { placeholder: '1d8+5 + 1d4 fire' })}
            <div className="grid grid-cols-2 gap-3">
              {field('count', 'Útoků na použití', { placeholder: '2 (Extra Attack)' })}
              <div className="space-y-1">
                <Label htmlFor="tactic-ammo">Munice (ubývá s každým útokem)</Label>
                <NativeSelect id="tactic-ammo" value={text('ammo')} onChange={(e) => set('ammo', e.target.value)}>
                  <option value="">Žádná</option>
                  {items.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name} ({i.quantity} ks)
                    </option>
                  ))}
                </NativeSelect>
              </div>
            </div>
            {field('roll', 'Výraz pro hod zranění (prázdné = odvodí se ze zranění)', { placeholder: '1d8+5+1d4' })}
            {field('usage', 'Kdy použít', { area: true })}
            {field('note', 'Poznámka', { area: true })}
            {check('hex', "Přidat Hex nebo Hunter's Mark (+1d6), když se na něj soustředíš")}
            {check('rage', 'Přičíst bonus z Rage, když Rage trvá (do zranění ho pak nepiš)')}
            {check('sneak', 'Přidat kostky Sneak Attack, když je zapnutý přepínač')}
          </>
        )}

        {kind === 'spell' && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="tactic-level">Úroveň</Label>
                <NativeSelect id="tactic-level" value={text('level')} onChange={(e) => set('level', e.target.value)}>
                  {Array.from({ length: 10 }, (_, i) => (
                    <option key={i} value={i}>
                      {i === 0 ? 'Cantrip' : `${i}. úroveň`}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              {action()}
            </div>
            <div className="grid grid-cols-2 gap-3">
              {field('range', 'Dosah', { placeholder: '90 ft' })}
              {field('duration', 'Trvání', { placeholder: '1 hodina' })}
            </div>
            {field('save', 'Saving throw', { placeholder: 'WIS DC 14' })}
            <div className="grid grid-cols-2 gap-3">
              {field('toHit', 'Kouzelný útok', { placeholder: 'd20+6' })}
              {field('count', 'Útoků na použití', { placeholder: '2 paprsky' })}
            </div>
            {field('roll', 'Výraz pro hod zranění', { placeholder: '1d10' })}
            {field('effect', 'Efekt', { area: true })}
            {check('concentration', 'Soustředění')}
          </>
        )}

        {kind === 'ki' && (
          <>
            {action()}
            <div className="grid grid-cols-2 gap-3">
              {field('toHit', 'Útok (volitelné)', { placeholder: 'd20+7' })}
              {field('count', 'Úderů na použití', { placeholder: '2 (Flurry)' })}
            </div>
            {field('damage', 'Zranění (text, volitelné)', { placeholder: '1d6+4' })}
            {field('roll', 'Výraz pro hod zranění', { placeholder: '1d6+4' })}
            {check('hex', "Přidat Hex nebo Hunter's Mark (+1d6), když se na něj soustředíš")}
            {check('rage', 'Přičíst bonus z Rage, když Rage trvá (do zranění ho pak nepiš)')}
            {check('sneak', 'Přidat kostky Sneak Attack, když je zapnutý přepínač')}
            {field('description', 'Popis', { area: true })}
          </>
        )}

        {kind === 'passive' && (
          <>
            <div className="space-y-1">
              <Label htmlFor="tactic-type">Typ</Label>
              <NativeSelect id="tactic-type" value={text('type')} onChange={(e) => set('type', e.target.value)}>
                <option value="passive">Pasivka</option>
                <option value="reaction">Reakce</option>
              </NativeSelect>
            </div>
            {field('description', 'Popis', { area: true })}
          </>
        )}

        {kind === 'combo' && (
          <>
            {field('steps', 'Kroky (každý na nový řádek)', { area: true })}
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Co kombo provede (hody a cena)</legend>
              {uses.map((u, i) => (
                <div key={i} className="grid grid-cols-[minmax(0,1fr)_4.5rem_auto] items-end gap-2">
                  <NativeSelect aria-label={`Položka komba ${i + 1}`} value={u.id} onChange={(e) => setUses((l) => l.map((x, j) => (j === i ? { ...x, id: e.target.value } : x)))}>
                    <option value="">Vyber útok, kouzlo nebo schopnost…</option>
                    {usable.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.title}
                      </option>
                    ))}
                  </NativeSelect>
                  <Input aria-label={`Počet: položka ${i + 1}`} type="number" inputMode="numeric" min={1} max={10} className="px-2" value={u.count} onChange={(e) => setUses((l) => l.map((x, j) => (j === i ? { ...x, count: e.target.value } : x)))} />
                  <Button type="button" variant="ghost" size="icon" aria-label={`Odebrat položku komba ${i + 1}`} onClick={() => setUses((l) => l.filter((_, j) => j !== i))}>
                    <Trash2Icon aria-hidden />
                  </Button>
                </div>
              ))}
              {uses.length < 12 && usable.length > 0 && (
                <Button type="button" variant="outline" onClick={() => setUses((l) => [...l, { id: '', count: '1' }])}>
                  <PlusIcon aria-hidden /> Přidat položku
                </Button>
              )}
              <p className="text-xs text-muted-foreground">Tlačítko Použít u komba zaplatí cenu každé položky jednou a hodí všechny její útoky (počet útoků se bere odsud).</p>
            </fieldset>
            {field('expectedDamage', 'Očekávané zranění', { placeholder: '~31 dmg' })}
            {field('description', 'Popis', { area: true })}
            {check('highlight', 'Zvýraznit jako nejsilnější')}
          </>
        )}

        {kind === 'rule' && field('text', 'Text', { area: true, required: true, max: 2000 })}

        {kind !== 'rule' && <CostField value={text('cost')} onChange={(c) => set('cost', c)} />}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Zrušit
          </Button>
          <Button type="submit" disabled={pending}>
            Uložit
          </Button>
        </div>
      </form>
    </Modal>
  )
}

/** Cena: zdarma, ki nebo slot (od úrovně N). Skládá řetězec "free" / "ki:N" / "slot:N". */
function CostField({ value, onChange }: { value: string; onChange: (cost: string) => void }) {
  const cost = parseCost(value)
  const amount = cost.type === 'free' ? 1 : cost.n
  return (
    <fieldset className="space-y-1">
      <legend className="text-sm font-medium">Cena</legend>
      <div className="grid grid-cols-2 gap-3">
        <NativeSelect aria-label="Druh ceny" value={cost.type} onChange={(e) => onChange(e.target.value === 'free' ? 'free' : `${e.target.value}:${amount}`)}>
          <option value="free">Zdarma</option>
          <option value="ki">Ki</option>
          <option value="slot">Spell slot</option>
        </NativeSelect>
        <NativeSelect aria-label={cost.type === 'slot' ? 'Úroveň slotu' : 'Počet ki'} disabled={cost.type === 'free'} value={amount} onChange={(e) => onChange(`${cost.type}:${e.target.value}`)}>
          {Array.from({ length: cost.type === 'slot' ? 9 : 10 }, (_, i) => (
            <option key={i + 1} value={i + 1}>
              {cost.type === 'slot' ? `${i + 1}. úroveň` : `${i + 1} ki`}
            </option>
          ))}
        </NativeSelect>
      </div>
    </fieldset>
  )
}
