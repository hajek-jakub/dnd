import { useState, type FormEvent, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Modal } from '@/components/ui/modal'
import { NativeSelect } from '@/components/ui/native-select'
import { ApiError } from '@/lib/api'
import { useRules } from '@/features/rules/api'
import { metaLine } from '@/features/rules/labels'
import { EFFECT_TARGETS } from '@/features/sheet/effects'
import { ItemForm } from '@/features/sheet/ItemForm'
import { COINS, COIN_LABELS, formatCoins, fromCp, splitCoins, totalCp, type Coin } from '@/features/sheet/money'
import type { ItemInput } from '@/features/sheet/api'
import {
  useAddEffect,
  useDmHp,
  useGiveCurrency,
  useGiveItem,
  useGiveXp,
  useSetCondition,
  useSetInspiration,
  useSetTempHp,
} from './api'

export interface DmTarget {
  id: string
  name: string
  hpMax: number
}

export type DmAction = 'hp' | 'temp' | 'xp' | 'currency' | 'item' | 'condition' | 'inspiration' | 'effect'

interface DialogProps {
  campaignId: string
  targets: DmTarget[]
  onClose: () => void
}

const errorText = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback)

function Targets({ targets }: { targets: DmTarget[] }) {
  return (
    <p className="text-sm text-muted-foreground">
      Komu: <strong className="text-foreground">{targets.map((t) => t.name).join(', ')}</strong>
    </p>
  )
}

function Form({ onSubmit, children }: { onSubmit: () => void; children: ReactNode }) {
  return (
    <form
      className="space-y-4"
      onSubmit={(e: FormEvent) => {
        e.preventDefault()
        onSubmit()
      }}
    >
      {children}
    </form>
  )
}

export function DmDialogs({ action, campaignId, targets, onClose }: { action: DmAction | null } & DialogProps) {
  const common = { campaignId, targets, onClose }
  return (
    <>
      <Modal open={action === 'hp'} onClose={onClose} title="Zranění nebo léčení">
        {action === 'hp' && <HpForm {...common} />}
      </Modal>
      <Modal open={action === 'temp'} onClose={onClose} title="Dočasná HP">
        {action === 'temp' && <TempHpForm {...common} />}
      </Modal>
      <Modal open={action === 'xp'} onClose={onClose} title="Dát XP">
        {action === 'xp' && <XpForm {...common} />}
      </Modal>
      <Modal open={action === 'currency'} onClose={onClose} title="Dát peníze">
        {action === 'currency' && <CurrencyForm {...common} />}
      </Modal>
      <Modal open={action === 'item'} onClose={onClose} title="Dát item">
        {action === 'item' && <ItemPicker {...common} />}
      </Modal>
      <Modal open={action === 'condition'} onClose={onClose} title="Stav postavy">
        {action === 'condition' && <ConditionForm {...common} />}
      </Modal>
      <Modal open={action === 'inspiration'} onClose={onClose} title="Inspirace">
        {action === 'inspiration' && <InspirationForm {...common} />}
      </Modal>
      <Modal open={action === 'effect'} onClose={onClose} title="Bonus nebo efekt">
        {action === 'effect' && <EffectForm {...common} />}
      </Modal>
    </>
  )
}

function HpForm({ campaignId, targets, onClose }: DialogProps) {
  const [amount, setAmount] = useState('')
  const [mode, setMode] = useState<'damage' | 'heal'>('damage')
  const mutation = useDmHp(campaignId)
  const value = Number.parseInt(amount, 10)
  const valid = Number.isInteger(value) && value > 0

  function submit() {
    if (!valid) return
    mutation.mutate(
      { delta: mode === 'damage' ? -value : value, targets: targets.map((t) => ({ characterId: t.id, max: t.hpMax })) },
      {
        onSuccess: () => {
          toast.success(mode === 'damage' ? 'Zranění uděleno' : 'Vyléčeno')
          onClose()
        },
        onError: (e) => toast.error(errorText(e, 'Změna HP se nepodařila.')),
      },
    )
  }

  return (
    <Form onSubmit={submit}>
      <Targets targets={targets} />
      <div role="group" aria-label="Druh změny" className="grid grid-cols-2 gap-2">
        <Button type="button" aria-pressed={mode === 'damage'} variant={mode === 'damage' ? 'default' : 'outline'} onClick={() => setMode('damage')}>
          Zranění
        </Button>
        <Button type="button" aria-pressed={mode === 'heal'} variant={mode === 'heal' ? 'default' : 'outline'} onClick={() => setMode('heal')}>
          Léčení
        </Button>
      </div>
      <div className="space-y-2">
        <Label htmlFor="dm-hp-amount">Kolik HP</Label>
        <Input id="dm-hp-amount" type="number" inputMode="numeric" min={1} max={9999} autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} />
      </div>
      <p className="text-xs text-muted-foreground">Zranění nejdřív ubere dočasná HP. Léčení nepřekročí maximum.</p>
      <Button type="submit" size="lg" className="w-full" disabled={!valid || mutation.isPending}>
        {mode === 'damage' ? 'Způsobit zranění' : 'Vyléčit'}
      </Button>
    </Form>
  )
}

