import { useState } from 'react'
import { ArrowLeftRightIcon, CoinsIcon, HandCoinsIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Modal } from '@/components/ui/modal'
import { NativeSelect } from '@/components/ui/native-select'
import { ApiError } from '@/lib/api'
import { DescriptionText } from '@/features/rules/DescriptionText'
import { useRules } from '@/features/rules/api'
import { metaLine } from '@/features/rules/labels'
import { cn } from '@/lib/utils'
import { effectLabel } from './effects'
import { ItemForm } from './ItemForm'
import { NotesText } from './NotesText'
import { useAddItem, useCharacters, useDeleteItem, useSpend, useTransfer, useUpdateItem, type ItemInput } from './api'
import { COINS, COIN_LABELS, convertCoins, formatCp, totalCp, totalGold, type Coin } from './money'
import { useSheet } from './sheet-context'
import type { CharacterItem } from './types'

const num = (n: number) => new Intl.NumberFormat('cs-CZ', { maximumFractionDigits: 2 }).format(n)

export function InventoryTab() {
  const { sheet, character, canEdit } = useSheet()
  const [adding, setAdding] = useState(false)
  const worn = character.items.filter((i) => i.equipped)
  const carried = character.items.filter((i) => !i.equipped)
  const enc = sheet.encumbrance
  const percent = Math.min(100, Math.round((enc.weight / enc.capacity) * 100))

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] lg:items-start">
      <div className="space-y-4">
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle>Vybavení</CardTitle>
            {canEdit && (
              <Button onClick={() => setAdding(true)}>
                <PlusIcon aria-hidden /> Přidat item
              </Button>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            <section aria-label="Nosnost" className="space-y-1">
              <p className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                <span>
                  Váha: <strong>{num(enc.weight)}</strong> / {num(enc.capacity)} lb
                </span>
                <span className="text-muted-foreground">
                  {enc.enabled
                    ? enc.status === 'ok'
                      ? 'bez přetížení'
                      : enc.status === 'encumbered'
                        ? 'přetížený (−10 ft)'
                        : enc.status === 'heavy'
                          ? 'těžce přetížený (−20 ft)'
                          : 'víc, než unesu'
                    : 'sledování přetížení je vypnuté'}
                </span>
              </p>
              <div className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
                <div
                  className={cn('h-full', enc.status === 'ok' ? 'bg-green-500' : enc.status === 'encumbered' ? 'bg-amber-500' : 'bg-red-500')}
                  style={{ width: `${percent}%` }}
                />
              </div>
            </section>

            {character.items.length === 0 && <p className="text-muted-foreground">Postava zatím nic nemá. Přidej item z pravidel nebo vlastní.</p>}
            {worn.length > 0 && <ItemGroup title="Nosím" items={worn} />}
            {carried.length > 0 && <ItemGroup title={worn.length > 0 ? 'V batohu' : 'Itemy'} items={carried} />}
          </CardContent>
        </Card>
      </div>
      <div className="space-y-4">
        <CurrencyCard />
        <Card>
          <CardHeader>
            <CardTitle>Attunement</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold" role="status" aria-label={`Attunement: ${sheet.attunement.used} ze ${sheet.attunement.max}`}>
              {sheet.attunement.used} / {sheet.attunement.max}
            </p>
            <p className="text-sm text-muted-foreground">Postava může být attunovaná nejvýš ke třem magickým itemům.</p>
          </CardContent>
        </Card>
      </div>
      <AddItemDialog open={adding} onClose={() => setAdding(false)} />
    </div>
  )
}

function ItemGroup({ title, items }: { title: string; items: CharacterItem[] }) {
  return (
    <section aria-label={title} className="space-y-2">
      <h3 className="text-sm font-medium text-muted-foreground">{title}</h3>
      <ul className="space-y-2">
        {items.map((i) => (
          <ItemRow key={i.id} item={i} />
        ))}
      </ul>
    </section>
  )
}

