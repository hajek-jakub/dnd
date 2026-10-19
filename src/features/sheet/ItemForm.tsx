import { useState, type FormEvent } from 'react'
import { PlusIcon, Trash2Icon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { FormattingTextarea } from '@/components/FormattingTextarea'
import { DescriptionText } from '@/features/rules/DescriptionText'
import { RARITIES, capitalize } from '@/features/rules/labels'
import type { ItemInput } from './api'
import { EFFECT_TARGETS } from './effects'
import { formatExtraDamage, parseExtraDamage } from './extra-damage'
import type { ItemFormValues } from './item-form-values'
import { ITEM_KINDS } from './labels'
import type { CharacterItem, ItemEffect } from './types'

interface FormState {
  name: string
  kind: CharacterItem['kind']
  quantity: string
  requiresAttunement: boolean
  consumable: boolean
  chargesMax: string
  chargesRecharge: string
  rarity: string
  description: string
  notes: string
  curse: string
  curseRevealed: boolean
  armorBase: string
  armorDex: boolean
  armorMaxDex: string
  armorMagic: string
  armorStealth: boolean
  armorStr: string
  weaponDice: string
  weaponType: string
  weaponCategory: 'simple' | 'martial'
  weaponRange: 'melee' | 'ranged'
  weaponProps: string
  weaponMagic: string
  weaponExtra: string
  effects: ItemEffect[]
}

/** Výchozí základ: zbroj 11 (Leather), štít +2. */
const DEFAULT_BASE = { armor: '11', shield: '2' } as const

function initial(item?: ItemFormValues): FormState {
  return {
    name: item?.name ?? '',
    kind: item?.kind ?? 'other',
    quantity: String(item?.quantity ?? 1),
    requiresAttunement: item?.requiresAttunement ?? false,
    consumable: item?.consumable ?? false,
    chargesMax: item?.charges ? String(item.charges.max) : '',
    chargesRecharge: item?.charges?.recharge ?? '',
    rarity: item?.rarity ?? '',
    description: item?.description ?? '',
    notes: item?.notes ?? '',
    curse: item?.curse?.text ?? '',
    curseRevealed: item?.curse?.revealed ?? false,
    armorBase: item?.armor ? String(item.armor.base) : item?.kind === 'shield' ? DEFAULT_BASE.shield : DEFAULT_BASE.armor,
    armorDex: item?.armor?.dexBonus ?? true,
    armorMaxDex: item?.armor?.maxDexBonus === null || item?.armor?.maxDexBonus === undefined ? '' : String(item.armor.maxDexBonus),
    armorMagic: String(item?.armor?.magicBonus ?? 0),
    armorStealth: item?.armor?.stealthDisadvantage ?? false,
    armorStr: String(item?.armor?.strMinimum ?? 0),
    weaponDice: item?.weapon?.damageDice ?? '1d6',
    weaponType: item?.weapon?.damageType ?? 'Slashing',
    weaponCategory: item?.weapon?.category ?? 'simple',
    weaponRange: item?.weapon?.range ?? 'melee',
    weaponProps: item?.weapon?.properties.join(', ') ?? '',
    weaponMagic: String(item?.weapon?.magicBonus ?? 0),
    weaponExtra: formatExtraDamage(item?.weapon?.extraDamage ?? []),
    effects: item?.effects ?? [],
  }
}

/** Formulář vlastního itemu (nový i úprava). */
export function ItemForm({
  item,
  onSubmit,
  pending,
  submitLabel,
  dm = false,
}: {
  item?: ItemFormValues
  onSubmit: (input: ItemInput) => void
  pending: boolean
  submitLabel: string
  /** DM smí na itemu nastavit kletbu a odhalit ji hráči. */
  dm?: boolean
}) {
  const [s, setS] = useState<FormState>(() => initial(item))
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setS((p) => ({ ...p, [k]: v }))
  // Při přepnutí zbroj <-> štít se nezměněný výchozí základ přepne taky (štít není AC 11).
  const setKind = (kind: FormState['kind']) =>
    setS((p) => ({
      ...p,
      kind,
      armorBase:
        kind === 'shield' && p.armorBase === DEFAULT_BASE.armor ? DEFAULT_BASE.shield : kind === 'armor' && p.armorBase === DEFAULT_BASE.shield ? DEFAULT_BASE.armor : p.armorBase,
    }))

  function submit(e: FormEvent) {
    e.preventDefault()
    const chargesMax = Number.parseInt(s.chargesMax, 10) || 0
    const input: ItemInput = {
      name: s.name.trim(),
      kind: s.kind,
      quantity: Number.isFinite(Number.parseInt(s.quantity, 10)) ? Math.max(0, Number.parseInt(s.quantity, 10)) : 1,
      requiresAttunement: s.requiresAttunement,
      consumable: s.consumable,
      charges: chargesMax > 0 ? { max: Math.min(100, chargesMax), recharge: s.chargesRecharge.trim() === '' ? null : s.chargesRecharge.trim() } : null,
      rarity: s.rarity === '' ? null : s.rarity,
      description: s.description,
      notes: s.notes,
      effects: s.effects.filter((x) => x.value !== 0).map((x) => ({ ...x, source: x.source || s.name.trim() })),
    }
    if (dm) {
      input.curse = s.curse.trim() === '' ? null : s.curse
      input.curseRevealed = s.curse.trim() !== '' && s.curseRevealed
    }
    if (s.kind === 'armor' || s.kind === 'shield') {
      const armor = s.kind === 'armor'
      input.armor = {
        base: Number.parseInt(s.armorBase, 10) || 0,
        dexBonus: armor && s.armorDex,
        maxDexBonus: !armor || s.armorMaxDex.trim() === '' ? null : Number.parseInt(s.armorMaxDex, 10),
        magicBonus: Number.parseInt(s.armorMagic, 10) || 0,
        stealthDisadvantage: armor && s.armorStealth,
        strMinimum: armor ? Math.max(0, Number.parseInt(s.armorStr, 10) || 0) : 0,
      }
      input.weapon = null
    } else if (s.kind === 'weapon') {
      input.weapon = {
        damageDice: s.weaponDice.trim(),
        damageType: s.weaponType.trim() || 'Slashing',
        category: s.weaponCategory,
        range: s.weaponRange,
        properties: s.weaponProps
          .split(',')
          .map((p) => p.trim())
          .filter(Boolean),
        magicBonus: Number.parseInt(s.weaponMagic, 10) || 0,
        extraDamage: parseExtraDamage(s.weaponExtra),
      }
      input.armor = null
    } else {
      input.armor = null
      input.weapon = null
    }
    onSubmit(input)
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="it-name">Název</Label>
        <Input id="it-name" required maxLength={200} value={s.name} onChange={(e) => set('name', e.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="it-kind">Druh</Label>
          <NativeSelect id="it-kind" value={s.kind} onChange={(e) => setKind(e.target.value as FormState['kind'])}>
            {ITEM_KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-2">
          <Label htmlFor="it-rarity">Vzácnost</Label>
          <NativeSelect id="it-rarity" value={s.rarity} onChange={(e) => set('rarity', e.target.value)}>
            <option value="">Neurčeno</option>
            {RARITIES.map((r) => (
              <option key={r} value={r}>
                {capitalize(r)}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-2">
          <Label htmlFor="it-qty">Množství</Label>
          <Input
            id="it-qty"
            type="number"
            inputMode="numeric"
            min={1}
            max={9999}
            value={s.quantity}
            onChange={(e) => set('quantity', e.target.value)}
          />
        </div>
      </div>
      <label className="flex min-h-11 cursor-pointer items-center gap-3">
        <input
          type="checkbox"
          className="size-5 accent-primary"
          checked={s.requiresAttunement}
          onChange={(e) => set('requiresAttunement', e.target.checked)}
        />
        <span>Vyžaduje attunement</span>
      </label>
      <label className="flex min-h-11 cursor-pointer items-center gap-3">
        <input type="checkbox" className="size-5 accent-primary" checked={s.consumable} onChange={(e) => set('consumable', e.target.checked)} />
        <span>Spotřebuje se používáním (šípy, šipky, lektvary, svitky)</span>
      </label>
      <fieldset className="space-y-2 rounded-lg border p-3">
        <legend className="px-1 text-sm font-medium">Náboje (hůlky, hole, prsteny)</legend>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="it-charges">Počet nábojů</Label>
            <Input
              id="it-charges"
              type="number"
              inputMode="numeric"
              min={0}
              max={100}
              placeholder="bez nábojů"
              value={s.chargesMax}
              onChange={(e) => set('chargesMax', e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="it-recharge">Obnova (za úsvitu)</Label>
            <Input
              id="it-recharge"
              maxLength={40}
              placeholder="1d6+1, 3 nebo all"
              disabled={!(Number.parseInt(s.chargesMax, 10) > 0)}
              value={s.chargesRecharge}
              onChange={(e) => set('chargesRecharge', e.target.value)}
            />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">Kostky, číslo, nebo „all“ (všechny). Prázdná obnova: náboje se vrací jen ručně.</p>
      </fieldset>

      {(s.kind === 'armor' || s.kind === 'shield') && (
        <fieldset className="space-y-3 rounded-lg border p-3">
          <legend className="px-1 text-sm font-medium">{s.kind === 'armor' ? 'Zbroj' : 'Štít'}</legend>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="it-ab">{s.kind === 'armor' ? 'Základní AC' : 'Bonus k AC'}</Label>
              <Input
                id="it-ab"
                type="number"
                inputMode="numeric"
                min={0}
                max={30}
                value={s.armorBase}
                onChange={(e) => set('armorBase', e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="it-am">Magický bonus</Label>
              <Input
                id="it-am"
                type="number"
                inputMode="numeric"
                min={-5}
                max={5}
                value={s.armorMagic}
                onChange={(e) => set('armorMagic', e.target.value)}
              />
            </div>
            {s.kind === 'armor' && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="it-ad">Limit DEX (prázdné = bez limitu)</Label>
                  <Input
                    id="it-ad"
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={10}
                    value={s.armorMaxDex}
                    onChange={(e) => set('armorMaxDex', e.target.value)}
                  />
                </div>
                <label className="flex min-h-11 cursor-pointer items-center gap-3 self-end">
                  <input type="checkbox" className="size-5 accent-primary" checked={s.armorDex} onChange={(e) => set('armorDex', e.target.checked)} />
                  <span>Přičítá DEX</span>
                </label>
                <div className="space-y-2">
                  <Label htmlFor="it-as">Minimální STR (0 = žádná)</Label>
                  <Input
                    id="it-as"
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={30}
                    value={s.armorStr}
                    onChange={(e) => set('armorStr', e.target.value)}
                  />
                </div>
                <label className="flex min-h-11 cursor-pointer items-center gap-3 self-end">
                  <input type="checkbox" className="size-5 accent-primary" checked={s.armorStealth} onChange={(e) => set('armorStealth', e.target.checked)} />
                  <span>Nevýhoda na Stealth</span>
                </label>
              </>
            )}
          </div>
        </fieldset>
      )}

      {s.kind === 'weapon' && (
        <fieldset className="space-y-3 rounded-lg border p-3">
          <legend className="px-1 text-sm font-medium">Zbraň</legend>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="it-wd">Kostka zranění</Label>
              <Input id="it-wd" value={s.weaponDice} onChange={(e) => set('weaponDice', e.target.value)} placeholder="1d8" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="it-wt">Typ zranění</Label>
              <Input id="it-wt" value={s.weaponType} onChange={(e) => set('weaponType', e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="it-wc">Kategorie</Label>
              <NativeSelect id="it-wc" value={s.weaponCategory} onChange={(e) => set('weaponCategory', e.target.value as 'simple' | 'martial')}>
                <option value="simple">Simple</option>
                <option value="martial">Martial</option>
              </NativeSelect>
            </div>
            <div className="space-y-2">
              <Label htmlFor="it-wr">Dosah</Label>
              <NativeSelect id="it-wr" value={s.weaponRange} onChange={(e) => set('weaponRange', e.target.value as 'melee' | 'ranged')}>
                <option value="melee">Na blízko</option>
                <option value="ranged">Na dálku</option>
              </NativeSelect>
            </div>
            <div className="space-y-2">
              <Label htmlFor="it-wm">Magický bonus</Label>
              <Input
                id="it-wm"
                type="number"
                inputMode="numeric"
                min={0}
                max={5}
                value={s.weaponMagic}
                onChange={(e) => set('weaponMagic', e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="it-wp">Vlastnosti (oddělené čárkou)</Label>
            <Input id="it-wp" value={s.weaponProps} onChange={(e) => set('weaponProps', e.target.value)} placeholder="Finesse, Light" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="it-wx">Doplňková zranění (např. 1d4 Fire)</Label>
            <Input id="it-wx" value={s.weaponExtra} onChange={(e) => set('weaponExtra', e.target.value)} placeholder="1d4 Fire" />
          </div>
        </fieldset>
      )}

      <fieldset className="space-y-2 rounded-lg border p-3">
        <legend className="px-1 text-sm font-medium">Efekty (bonusy při nošení)</legend>
        {s.effects.map((e, i) => (
          <div key={i} className="flex items-center gap-2">
            <NativeSelect
              aria-label={`Efekt ${i + 1}: cíl`}
              value={e.target}
              onChange={(ev) =>
                set(
                  'effects',
                  s.effects.map((x, j) => (j === i ? { ...x, target: ev.target.value } : x)),
                )
              }
            >
              {EFFECT_TARGETS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </NativeSelect>
            <Input
              aria-label={`Efekt ${i + 1}: hodnota`}
              type="number"
              inputMode="numeric"
              className="w-20 shrink-0"
              value={e.value}
              onChange={(ev) =>
                set(
                  'effects',
                  s.effects.map((x, j) => (j === i ? { ...x, value: Number.parseInt(ev.target.value, 10) || 0 } : x)),
                )
              }
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Odebrat efekt ${i + 1}`}
              onClick={() =>
                set(
                  'effects',
                  s.effects.filter((_, j) => j !== i),
                )
              }
            >
              <Trash2Icon aria-hidden />
            </Button>
          </div>
        ))}
        <Button type="button" variant="outline" onClick={() => set('effects', [...s.effects, { target: 'ac', value: 1, source: '' }])}>
          <PlusIcon aria-hidden /> Přidat efekt
        </Button>
        <p className="text-xs text-muted-foreground">Efekty se započítají jen, když je item nošený (a u itemů s attunementem i attunovaný).</p>
      </fieldset>

      <div className="space-y-2">
        <Label htmlFor="it-desc">Popis</Label>
        <p className="text-xs text-muted-foreground">Názvy schopností můžeš psát tučně (tlačítko B), Náhled ukáže výsledek.</p>
        <FormattingTextarea
          id="it-desc"
          rows={5}
          maxLength={20000}
          value={s.description}
          onChange={(v) => set('description', v)}
          placeholder="**Ďábelský šepot**: popis schopnosti…"
          renderPreview={(text) => <DescriptionText text={text} />}
        />
      </div>
      {dm && (
        <fieldset className="space-y-2 rounded-lg border border-red-500/40 bg-red-500/5 p-3">
          <legend className="px-1 text-sm font-medium">Kletba (vidíš jen ty)</legend>
          <FormattingTextarea
            id="it-curse"
            label="Text kletby"
            rows={3}
            maxLength={5000}
            value={s.curse}
            onChange={(v) => set('curse', v)}
            placeholder="Co kletba dělá. Hráč ji neuvidí, dokud ji neodhalíš."
          />
          <label className="flex min-h-11 cursor-pointer items-center gap-3">
            <input
              type="checkbox"
              className="size-5 accent-primary"
              checked={s.curseRevealed}
              disabled={s.curse.trim() === ''}
              onChange={(e) => set('curseRevealed', e.target.checked)}
            />
            <span>Kletba je odhalená (hráč ji vidí)</span>
          </label>
        </fieldset>
      )}
      <div className="space-y-2">
        <Label htmlFor="it-notes">Poznámky</Label>
        <Textarea id="it-notes" rows={2} className="min-h-16" maxLength={5000} value={s.notes} onChange={(e) => set('notes', e.target.value)} />
      </div>
      <Button type="submit" size="lg" className="w-full" disabled={pending || !s.name.trim()}>
        {pending ? 'Ukládám…' : submitLabel}
      </Button>
    </form>
  )
}