function TempHpForm({ campaignId, targets, onClose }: DialogProps) {
  const [amount, setAmount] = useState('')
  const mutation = useSetTempHp(campaignId)
  const value = Number.parseInt(amount, 10)
  const valid = Number.isInteger(value) && value >= 0

  function submit() {
    if (!valid) return
    mutation.mutate(
      { characterIds: targets.map((t) => t.id), amount: value },
      {
        onSuccess: () => {
          toast.success(value > 0 ? 'Dočasná HP nastavena' : 'Dočasná HP zrušena')
          onClose()
        },
        onError: (e) => toast.error(errorText(e, 'Dočasná HP se nepodařilo nastavit.')),
      },
    )
  }

  return (
    <Form onSubmit={submit}>
      <Targets targets={targets} />
      <div className="space-y-2">
        <Label htmlFor="dm-temp-amount">Kolik dočasných HP</Label>
        <Input id="dm-temp-amount" type="number" inputMode="numeric" min={0} autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} />
      </div>
      <p className="text-xs text-muted-foreground">Dočasná HP se nesčítají, platí nová hodnota. Nula je zruší.</p>
      <Button type="submit" size="lg" className="w-full" disabled={!valid || mutation.isPending}>
        Nastavit dočasná HP
      </Button>
    </Form>
  )
}

function XpForm({ campaignId, targets, onClose }: DialogProps) {
  const [amount, setAmount] = useState('')
  const [split, setSplit] = useState(false)
  const mutation = useGiveXp(campaignId)
  const value = Number.parseInt(amount, 10)
  const valid = Number.isInteger(value) && value > 0

  function submit() {
    if (!valid) return
    mutation.mutate(
      { characterIds: targets.map((t) => t.id), amount: value, split },
      {
        onSuccess: (r) => {
          toast.success(targets.length > 1 ? `Každý dostal ${r.eachGets} XP` : `Přidáno ${r.eachGets} XP`)
          onClose()
        },
        onError: (e) => toast.error(errorText(e, 'XP se nepodařilo přidat.')),
      },
    )
  }

  return (
    <Form onSubmit={submit}>
      <Targets targets={targets} />
      <div className="space-y-2">
        <Label htmlFor="dm-xp-amount">Kolik XP</Label>
        <Input id="dm-xp-amount" type="number" inputMode="numeric" min={1} autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} />
      </div>
      {targets.length > 1 && (
        <label className="flex min-h-11 items-center gap-3">
          <input type="checkbox" className="size-5" checked={split} onChange={(e) => setSplit(e.target.checked)} />
          <span>Rozdělit rovným dílem mezi vybrané (zaokrouhleno dolů)</span>
        </label>
      )}
      <Button type="submit" size="lg" className="w-full" disabled={!valid || mutation.isPending}>
        Dát XP
      </Button>
    </Form>
  )
}

