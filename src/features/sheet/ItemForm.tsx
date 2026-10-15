import { useState, type FormEvent } from 'react'
import { PlusIcon, Trash2Icon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { RARITIES, capitalize } from '@/features/rules/labels'
import type { ItemInput } from './api'
import { EFFECT_TARGETS } from './effects'
import { formatExtraDamage, parseExtraDamage } from './extra-damage'
import type { CharacterItem, ItemEffect } from './types'

interface FormState {
  name: string
  kind: CharacterItem['kind']
  quantity: string
  weight: string
  requiresAttunement: boolean
  consumable: boolean
  rarity: string
  description: string
  notes: string
  armorBase: string
  armorDex: boolean
  armorMaxDex: string
  armorMagic: string
  weaponDice: string
  weaponType: string
  weaponCategory: 'simple' | 'martial'
  weaponRange: 'melee' | 'ranged'
  weaponProps: string
  weaponMagic: string
  weaponExtra: string
  effects: ItemEffect[]
}

function initial(item?: CharacterItem): FormState {
  return {
    name: item?.name ?? '',
    kind: item?.kind ?? 'item',
    quantity: String(item?.quantity ?? 1),
    weight: String(item?.weight ?? 0),
    requiresAttunement: item?.requiresAttunement ?? false,
    consumable: item?.consumable ?? false,
    rarity: item?.rarity ?? '',
    description: item?.description ?? '',
    notes: item?.notes ?? '',
    armorBase: String(item?.armor?.base ?? 11),
    armorDex: item?.armor?.dexBonus ?? true,
    armorMaxDex: item?.armor?.maxDexBonus === null || item?.armor?.maxDexBonus === undefined ? '' : String(item.armor.maxDexBonus),
    armorMagic: String(item?.armor?.magicBonus ?? 0),
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
}: {
  item?: CharacterItem
  onSubmit: (input: ItemInput) => void
  pending: boolean
  submitLabel: string
}) {
  const [s, setS] = useState<FormState>(() => initial(item))
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setS((p) => ({ ...p, [k]: v }))

  function submit(e: FormEvent) {
    e.preventDefault()
    const input: ItemInput = {
      name: s.name.trim(),
      kind: s.kind,
      quantity: Number.isFinite(Number.parseInt(s.quantity, 10)) ? Math.max(0, Number.parseInt(s.quantity, 10)) : 1,
      weight: Math.max(0, Number(s.weight.replace(',', '.')) || 0),
      requiresAttunement: s.requiresAttunement,
      consumable: s.consumable,
      rarity: s.rarity === '' ? null : s.rarity,
      description: s.description,
      notes: s.notes,
      effects: s.effects.filter((x) => x.value !== 0).map((x) => ({ ...x, source: x.source || s.name.trim() })),
    }
    if (s.kind === 'armor' || s.kind === 'shield') {
      input.armor = {
        base: Number.parseInt(s.armorBase, 10) || 0,
        dexBonus: s.kind === 'armor' && s.armorDex,
        maxDexBonus: s.armorMaxDex.trim() === '' ? null : Number.parseInt(s.armorMaxDex, 10),
        magicBonus: Number.parseInt(s.armorMagic, 10) || 0,
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
          <NativeSelect id="it-kind" value={s.kind} onChange={(e) => set('kind', e.target.value as FormState['kind'])}>
            <option value="item">Vybavení / item</option>
            <option value="weapon">Zbraň</option>
            <option value="armor">Zbroj</option>
            <option value="shield">Štít</option>
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
        <div className="space-y-2">
          <Label htmlFor="it-weight">Váha jednoho kusu (lb)</Label>
          <Input
            id="it-weight"
            type="number"
            inputMode="decimal"
            min={0}
            step="any"
            value={s.weight}
            onChange={(e) => set('weight', e.target.value)}
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
        <Textarea id="it-desc" rows={4} maxLength={20000} value={s.description} onChange={(e) => set('description', e.target.value)} />
      </div>
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
