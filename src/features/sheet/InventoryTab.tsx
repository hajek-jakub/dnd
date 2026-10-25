import { useState } from 'react'
import { ArrowLeftRightIcon, ChevronRightIcon, CoinsIcon, EyeIcon, EyeOffIcon, HandCoinsIcon, MinusIcon, PencilIcon, PlusIcon, SearchIcon, SkullIcon, SparklesIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Modal } from '@/components/ui/modal'
import { NativeSelect } from '@/components/ui/native-select'
import { RichText } from '@/components/RichText'
import { ApiError } from '@/lib/api'
import { cn } from '@/lib/utils'
import { DescriptionText } from '@/features/rules/DescriptionText'
import { unusedArmor } from './armor-hints'
import { hasCharges } from './charges'
import { effectLabel } from './effects'
import { ItemChargesControl } from './ItemChargesControl'
import { ItemForm } from './ItemForm'
import { ItemSourcePicker } from './ItemSourcePicker'
import { ITEM_KIND_SHORT } from './labels'
import { NotesText } from './NotesText'
import { useAddItem, useCharacters, useDeleteItem, useSpend, useTransfer, useUpdateItem, type ItemInput } from './api'
import { COINS, COIN_LABELS, convertCoins, formatCp, totalCp, totalGold, type Coin } from './money'
import { useSheet } from './sheet-context'
import type { CharacterItem } from './types'

const num = (n: number) => new Intl.NumberFormat('cs-CZ', { maximumFractionDigits: 2 }).format(n)

type GroupKey = 'gear' | 'magic' | 'consumable' | 'other'

const GROUPS: { key: GroupKey; title: string }[] = [
  { key: 'gear', title: 'Zbraně a zbroj' },
  { key: 'magic', title: 'Magické předměty' },
  { key: 'consumable', title: 'Spotřební' },
  { key: 'other', title: 'Ostatní vybavení' },
]

/** Zbraně, zbroj a štíty (útoky, AC). Nic se nenasazuje: postava má u sebe všechno a engine z toho vybere nejlepší AC. */
const isGear = (i: CharacterItem) => i.kind === 'weapon' || i.kind === 'armor' || i.kind === 'shield'

function groupOf(i: CharacterItem): GroupKey {
  if (isGear(i)) return 'gear'
  if (i.consumable) return 'consumable'
  if (i.rarity || i.requiresAttunement || i.effects.length > 0 || hasCharges(i) || ['wondrous', 'staff', 'wand', 'rod'].includes(i.kind)) return 'magic'
  return 'other'
}

const fold = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
const byName = (a: CharacterItem, b: CharacterItem) => a.name.localeCompare(b.name, 'cs')