function CurrencyForm({ campaignId, targets, onClose }: DialogProps) {
  const [values, setValues] = useState<Record<Coin, string>>({ cp: '', sp: '', ep: '', gp: '', pp: '' })
  const [mode, setMode] = useState<'give' | 'take'>('give')
  const [split, setSplit] = useState(false)
  const [reason, setReason] = useState('')
  const mutation = useGiveCurrency(campaignId)
  const parsed = Object.fromEntries(COINS.map((c) => [c, Number.parseInt(values[c], 10) || 0])) as Record<Coin, number>
  const valid = COINS.some((c) => parsed[c] > 0) && COINS.every((c) => parsed[c] >= 0)
  const many = targets.length > 1
  const splitting = split && many
  // Náhled toho, co dostane (nebo zaplatí) každý, stejným výpočtem jako server.
  const total = totalCp(parsed)
  const preview = !valid
    ? null
    : !splitting
      ? { text: formatCoins(parsed), leftover: 0, tooSmall: false }
      : mode === 'give'
        ? (() => {
            const r = splitCoins(parsed, targets.length)
            return { text: formatCoins(r.share), leftover: r.leftoverCp, tooSmall: r.eachCp < 1 }
          })()
        : (() => {
            const each = Math.floor(total / targets.length)
            return { text: formatCoins(fromCp(each)), leftover: total - each * targets.length, tooSmall: each < 1 }
          })()

  function submit() {
    if (!valid || preview?.tooSmall) return
    mutation.mutate(
      { characterIds: targets.map((t) => t.id), currency: parsed, mode, split: splitting, reason: reason.trim() || undefined },
      {
        onSuccess: (r) => {
          const each = r.mode === 'give' ? formatCoins(r.each) : formatCoins(fromCp(r.eachCp))
          toast.success(
            r.mode === 'give'
              ? many && splitting ? `Každý dostal ${each}${r.leftoverCp > 0 ? ` (zbytek ${r.leftoverCp} cp zůstal u tebe)` : ''}` : 'Peníze předány'
              : many ? `Každý zaplatil ${each}` : `Odebráno ${each}`,
          )
          onClose()
        },
        onError: (e) => toast.error(errorText(e, mode === 'give' ? 'Peníze se nepodařilo předat.' : 'Peníze se nepodařilo odebrat.')),
      },
    )
  }

  return (
    <Form onSubmit={submit}>
      <Targets targets={targets} />
      <div role="group" aria-label="Druh změny" className="grid grid-cols-2 gap-2">
        <Button type="button" aria-pressed={mode === 'give'} variant={mode === 'give' ? 'default' : 'outline'} onClick={() => setMode('give')}>
          Dát
        </Button>
        <Button type="button" aria-pressed={mode === 'take'} variant={mode === 'take' ? 'default' : 'outline'} onClick={() => setMode('take')}>
          Vzít
        </Button>
      </div>
      <div className="grid grid-cols-5 gap-2">
        {COINS.map((c) => (
          <div key={c} className="space-y-1">
            <Label htmlFor={`dm-coin-${c}`} title={COIN_LABELS[c]}>
              {c.toUpperCase()}
            </Label>
            <Input
              id={`dm-coin-${c}`}
              type="number"
              inputMode="numeric"
              min={0}
              value={values[c]}
              onChange={(e) => setValues((v) => ({ ...v, [c]: e.target.value }))}
              className="px-2"
            />
          </div>
        ))}
      </div>
      {many && (
        <label className="flex min-h-11 items-center gap-3">
          <input type="checkbox" className="size-5" checked={split} onChange={(e) => setSplit(e.target.checked)} />
          <span>Rozdělit rovným dílem mezi vybrané ({targets.length})</span>
        </label>
      )}
      <div className="space-y-2">
        <Label htmlFor="dm-coin-reason">Důvod (nepovinné, uvidí ho hráč v oznámení)</Label>
        <Input id="dm-coin-reason" value={reason} maxLength={120} onChange={(e) => setReason(e.target.value)} placeholder="odměna od starosty, pokuta, účet v hospodě…" />
      </div>
      <p className="text-sm text-muted-foreground" aria-live="polite" data-testid="coin-preview">
        {preview === null
          ? mode === 'give' ? 'Zadej částku.' : 'Zadej částku. Drobné se vrací, když chybí přesné mince.'
          : preview.tooSmall
            ? 'Částka je na tolik postav příliš malá, na každého by nezbyl ani měďák.'
            : `${mode === 'give' ? (many && !splitting ? 'Každý dostane celou částku' : 'Každý dostane') : many && !splitting ? 'Každý zaplatí celou částku' : 'Každý zaplatí'}: ${preview.text}${preview.leftover > 0 ? `. Zbytek ${preview.leftover} cp se nedělí beze zbytku a zůstane u tebe.` : ''}`}
      </p>
      <Button type="submit" size="lg" className="w-full" disabled={!valid || Boolean(preview?.tooSmall) || mutation.isPending}>
        {mode === 'give' ? 'Dát peníze' : 'Vzít peníze'}
      </Button>
    </Form>
  )
}