function ItemRow({ item }: { item: CharacterItem }) {
  const { character, sheet, canEdit } = useSheet()
  const update = useUpdateItem(character.id)
  const remove = useDeleteItem(character.id)
  const [editing, setEditing] = useState(false)
  const [transferring, setTransferring] = useState(false)
  const patch = (p: ItemInput) =>
    update.mutate({ itemId: item.id, patch: p }, { onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Změna se nepodařila.') })
  const attuneBlocked = !item.attuned && sheet.attunement.used >= sheet.attunement.max

  return (
    <li className="rounded-xl border bg-card">
      <div className="flex flex-wrap items-center gap-2 p-3">
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">
            {item.name}
            {item.quantity > 1 && <span className="ml-1 text-muted-foreground">×{item.quantity}</span>}
          </p>
          <p className="text-xs text-muted-foreground">
            {[
              item.kind === 'weapon' ? 'Zbraň' : item.kind === 'armor' ? 'Zbroj' : item.kind === 'shield' ? 'Štít' : null,
              item.rarity,
              item.weight > 0 ? `${num(item.weight * item.quantity)} lb` : null,
              item.requiresAttunement ? 'attunement' : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
        {canEdit && (
          <div className="flex flex-wrap items-center gap-2">
            {(item.kind !== 'item' || item.effects.length > 0) && (
              <Button
                variant={item.equipped ? 'default' : 'outline'}
                aria-pressed={item.equipped}
                onClick={() => patch({ equipped: !item.equipped })}
              >
                {item.equipped ? 'Nosím' : 'Nosit'}
              </Button>
            )}
            {item.kind === 'item' && item.effects.length === 0 && (
              <Button
                variant={item.equipped ? 'default' : 'outline'}
                aria-pressed={item.equipped}
                onClick={() => patch({ equipped: !item.equipped })}
              >
                {item.equipped ? 'U sebe' : 'Mít u sebe'}
              </Button>
            )}
            {item.requiresAttunement && (
              <Button
                variant={item.attuned ? 'default' : 'outline'}
                aria-pressed={item.attuned}
                disabled={attuneBlocked}
                title={attuneBlocked ? 'Už máš 3 attunované itemy' : undefined}
                onClick={() => patch({ attuned: !item.attuned })}
              >
                {item.attuned ? 'Attuned' : 'Attune'}
              </Button>
            )}
          </div>
        )}
      </div>
      <details className="border-t">
        <summary className="flex min-h-11 cursor-pointer items-center px-3 text-sm text-muted-foreground">Podrobnosti</summary>
        <div className="space-y-3 px-3 pb-3 text-sm">
          {item.effects.length > 0 && (
            <ul aria-label="Efekty" className="space-y-1">
              {item.effects.map((e, i) => (
                <li key={i}>
                  <strong>{e.value > 0 ? `+${e.value}` : e.value}</strong> {effectLabel(e.target)}
                  {!item.equipped || (item.requiresAttunement && !item.attuned) ? (
                    <span className="text-muted-foreground">
                      {' '}
                      (neaktivní: {item.requiresAttunement && !item.attuned ? 'chybí attunement' : 'není nošený'})
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {item.armor && (
            <p>
              AC {item.armor.base}
              {item.armor.dexBonus ? ` + DEX${item.armor.maxDexBonus !== null ? ` (max ${item.armor.maxDexBonus})` : ''}` : ''}
              {item.armor.magicBonus ? `, magický bonus ${item.armor.magicBonus > 0 ? '+' : ''}${item.armor.magicBonus}` : ''}
            </p>
          )}
          {item.weapon && (
            <p>
              {item.weapon.damageDice} {item.weapon.damageType}, {item.weapon.category}, {item.weapon.range === 'melee' ? 'na blízko' : 'na dálku'}
              {item.weapon.properties.length > 0 ? `, ${item.weapon.properties.join(', ')}` : ''}
              {item.weapon.magicBonus ? `, magický bonus +${item.weapon.magicBonus}` : ''}
              {item.weapon.extraDamage?.length ? `, + ${item.weapon.extraDamage.map((x) => `${x.dice} ${x.type.toLowerCase()}`).join(', + ')}` : ''}
            </p>
          )}
          {item.description && <DescriptionText text={item.description} />}
          {item.notes && <NotesText text={item.notes} className="space-y-1 text-muted-foreground" />}
          {canEdit && (
            <div className="flex flex-wrap gap-2 pt-1">
              {item.quantity > 1 && (
                <>
                  <Button variant="outline" onClick={() => patch({ quantity: item.quantity - 1 })}>
                    −1 ks
                  </Button>
                  <Button variant="outline" onClick={() => patch({ quantity: item.quantity + 1 })}>
                    +1 ks
                  </Button>
                </>
              )}
              {item.quantity === 1 && (
                <Button variant="outline" onClick={() => patch({ quantity: 2 })}>
                  +1 ks
                </Button>
              )}
              <Button variant="secondary" onClick={() => setEditing(true)}>
                Upravit
              </Button>
              <Button variant="secondary" onClick={() => setTransferring(true)}>
                <ArrowLeftRightIcon aria-hidden /> Předat
              </Button>
              <Button
                variant="destructive"
                disabled={remove.isPending}
                onClick={() => {
                  if (window.confirm(`Smazat „${item.name}“?`)) remove.mutate(item.id, { onError: () => toast.error('Item se nepodařilo smazat') })
                }}
              >
                <Trash2Icon aria-hidden /> Smazat
              </Button>
            </div>
          )}
        </div>
      </details>
      <Modal open={editing} onClose={() => setEditing(false)} title={`Upravit: ${item.name}`}>
        {editing && (
          <ItemForm
            item={item}
            pending={update.isPending}
            submitLabel="Uložit"
            onSubmit={(input) =>
              update.mutate(
                { itemId: item.id, patch: input },
                { onSuccess: () => setEditing(false), onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Uložení se nepodařilo.') },
              )
            }
          />
        )}
      </Modal>
      <TransferDialog open={transferring} onClose={() => setTransferring(false)} item={item} />
    </li>
  )
}

function AddItemDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { character } = useSheet()
  const [tab, setTab] = useState<'rules' | 'custom'>('rules')
  const [q, setQ] = useState('')
  const [kind, setKind] = useState('')
  const add = useAddItem(character.id)

  const kinds = kind === '' ? ['weapon', 'armor', 'equipment', 'magic_item'] : kind.split(',')
  const rules = useRules({ kinds, q: q.trim() || undefined, campaignId: character.campaignId })
  const entries = rules.data?.pages.flatMap((p) => p.entries) ?? []

  function addFromRule(ruleId: string, name: string) {
    add.mutate(
      { ruleId },
      {
        onSuccess: () => toast.success(`Přidáno: ${name}`),
        onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Přidání se nepodařilo.'),
      },
    )
  }

  return (
    <Modal open={open} onClose={onClose} title="Přidat item">
      <div className="space-y-4">
        <div role="tablist" aria-label="Zdroj itemu" className="grid grid-cols-2 gap-2">
          {(
            [
              ['rules', 'Z pravidel'],
              ['custom', 'Vlastní'],
            ] as const
          ).map(([id, label]) => (
            <Button key={id} role="tab" aria-selected={tab === id} variant={tab === id ? 'default' : 'outline'} onClick={() => setTab(id)}>
              {label}
            </Button>
          ))}
        </div>

        {tab === 'rules' ? (
          <div className="space-y-3">
            <Input type="search" aria-label="Hledat item" placeholder="Hledat podle názvu…" value={q} onChange={(e) => setQ(e.target.value)} />
            <NativeSelect aria-label="Druh itemu" value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="">Všechno</option>
              <option value="weapon">Zbraně</option>
              <option value="armor">Zbroje a štíty</option>
              <option value="equipment">Vybavení</option>
              <option value="magic_item">Magické itemy</option>
            </NativeSelect>
            <ul className="scroll-area max-h-[45dvh] space-y-2 pr-2">
              {entries.map((e) => (
                <li key={e.id} className="flex items-center justify-between gap-2 rounded-lg border p-2">
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{e.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">{metaLine(e)}</span>
                  </span>
                  <Button variant="secondary" disabled={add.isPending} aria-label={`Přidat ${e.name}`} onClick={() => addFromRule(e.id, e.name)}>
                    Přidat
                  </Button>
                </li>
              ))}
              {!rules.isPending && entries.length === 0 && <li className="text-sm text-muted-foreground">Nic nenalezeno.</li>}
            </ul>
            {rules.hasNextPage && (
              <Button variant="outline" className="w-full" onClick={() => void rules.fetchNextPage()}>
                Načíst další
              </Button>
            )}
            <p className="text-xs text-muted-foreground">
              Item mimo SRD se přidá jen s názvem, vzácností a cenou. Popis najdeš v příručce, případně si ho dopiš po přidání.
            </p>
          </div>
        ) : (
          <ItemForm
            pending={add.isPending}
            submitLabel="Přidat item"
            onSubmit={(input) =>
              add.mutate(input, {
                onSuccess: () => {
                  toast.success('Item přidán')
                  onClose()
                },
                onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Přidání se nepodařilo.'),
              })
            }
          />
        )}
      </div>
    </Modal>
  )
}

function TransferDialog({ open, onClose, item }: { open: boolean; onClose: () => void; item: CharacterItem }) {
  const { character } = useSheet()
  const { data: characters } = useCharacters(character.campaignId)
  const transfer = useTransfer(character.id)
  const [to, setTo] = useState('')
  const [qty, setQty] = useState(String(item.quantity))
  const recipients = (characters ?? []).filter((c) => c.id !== character.id)

  return (
    <Modal open={open} onClose={onClose} title={`Předat: ${item.name}`}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          transfer.mutate(
            { toCharacterId: to, itemId: item.id, quantity: Math.min(item.quantity, Math.max(1, Number.parseInt(qty, 10) || 1)) },
            {
              onSuccess: () => {
                toast.success('Předáno')
                onClose()
              },
              onError: (err) => toast.error(err instanceof ApiError ? err.message : 'Předání se nepodařilo.'),
            },
          )
        }}
      >
        <div className="space-y-2">
          <Label htmlFor="tr-to">Komu</Label>
          <NativeSelect id="tr-to" required value={to} onChange={(e) => setTo(e.target.value)}>
            <option value="">Vyber postavu…</option>
            {recipients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.kind === 'npc' ? ' (NPC)' : ''}
              </option>
            ))}
          </NativeSelect>
        </div>
        {item.quantity > 1 && (
          <div className="space-y-2">
            <Label htmlFor="tr-qty">Kolik kusů (máš {item.quantity})</Label>
            <Input id="tr-qty" type="number" inputMode="numeric" min={1} max={item.quantity} value={qty} onChange={(e) => setQty(e.target.value)} />
          </div>
        )}
        <Button type="submit" size="lg" className="w-full" disabled={!to || transfer.isPending}>
          Předat
        </Button>
      </form>
    </Modal>
  )
}

function CurrencyCard() {
  const { character, canEdit, update } = useSheet()
  const [converting, setConverting] = useState(false)
  const [paying, setPaying] = useState(false)
  const [spending, setSpending] = useState(false)
  const wallet = character.currency

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2">
          <CoinsIcon aria-hidden className="size-5" /> Peníze
        </CardTitle>
        <span className="text-sm text-muted-foreground">celkem {num(totalGold(wallet))} gp</span>
      </CardHeader>
      <CardContent className="space-y-3">
        <ul className="grid grid-cols-5 gap-2">
          {COINS.map((c) => (
            <li key={c} className="space-y-1 text-center">
              <Label htmlFor={`coin-${c}`} className="justify-center text-xs uppercase">
                {c}
              </Label>
              <Input
                id={`coin-${c}`}
                type="number"
                inputMode="numeric"
                min={0}
                className="px-1 text-center"
                disabled={!canEdit}
                defaultValue={wallet[c]}
                key={`${c}-${wallet[c]}`}
                aria-label={COIN_LABELS[c]}
                onBlur={(e) => {
                  const value = Math.max(0, Number.parseInt(e.target.value, 10) || 0)
                  if (value !== wallet[c]) update({ currency: { ...wallet, [c]: value } })
                }}
              />
            </li>
          ))}
        </ul>
        {canEdit && (
          <div className="grid grid-cols-2 gap-2">
            <Button className="col-span-2" onClick={() => setSpending(true)}>
              <HandCoinsIcon aria-hidden /> Utratit
            </Button>
            <Button variant="secondary" onClick={() => setConverting(true)}>
              Převést mince
            </Button>
            <Button variant="secondary" onClick={() => setPaying(true)}>
              <ArrowLeftRightIcon aria-hidden /> Předat peníze
            </Button>
          </div>
        )}
      </CardContent>
      <ConvertDialog open={converting} onClose={() => setConverting(false)} />
      <PayDialog open={paying} onClose={() => setPaying(false)} />
      <SpendDialog open={spending} onClose={() => setSpending(false)} />
    </Card>
  )
}

function ConvertDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { character, update } = useSheet()
  const [from, setFrom] = useState<Coin>('sp')
  const [to, setTo] = useState<Coin>('gp')
  const [amount, setAmount] = useState('10')
  const result = convertCoins(character.currency, from, to, Number.parseInt(amount, 10))

  return (
    <Modal open={open} onClose={onClose} title="Převést mince">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          if (!result) return
          update({ currency: result.wallet })
          toast.success(`Převedeno: ${result.spent} ${from} na ${result.gained} ${to}`)
          onClose()
        }}
      >
        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-2">
            <Label htmlFor="cv-amount">Kolik</Label>
            <Input id="cv-amount" type="number" inputMode="numeric" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="cv-from">Z</Label>
            <NativeSelect id="cv-from" value={from} onChange={(e) => setFrom(e.target.value as Coin)}>
              {COINS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-2">
            <Label htmlFor="cv-to">Na</Label>
            <NativeSelect id="cv-to" value={to} onChange={(e) => setTo(e.target.value as Coin)}>
              {COINS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </NativeSelect>
          </div>
        </div>
        <p className="text-sm text-muted-foreground" role="status">
          {result
            ? `Vyjde ${result.gained} ${to} za ${result.spent} ${from}.`
            : 'Takhle to nejde převést (nemáš tolik mincí nebo nevyjde celá mince).'}
        </p>
        <p className="text-xs text-muted-foreground">1 pp = 10 gp, 1 gp = 2 ep = 10 sp, 1 sp = 10 cp.</p>
        <Button type="submit" size="lg" className="w-full" disabled={!result}>
          Převést
        </Button>
      </form>
    </Modal>
  )
}

/** Utratit peníze: částka v mincích a (nepovinně) za co. Server rozmění větší mince a vrátí drobné. */
function SpendDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { character } = useSheet()
  const spend = useSpend(character.id)
  const [amounts, setAmounts] = useState<Record<Coin, string>>({ pp: '', gp: '', ep: '', sp: '', cp: '' })
  const [note, setNote] = useState('')
  const cost = Object.fromEntries(COINS.map((c) => [c, Math.max(0, Number.parseInt(amounts[c], 10) || 0)])) as Record<Coin, number>
  const costCp = totalCp(cost)
  const have = totalCp(character.currency)
  const enough = costCp <= have

  return (
    <Modal open={open} onClose={onClose} title="Utratit peníze">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          spend.mutate(
            { currency: cost, note: note.trim() || undefined },
            {
              onSuccess: (res) => {
                toast.success(`Utraceno ${formatCp(res.spentCp)}${res.note ? `: ${res.note}` : ''}`, { description: `Zbývá ${num(totalGold(res.currency))} gp` })
                setAmounts({ pp: '', gp: '', ep: '', sp: '', cp: '' })
                setNote('')
                onClose()
              },
              onError: (err) => toast.error(err instanceof ApiError ? err.message : 'Platba se nepodařila.'),
            },
          )
        }}
      >
        <p className="text-sm text-muted-foreground">
          Máš <strong className="text-foreground">{formatCp(have)}</strong>. Když nemáš přesné mince, rozmění se větší a vrátí se drobné.
        </p>
        <div className="grid grid-cols-5 gap-2">
          {COINS.map((c) => (
            <div key={c} className="space-y-1 text-center">
              <Label htmlFor={`spend-${c}`} className="justify-center text-xs uppercase">
                {c}
              </Label>
              <Input
                id={`spend-${c}`}
                type="number"
                inputMode="numeric"
                min={0}
                className="px-1 text-center"
                aria-label={COIN_LABELS[c]}
                value={amounts[c]}
                onChange={(e) => setAmounts((a) => ({ ...a, [c]: e.target.value }))}
              />
            </div>
          ))}
        </div>
        <div className="space-y-2">
          <Label htmlFor="spend-note">Za co (nepovinné)</Label>
          <Input id="spend-note" maxLength={100} placeholder="např. pivo u barmana, úplatek pro stráž" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        {costCp > 0 && enough && <p className="text-sm">Zaplatíš <strong>{formatCp(costCp)}</strong>.</p>}
        {!enough && (
          <p role="alert" className="text-sm text-destructive">
            Nemáš dost peněz: potřebuješ {formatCp(costCp)}, máš {formatCp(have)}.
          </p>
        )}
        <Button type="submit" size="lg" className="w-full" disabled={costCp <= 0 || !enough || spend.isPending}>
          Zaplatit
        </Button>
      </form>
    </Modal>
  )
}

function PayDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { character } = useSheet()
  const { data: characters } = useCharacters(character.campaignId)
  const transfer = useTransfer(character.id)
  const [to, setTo] = useState('')
  const [amounts, setAmounts] = useState<Record<Coin, string>>({ pp: '', gp: '', ep: '', sp: '', cp: '' })
  const recipients = (characters ?? []).filter((c) => c.id !== character.id)
  const currency = Object.fromEntries(COINS.map((c) => [c, Math.max(0, Number.parseInt(amounts[c], 10) || 0)])) as Record<Coin, number>
  const any = COINS.some((c) => currency[c] > 0)
  const enough = COINS.every((c) => currency[c] <= character.currency[c])

  return (
    <Modal open={open} onClose={onClose} title="Předat peníze">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          transfer.mutate(
            { toCharacterId: to, currency },
            {
              onSuccess: () => {
                toast.success('Peníze předány')
                setAmounts({ pp: '', gp: '', ep: '', sp: '', cp: '' })
                onClose()
              },
              onError: (err) => toast.error(err instanceof ApiError ? err.message : 'Předání se nepodařilo.'),
            },
          )
        }}
      >
        <div className="space-y-2">
          <Label htmlFor="pay-to">Komu</Label>
          <NativeSelect id="pay-to" required value={to} onChange={(e) => setTo(e.target.value)}>
            <option value="">Vyber postavu…</option>
            {recipients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.kind === 'npc' ? ' (NPC)' : ''}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="grid grid-cols-5 gap-2">
          {COINS.map((c) => (
            <div key={c} className="space-y-1 text-center">
              <Label htmlFor={`pay-${c}`} className="justify-center text-xs uppercase">
                {c}
              </Label>
              <Input
                id={`pay-${c}`}
                type="number"
                inputMode="numeric"
                min={0}
                className="px-1 text-center"
                placeholder={String(character.currency[c])}
                value={amounts[c]}
                onChange={(e) => setAmounts((a) => ({ ...a, [c]: e.target.value }))}
              />
            </div>
          ))}
        </div>
        {!enough && (
          <p role="alert" className="text-sm text-destructive">
            Nemáš dost mincí.
          </p>
        )}
        <Button type="submit" size="lg" className="w-full" disabled={!to || !any || !enough || transfer.isPending}>
          Předat
        </Button>
      </form>
    </Modal>
  )
}