export function InventoryTab() {
  const { sheet, character, canEdit } = useSheet()
  const [adding, setAdding] = useState(false)
  const [query, setQuery] = useState('')
  const items = character.items
  const q = fold(query.trim())
  const shown = q ? items.filter((i) => fold(i.name).includes(q)) : items
  const groups = GROUPS.map((g) => ({
    ...g,
    items: shown.filter((i) => groupOf(i) === g.key).sort(byName),
  })).filter((g) => g.items.length > 0)

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 tab:grid-cols-[minmax(0,1fr)_minmax(0,18rem)] tab:items-start lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
      <div className="space-y-4">
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
            <CardTitle>Vybavení</CardTitle>
            <div className="flex flex-wrap items-center gap-2">
              <span
                role="status"
                aria-label={`Attunement: ${sheet.attunement.used} ze ${sheet.attunement.max}`}
                title="Postava může být attunovaná nejvýš ke třem magickým itemům."
                className={cn(
                  'inline-flex items-center gap-1 rounded-full border px-3 py-1 text-sm',
                  sheet.attunement.used >= sheet.attunement.max && 'border-amber-500 text-amber-800 dark:text-amber-300',
                )}
              >
                <SparklesIcon aria-hidden className="size-4" /> Attunement {sheet.attunement.used}/{sheet.attunement.max}
              </span>
              {canEdit && (
                <Button onClick={() => setAdding(true)}>
                  <PlusIcon aria-hidden /> Přidat item
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            {items.length === 0 && <p className="text-muted-foreground">Postava zatím nic nemá. Přidej item z pravidel nebo vlastní.</p>}
            {items.length >= 8 && (
              <div className="relative">
                <SearchIcon aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input type="search" aria-label="Hledat v inventáři" placeholder="Hledat v inventáři" className="pl-9" value={query} onChange={(e) => setQuery(e.target.value)} />
              </div>
            )}
            {items.length > 0 && groups.length === 0 && <p className="text-muted-foreground">Nic takového postava nemá.</p>}
            {groups.map((g) => (
              <ItemGroup key={g.key} title={g.title} items={g.items} />
            ))}
          </CardContent>
        </Card>
      </div>
      <div className="space-y-4 tab:sticky tab:top-28 tab:-mr-1 tab:max-h-[calc(100dvh-8rem)] tab:overflow-y-auto tab:overscroll-contain tab:pr-1">
        <CurrencyCard />
      </div>
      <AddItemDialog open={adding} onClose={() => setAdding(false)} />
    </div>
  )
}

function ItemGroup({ title, items }: { title: string; items: CharacterItem[] }) {
  return (
    <section aria-label={title} className="space-y-2">
      <h3 className="flex items-baseline gap-2 text-sm font-semibold text-muted-foreground">
        {title} <span className="font-normal">{items.length}</span>
      </h3>
      <ul className="space-y-2">
        {items.map((i) => (
          <ItemRow key={i.id} item={i} />
        ))}
      </ul>
    </section>
  )
}

function ItemRow({ item }: { item: CharacterItem }) {
  const { character, sheet, canEdit, isDm } = useSheet()
  const update = useUpdateItem(character.id)
  const remove = useDeleteItem(character.id)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [transferring, setTransferring] = useState(false)
  const patch = (p: ItemInput) =>
    update.mutate({ itemId: item.id, patch: p }, { onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Změna se nepodařila.') })
  const attuneBlocked = !item.attuned && sheet.attunement.used >= sheet.attunement.max
  const needsAttunement = item.requiresAttunement && !item.attuned
  const stacked = item.quantity !== 1 || item.consumable
  const status = unusedArmor([item], sheet).length > 0
    ? 'nepočítá se do AC: bez toho máš AC stejné nebo lepší'
    : needsAttunement && (item.effects.length > 0 || item.armor?.magicBonus || item.weapon?.magicBonus)
      ? 'bonusy platí až po attunementu'
      : null

  return (
    <li className={cn('rounded-xl border bg-card', item.consumable && item.quantity < 1 && 'opacity-70')}>
      <div className="flex items-center gap-1 py-1 pl-1 pr-2">
        <button
          type="button"
          className="flex min-h-12 min-w-0 flex-1 items-center gap-2 rounded-lg px-2 text-left hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-ring"
          aria-expanded={open}
          aria-label={`Podrobnosti: ${item.name}`}
          onClick={() => setOpen((o) => !o)}
        >
          <ChevronRightIcon aria-hidden className={cn('size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')} />
          <span className="min-w-0">
            <span className="block truncate font-medium">
              {item.name}
              {stacked && <span className="ml-1 font-normal text-muted-foreground">×{item.quantity}</span>}
            </span>
            <span className="block text-xs text-muted-foreground">
              {[
                item.kind === 'other' ? null : ITEM_KIND_SHORT[item.kind],
                item.rarity,
                item.requiresAttunement ? (item.attuned ? 'attunovaný' : 'vyžaduje attunement') : null,
                item.curse ? (item.curse.revealed ? 'prokletý' : 'skrytá kletba (vidíš jen ty)') : null,
              ]
                .filter(Boolean)
                .join(' · ')}
              {status && (
                <span className="ml-1 font-medium text-amber-700 dark:text-amber-400" data-testid="not-worn">
                  · {status}
                </span>
              )}
            </span>
          </span>
        </button>
        {canEdit && (
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
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
            {item.consumable && (
              <Button disabled={item.quantity < 1 || update.isPending} onClick={() => patch({ quantity: item.quantity - 1 })} aria-label={`Použít ${item.name} (−1 ks)`}>
                {item.quantity < 1 ? 'Došlo' : 'Použít'}
              </Button>
            )}
          </div>
        )}
      </div>
      {hasCharges(item) && (
        <div className="border-t px-3 py-2">
          <ItemChargesControl item={item} />
        </div>
      )}
      {open && (
        <div className="space-y-3 border-t px-3 py-3 text-sm">
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
          {item.effects.length > 0 && (
            <ul aria-label="Efekty" className="space-y-1">
              {item.effects.map((e, i) => (
                <li key={i}>
                  <strong>{e.value > 0 ? `+${e.value}` : e.value}</strong> {effectLabel(e.target)}
                  {needsAttunement ? <span className="text-muted-foreground"> (neaktivní: chybí attunement)</span> : null}
                </li>
              ))}
            </ul>
          )}
          {item.curse && (
            <div className="space-y-2 rounded-lg border border-red-500/50 bg-red-500/5 p-3" data-testid="curse">
              <p className="flex items-center gap-1 font-semibold text-red-700 dark:text-red-400">
                <SkullIcon aria-hidden className="size-4" /> Kletba
                {isDm && !item.curse.revealed && <span className="text-xs font-normal">(skrytá, hráč ji nevidí)</span>}
              </p>
              <RichText text={item.curse.text} />
              {isDm && (
                <Button variant="outline" onClick={() => patch({ curseRevealed: !item.curse?.revealed })}>
                  {item.curse.revealed ? (
                    <>
                      <EyeOffIcon aria-hidden /> Skrýt před hráčem
                    </>
                  ) : (
                    <>
                      <EyeIcon aria-hidden /> Odhalit hráči
                    </>
                  )}
                </Button>
              )}
            </div>
          )}
          {item.description && <DescriptionText text={item.description} />}
          {item.notes && <NotesText text={item.notes} className="space-y-1 text-muted-foreground" />}
          {!item.description && !item.notes && !item.armor && !item.weapon && item.effects.length === 0 && !item.curse && (
            <p className="text-muted-foreground">Bez popisu.</p>
          )}
          {canEdit && (
            <div className="flex flex-wrap items-center gap-2 border-t pt-3">
              <div role="group" aria-label={`Množství: ${item.name}`} className="flex items-center gap-1">
                <Button variant="outline" size="icon" aria-label="−1 ks" disabled={item.quantity < 1 || update.isPending} onClick={() => patch({ quantity: item.quantity - 1 })}>
                  <MinusIcon aria-hidden />
                </Button>
                <span className="min-w-10 text-center font-semibold tabular-nums" aria-live="polite">
                  {item.quantity} ks
                </span>
                <Button variant="outline" size="icon" aria-label="+1 ks" disabled={update.isPending} onClick={() => patch({ quantity: item.quantity + 1 })}>
                  <PlusIcon aria-hidden />
                </Button>
              </div>
              <div className="ml-auto flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => setEditing(true)}>
                  <PencilIcon aria-hidden /> Upravit
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
            </div>
          )}
        </div>
      )}
      <Modal open={editing} onClose={() => setEditing(false)} title={`Upravit: ${item.name}`}>
        {editing && (
          <ItemForm
            item={item}
            dm={isDm}
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
  const { character, isDm } = useSheet()
  const add = useAddItem(character.id)

  return (
    <Modal open={open} onClose={onClose} title="Přidat item">
      <ItemSourcePicker
        campaignId={character.campaignId}
        dm={isDm}
        pending={add.isPending}
        pickLabel="Přidat"
        submitLabel="Přidat item"
        customTabLabel="Vlastní"
        note="Item mimo SRD se přidá jen s názvem, vzácností a cenou. Popis najdeš v příručce, případně si ho dopiš po přidání."
        onPick={(input, label) =>
          add.mutate(input, {
            onSuccess: () => {
              // z pravidel jde přidat víc věcí za sebou, vlastní item dialog zavře
              if (input.ruleId) toast.success(`Přidáno: ${label}`)
              else {
                toast.success('Item přidán')
                onClose()
              }
            },
            onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Přidání se nepodařilo.'),
          })
        }
      />
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
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
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