function ItemPicker({ campaignId, targets, onClose }: DialogProps) {
  const [tab, setTab] = useState<'rules' | 'custom'>('rules')
  const [q, setQ] = useState('')
  const [kind, setKind] = useState('')
  const [quantity, setQuantity] = useState('1')
  const give = useGiveItem(campaignId)
  const kinds = kind === '' ? ['weapon', 'armor', 'equipment', 'magic_item'] : kind.split(',')
  const rules = useRules({ kinds, q: q.trim() || undefined, campaignId })
  const entries = rules.data?.pages.flatMap((p) => p.entries) ?? []
  const qty = Math.max(1, Number.parseInt(quantity, 10) || 1)

  function send(item: ItemInput, label: string) {
    give.mutate(
      { characterIds: targets.map((t) => t.id), item },
      {
        onSuccess: () => {
          toast.success(`Předáno: ${label}`)
          onClose()
        },
        onError: (e) => toast.error(errorText(e, 'Item se nepodařilo předat.')),
      },
    )
  }

  return (
    <div className="space-y-4">
      <Targets targets={targets} />
      <div role="tablist" aria-label="Zdroj itemu" className="grid grid-cols-2 gap-2">
        {(
          [
            ['rules', 'Z pravidel'],
            ['custom', 'Jednorázový'],
          ] as const
        ).map(([id, label]) => (
          <Button key={id} type="button" role="tab" aria-selected={tab === id} variant={tab === id ? 'default' : 'outline'} onClick={() => setTab(id)}>
            {label}
          </Button>
        ))}
      </div>

      {tab === 'rules' ? (
        <div className="space-y-3">
          <Input type="search" aria-label="Hledat item" placeholder="Hledat podle názvu…" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="grid grid-cols-[1fr_6rem] gap-2">
            <NativeSelect aria-label="Druh itemu" value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="">Všechno</option>
              <option value="weapon">Zbraně</option>
              <option value="armor">Zbroje a štíty</option>
              <option value="equipment">Vybavení</option>
              <option value="magic_item">Magické itemy</option>
            </NativeSelect>
            <Input aria-label="Počet kusů" type="number" min={1} max={9999} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          </div>
          <ul className="scroll-area max-h-[40dvh] space-y-2 pr-2">
            {entries.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-2 rounded-lg border p-2">
                <span className="min-w-0">
                  <span className="block truncate font-medium">{e.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{metaLine(e)}</span>
                </span>
                <Button type="button" variant="secondary" disabled={give.isPending} aria-label={`Dát ${e.name}`} onClick={() => send({ ruleId: e.id, quantity: qty }, e.name)}>
                  Dát
                </Button>
              </li>
            ))}
            {!rules.isPending && entries.length === 0 && <li className="text-sm text-muted-foreground">Nic nenalezeno.</li>}
          </ul>
          {rules.hasNextPage && (
            <Button type="button" variant="outline" className="w-full" onClick={() => void rules.fetchNextPage()}>
              Načíst další
            </Button>
          )}
        </div>
      ) : (
        <ItemForm pending={give.isPending} submitLabel="Dát item" onSubmit={(input) => send(input, input.name ?? 'item')} />
      )}
    </div>
  )
}

const SRD_CONDITIONS = [
  'Blinded',
  'Charmed',
  'Deafened',
  'Exhaustion',
  'Frightened',
  'Grappled',
  'Incapacitated',
  'Invisible',
  'Paralyzed',
  'Petrified',
  'Poisoned',
  'Prone',
  'Restrained',
  'Stunned',
  'Unconscious',
]

function ConditionForm({ campaignId, targets, onClose }: DialogProps) {
  const [name, setName] = useState('Poisoned')
  const [set, setSet] = useState(true)
  const mutation = useSetCondition(campaignId)
  const valid = name.trim().length > 0

  function submit() {
    if (!valid) return
    mutation.mutate(
      { characterIds: targets.map((t) => t.id), name: name.trim(), set },
      {
        onSuccess: () => {
          toast.success(set ? `Stav nastaven: ${name.trim()}` : `Stav zrušen: ${name.trim()}`)
          onClose()
        },
        onError: (e) => toast.error(errorText(e, 'Stav se nepodařilo změnit.')),
      },
    )
  }

  return (
    <Form onSubmit={submit}>
      <Targets targets={targets} />
      <div role="group" aria-label="Nastavit nebo zrušit" className="grid grid-cols-2 gap-2">
        <Button type="button" aria-pressed={set} variant={set ? 'default' : 'outline'} onClick={() => setSet(true)}>
          Nastavit
        </Button>
        <Button type="button" aria-pressed={!set} variant={!set ? 'default' : 'outline'} onClick={() => setSet(false)}>
          Zrušit
        </Button>
      </div>
      <div className="space-y-2">
        <Label htmlFor="dm-condition">Stav</Label>
        <Input id="dm-condition" list="dm-condition-list" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
        <datalist id="dm-condition-list">
          {SRD_CONDITIONS.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </div>
      <Button type="submit" size="lg" className="w-full" disabled={!valid || mutation.isPending}>
        {set ? 'Nastavit stav' : 'Zrušit stav'}
      </Button>
    </Form>
  )
}

function InspirationForm({ campaignId, targets, onClose }: DialogProps) {
  const mutation = useSetInspiration(campaignId)

  function send(set: boolean) {
    mutation.mutate(
      { characterIds: targets.map((t) => t.id), set },
      {
        onSuccess: () => {
          toast.success(set ? 'Inspirace udělena' : 'Inspirace odebrána')
          onClose()
        },
        onError: (e) => toast.error(errorText(e, 'Inspiraci se nepodařilo změnit.')),
      },
    )
  }

  return (
    <div className="space-y-4">
      <Targets targets={targets} />
      <div className="grid grid-cols-2 gap-2">
        <Button size="lg" disabled={mutation.isPending} onClick={() => send(true)}>
          Dát inspiraci
        </Button>
        <Button size="lg" variant="outline" disabled={mutation.isPending} onClick={() => send(false)}>
          Odebrat
        </Button>
      </div>
    </div>
  )
}

function EffectForm({ campaignId, targets, onClose }: DialogProps) {
  const [target, setTarget] = useState('ac')
  const [value, setValue] = useState('1')
  const [source, setSource] = useState('')
  const [duration, setDuration] = useState<'permanent' | 'long_rest' | 'manual'>('manual')
  const mutation = useAddEffect(campaignId)
  const amount = Number.parseInt(value, 10)
  const valid = Number.isInteger(amount) && amount !== 0 && source.trim().length > 0

  function submit() {
    if (!valid) return
    mutation.mutate(
      { characterIds: targets.map((t) => t.id), target, value: amount, source: source.trim(), duration },
      {
        onSuccess: () => {
          toast.success('Bonus přidán')
          onClose()
        },
        onError: (e) => toast.error(errorText(e, 'Bonus se nepodařilo přidat.')),
      },
    )
  }

  return (
    <Form onSubmit={submit}>
      <Targets targets={targets} />
      <div className="space-y-2">
        <Label htmlFor="dm-effect-target">Co ovlivňuje</Label>
        <NativeSelect id="dm-effect-target" value={target} onChange={(e) => setTarget(e.target.value)}>
          {EFFECT_TARGETS.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="grid grid-cols-[6rem_1fr] gap-2">
        <div className="space-y-2">
          <Label htmlFor="dm-effect-value">Hodnota</Label>
          <Input id="dm-effect-value" type="number" inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="dm-effect-source">Zdroj (uvidí ho hráč)</Label>
          <Input id="dm-effect-source" maxLength={80} placeholder="např. Shield of Faith" value={source} onChange={(e) => setSource(e.target.value)} />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="dm-effect-duration">Trvání</Label>
        <NativeSelect id="dm-effect-duration" value={duration} onChange={(e) => setDuration(e.target.value as typeof duration)}>
          <option value="manual">Dokud ho nezruším</option>
          <option value="long_rest">Do long restu</option>
          <option value="permanent">Trvalý</option>
        </NativeSelect>
      </div>
      <Button type="submit" size="lg" className="w-full" disabled={!valid || mutation.isPending}>
        Přidat bonus
      </Button>
    </Form>
  )
}
