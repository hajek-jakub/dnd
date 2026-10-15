import { useState, type FormEvent, type ReactNode } from 'react'
import { Link, Navigate, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeftIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { ApiError } from '@/lib/api'
import type { HomebrewKind, RuleDetail } from '@/lib/types'
import { useCreateHomebrew, useRule, useUpdateHomebrew, type HomebrewInput } from './api'
import { formatExtraDamage, parseExtraDamage } from '@/features/sheet/extra-damage'
import { RARITIES, capitalize, newWord } from './labels'
import { usePageTitle } from '@/lib/page-title'

const SCHOOLS = ['Abjuration', 'Conjuration', 'Divination', 'Enchantment', 'Evocation', 'Illusion', 'Necromancy', 'Transmutation']
const CLASSES = [
  'Barbarian',
  'Bard',
  'Cleric',
  'Druid',
  'Fighter',
  'Monk',
  'Paladin',
  'Ranger',
  'Rogue',
  'Sorcerer',
  'Warlock',
  'Wizard',
]
const ITEM_TYPES = ['Armor', 'Weapon', 'Wondrous item', 'Potion', 'Ring', 'Rod', 'Scroll', 'Staff', 'Wand']

const KIND_TITLES: Record<HomebrewKind, string> = {
  spell: 'kouzlo',
  magic_item: 'item',
  feature: 'featuru',
  subclass: 'subclassu',
  weapon: 'zbraň',
}

interface FormState {
  name: string
  description: string
  visibility: 'campaign' | 'private'
  // kouzlo
  level: string
  school: string
  castingTime: string
  range: string
  components: string
  material: string
  duration: string
  higherLevel: string
  classes: string
  ritual: boolean
  concentration: boolean
  // item
  itemType: string
  rarity: string
  attunement: boolean
  priceGp: string
  // featura / subclass
  category: string
  // zbraň
  damageDice: string
  damageType: string
  weaponCategory: 'simple' | 'martial'
  weaponRange: 'melee' | 'ranged'
  properties: string
  versatileDice: string
  weight: string
  magicBonus: string
  extraDamage: string
}

const EMPTY: FormState = {
  name: '',
  description: '',
  visibility: 'campaign',
  level: '',
  school: '',
  castingTime: '',
  range: '',
  components: '',
  material: '',
  duration: '',
  higherLevel: '',
  classes: '',
  ritual: false,
  concentration: false,
  itemType: '',
  rarity: '',
  attunement: false,
  priceGp: '',
  category: '',
  damageDice: '1d6',
  damageType: 'Bludgeoning',
  weaponCategory: 'simple',
  weaponRange: 'melee',
  properties: '',
  versatileDice: '',
  weight: '',
  magicBonus: '0',
  extraDamage: '',
}

function fromEntry(e: RuleDetail): FormState {
  const d = e.data
  const text = (v: unknown) => (typeof v === 'string' ? v : '')
  return {
    ...EMPTY,
    name: e.name,
    description: e.description,
    visibility: e.visibility ?? 'campaign',
    level: e.level === null ? '' : String(e.level),
    school: e.kind === 'spell' ? (e.category ?? '') : '',
    castingTime: text(d.casting_time),
    range: text(d.range),
    components: Array.isArray(d.components) ? d.components.join(', ') : text(d.components),
    material: text(d.material),
    duration: text(d.duration),
    higherLevel: text(d.higher_level),
    classes: Array.isArray(d.classes) ? d.classes.join(', ') : '',
    ritual: d.ritual === true,
    concentration: d.concentration === true,
    itemType: e.kind === 'magic_item' ? (e.category ?? '') : '',
    rarity: e.rarity ?? '',
    attunement: e.attunement === true,
    priceGp: e.priceGp === null ? '' : String(e.priceGp),
    category: e.kind === 'feature' || e.kind === 'subclass' ? (e.category ?? '') : '',
    ...(e.kind === 'weapon' ? weaponFromData(d) : {}),
  }
}

function weaponFromData(d: Record<string, unknown>): Partial<FormState> {
  const damage = d.damage as { dice?: string; type?: string } | undefined
  const two = d.two_handed_damage as { dice?: string } | null | undefined
  const extra = Array.isArray(d.extra_damage) ? (d.extra_damage as { dice: string; type: string }[]) : []
  return {
    damageDice: damage?.dice ?? '1d6',
    damageType: damage?.type ?? 'Bludgeoning',
    weaponCategory: String(d.weapon_category).toLowerCase() === 'martial' ? 'martial' : 'simple',
    weaponRange: String(d.weapon_range).toLowerCase() === 'ranged' ? 'ranged' : 'melee',
    properties: Array.isArray(d.properties) ? d.properties.join(', ') : '',
    versatileDice: two?.dice ?? '',
    weight: typeof d.weight === 'number' ? String(d.weight) : '',
    magicBonus: String(typeof d.magic_bonus === 'number' ? d.magic_bonus : 0),
    extraDamage: formatExtraDamage(extra),
  }
}

function toInput(kind: HomebrewKind, s: FormState, create: boolean): HomebrewInput {
  const input: HomebrewInput = { name: s.name.trim(), description: s.description, visibility: s.visibility }
  if (create) input.kind = kind
  switch (kind) {
    case 'spell':
      input.level = s.level === '' ? null : Number(s.level)
      input.school = s.school
      input.castingTime = s.castingTime
      input.range = s.range
      input.components = s.components
      input.material = s.material
      input.duration = s.duration
      input.higherLevel = s.higherLevel
      input.classes = s.classes
      input.ritual = s.ritual
      input.concentration = s.concentration
      break
    case 'magic_item':
      input.itemType = s.itemType
      input.rarity = s.rarity === '' ? null : s.rarity
      input.attunement = s.attunement
      input.priceGp = s.priceGp.trim() === '' ? null : Number(s.priceGp.replace(',', '.'))
      break
    case 'weapon':
      input.damageDice = s.damageDice.trim()
      input.damageType = s.damageType.trim()
      input.category = s.weaponCategory
      input.range = s.weaponRange
      input.properties = s.properties
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean)
      input.versatileDice = s.versatileDice.trim() === '' ? null : s.versatileDice.trim()
      if (s.weight.trim() !== '') input.weight = Number(s.weight.replace(',', '.'))
      input.magicBonus = Number.parseInt(s.magicBonus, 10) || 0
      input.extraDamage = parseExtraDamage(s.extraDamage)
      input.rarity = s.rarity === '' ? null : s.rarity
      input.attunement = s.attunement
      input.priceGp = s.priceGp.trim() === '' ? null : Number(s.priceGp.replace(',', '.'))
      break
    case 'feature':
      input.level = s.level === '' ? null : Number(s.level)
      input.category = s.category
      break
    case 'subclass':
      input.category = s.category
      break
  }
  return input
}

export function HomebrewFormPage() {
  usePageTitle('Homebrew')
  const { id } = useParams<{ id: string }>()
  return id ? <EditForm id={id} /> : <CreateForm />
}

function CreateForm() {
  const [params] = useSearchParams()
  const kind = params.get('kind') as HomebrewKind | null
  const campaignId = params.get('campaign')
  if (!kind || !(kind in KIND_TITLES) || !campaignId) return <Navigate to="/rules" replace />
  return <FormBody kind={kind} campaignId={campaignId} initial={EMPTY} />
}

function EditForm({ id }: { id: string }) {
  const { data: entry, isPending, error } = useRule(id)
  if (isPending) return <p className="text-muted-foreground">Načítám…</p>
  if (error || !entry || !entry.canEdit || !entry.campaignId || !(entry.kind in KIND_TITLES))
    return <Navigate to="/rules" replace />
  return <FormBody kind={entry.kind as HomebrewKind} campaignId={entry.campaignId} initial={fromEntry(entry)} entryId={id} />
}

function FormBody({
  kind,
  campaignId,
  initial,
  entryId,
}: {
  kind: HomebrewKind
  campaignId: string
  initial: FormState
  entryId?: string
}) {
  const navigate = useNavigate()
  const location = useLocation()
  const create = useCreateHomebrew(campaignId)
  const update = useUpdateHomebrew(entryId ?? '')
  const [s, setS] = useState<FormState>(initial)
  const [error, setError] = useState<{ message: string; field?: string } | null>(null)
  const pending = create.isPending || update.isPending

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setS((prev) => ({ ...prev, [key]: value }))
  const invalid = (field: string) => error?.field === field

  // Návrat zachová filtry seznamu (query bez parametrů formuláře).
  const back = (() => {
    const p = new URLSearchParams(location.search)
    p.delete('kind')
    return { pathname: entryId ? `/rules/${entryId}` : '/rules', search: p.toString() ? `?${p.toString()}` : '' }
  })()

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    const input = toInput(kind, s, !entryId)
    const onError = (e: Error) => {
      const apiError = e instanceof ApiError ? e : null
      setError({ message: apiError?.message ?? 'Uložení se nepodařilo.', field: apiError?.field })
    }
    if (entryId) {
      update.mutate(input, {
        onSuccess: (entry) => {
          toast.success('Uloženo')
          void navigate({ pathname: `/rules/${entry.id}`, search: back.search })
        },
        onError,
      })
    } else {
      create.mutate(input, {
        onSuccess: (entry) => {
          toast.success('Homebrew vytvořen')
          void navigate({ pathname: `/rules/${entry.id}`, search: back.search })
        },
        onError,
      })
    }
  }

  return (
    <Card>
      <CardHeader>
        <Link
          to={back}
          className="mb-2 inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeftIcon aria-hidden className="size-4" /> Zpět
        </Link>
        <CardTitle className="text-xl">
          {entryId ? 'Upravit' : newWord(kind)} {KIND_TITLES[kind]} (homebrew)
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <Field id="hb-name" label="Název" error={invalid('name')}>
            <Input
              id="hb-name"
              required
              maxLength={200}
              value={s.name}
              aria-invalid={invalid('name')}
              onChange={(e) => set('name', e.target.value)}
            />
          </Field>

          {kind === 'spell' && (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field id="hb-level" label="Úroveň" error={invalid('level')}>
                  <NativeSelect id="hb-level" required value={s.level} onChange={(e) => set('level', e.target.value)}>
                    <option value="">Vyber…</option>
                    {Array.from({ length: 10 }, (_, i) => (
                      <option key={i} value={i}>
                        {i === 0 ? 'Cantrip' : `Level ${i}`}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
                <Field id="hb-school" label="Škola">
                  <NativeSelect id="hb-school" value={s.school} onChange={(e) => set('school', e.target.value)}>
                    <option value="">Neurčeno</option>
                    {SCHOOLS.map((x) => (
                      <option key={x}>{x}</option>
                    ))}
                  </NativeSelect>
                </Field>
                <Field id="hb-casting" label="Doba seslání">
                  <Input
                    id="hb-casting"
                    maxLength={300}
                    placeholder="1 action"
                    value={s.castingTime}
                    onChange={(e) => set('castingTime', e.target.value)}
                  />
                </Field>
                <Field id="hb-range" label="Dosah">
                  <Input
                    id="hb-range"
                    maxLength={300}
                    placeholder="60 feet"
                    value={s.range}
                    onChange={(e) => set('range', e.target.value)}
                  />
                </Field>
                <Field id="hb-components" label="Komponenty">
                  <Input
                    id="hb-components"
                    maxLength={300}
                    placeholder="V, S, M"
                    value={s.components}
                    onChange={(e) => set('components', e.target.value)}
                  />
                </Field>
                <Field id="hb-duration" label="Trvání">
                  <Input
                    id="hb-duration"
                    maxLength={300}
                    placeholder="Instantaneous"
                    value={s.duration}
                    onChange={(e) => set('duration', e.target.value)}
                  />
                </Field>
              </div>
              <Field id="hb-material" label="Materiální komponenta">
                <Input id="hb-material" maxLength={300} value={s.material} onChange={(e) => set('material', e.target.value)} />
              </Field>
              <Field
                id="hb-classes"
                label="Třídy (oddělené čárkou)"
                hint="Podle nich půjde kouzlo filtrovat, např. Wizard, Sorcerer."
              >
                <Input id="hb-classes" maxLength={200} value={s.classes} onChange={(e) => set('classes', e.target.value)} />
              </Field>
              <div className="flex flex-wrap gap-x-6">
                <Check label="Koncentrace" checked={s.concentration} onChange={(v) => set('concentration', v)} />
                <Check label="Rituál" checked={s.ritual} onChange={(v) => set('ritual', v)} />
              </div>
            </>
          )}

          {kind === 'magic_item' && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="hb-type" label="Typ itemu">
                <Input
                  id="hb-type"
                  list="hb-types"
                  maxLength={60}
                  value={s.itemType}
                  onChange={(e) => set('itemType', e.target.value)}
                />
                <datalist id="hb-types">
                  {ITEM_TYPES.map((x) => (
                    <option key={x} value={x} />
                  ))}
                </datalist>
              </Field>
              <Field id="hb-rarity" label="Vzácnost" error={invalid('rarity')}>
                <NativeSelect id="hb-rarity" value={s.rarity} onChange={(e) => set('rarity', e.target.value)}>
                  <option value="">Neurčeno</option>
                  {RARITIES.map((r) => (
                    <option key={r} value={r}>
                      {capitalize(r)}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field id="hb-price" label="Cena (gp)" error={invalid('priceGp')}>
                <Input
                  id="hb-price"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="any"
                  value={s.priceGp}
                  onChange={(e) => set('priceGp', e.target.value)}
                />
              </Field>
              <div className="flex items-end">
                <Check label="Vyžaduje attunement" checked={s.attunement} onChange={(v) => set('attunement', v)} />
              </div>
            </div>
          )}

          {kind === 'weapon' && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="hb-dice" label="Kostka zranění" error={invalid('damageDice')}>
                <Input id="hb-dice" required value={s.damageDice} placeholder="1d6" onChange={(e) => set('damageDice', e.target.value)} />
              </Field>
              <Field id="hb-dtype" label="Typ zranění">
                <Input id="hb-dtype" required maxLength={30} value={s.damageType} placeholder="Piercing" onChange={(e) => set('damageType', e.target.value)} />
              </Field>
              <Field id="hb-wcat" label="Kategorie">
                <NativeSelect id="hb-wcat" value={s.weaponCategory} onChange={(e) => set('weaponCategory', e.target.value as 'simple' | 'martial')}>
                  <option value="simple">Simple</option>
                  <option value="martial">Martial</option>
                </NativeSelect>
              </Field>
              <Field id="hb-wrange" label="Dosah">
                <NativeSelect id="hb-wrange" value={s.weaponRange} onChange={(e) => set('weaponRange', e.target.value as 'melee' | 'ranged')}>
                  <option value="melee">Na blízko</option>
                  <option value="ranged">Na dálku</option>
                </NativeSelect>
              </Field>
              <Field id="hb-props" label="Vlastnosti (oddělené čárkou)" error={invalid('properties')}>
                <Input id="hb-props" value={s.properties} placeholder="Light, Finesse, Versatile" onChange={(e) => set('properties', e.target.value)} />
              </Field>
              <Field id="hb-versatile" label="Kostka oběma rukama (Versatile)" error={invalid('versatileDice')}>
                <Input id="hb-versatile" value={s.versatileDice} placeholder="1d8" onChange={(e) => set('versatileDice', e.target.value)} />
              </Field>
              <Field id="hb-weight" label="Váha (lb)" error={invalid('weight')}>
                <Input id="hb-weight" type="number" inputMode="decimal" min={0} step="any" value={s.weight} onChange={(e) => set('weight', e.target.value)} />
              </Field>
              <Field id="hb-magic" label="Magický bonus (k útoku i zranění)" error={invalid('magicBonus')}>
                <Input id="hb-magic" type="number" inputMode="numeric" min={0} max={5} value={s.magicBonus} onChange={(e) => set('magicBonus', e.target.value)} />
              </Field>
              <Field id="hb-extra" label="Doplňková zranění (např. 1d4 Fire)" error={invalid('extraDamage')}>
                <Input id="hb-extra" value={s.extraDamage} placeholder="1d4 Fire" onChange={(e) => set('extraDamage', e.target.value)} />
              </Field>
              <Field id="hb-rarity" label="Vzácnost" error={invalid('rarity')}>
                <NativeSelect id="hb-rarity" value={s.rarity} onChange={(e) => set('rarity', e.target.value)}>
                  <option value="">Neurčeno</option>
                  {RARITIES.map((r) => (
                    <option key={r} value={r}>
                      {capitalize(r)}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field id="hb-wprice" label="Cena (gp)" error={invalid('priceGp')}>
                <Input id="hb-wprice" type="number" inputMode="decimal" min={0} step="any" value={s.priceGp} onChange={(e) => set('priceGp', e.target.value)} />
              </Field>
              <div className="flex items-end sm:col-span-2">
                <Check label="Vyžaduje attunement" checked={s.attunement} onChange={(v) => set('attunement', v)} />
              </div>
            </div>
          )}

          {kind === 'feature' && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="hb-category" label="Třída nebo zdroj" error={invalid('category')}>
                <Input id="hb-category" maxLength={60} value={s.category} onChange={(e) => set('category', e.target.value)} />
              </Field>
              <Field id="hb-flevel" label="Level" error={invalid('level')}>
                <NativeSelect id="hb-flevel" value={s.level} onChange={(e) => set('level', e.target.value)}>
                  <option value="">Neurčeno</option>
                  {Array.from({ length: 20 }, (_, i) => (
                    <option key={i + 1} value={i + 1}>
                      Level {i + 1}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            </div>
          )}

          {kind === 'subclass' && (
            <Field id="hb-parent" label="Mateřská třída" error={invalid('category')}>
              <NativeSelect id="hb-parent" required value={s.category} onChange={(e) => set('category', e.target.value)}>
                <option value="">Vyber…</option>
                {CLASSES.map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </NativeSelect>
            </Field>
          )}

          <Field id="hb-desc" label="Popis" error={invalid('description')}>
            <Textarea
              id="hb-desc"
              rows={8}
              maxLength={20000}
              value={s.description}
              onChange={(e) => set('description', e.target.value)}
            />
          </Field>
          {kind === 'spell' && (
            <Field id="hb-higher" label="Na vyšší úrovni">
              <Textarea
                id="hb-higher"
                rows={3}
                maxLength={5000}
                className="min-h-20"
                value={s.higherLevel}
                onChange={(e) => set('higherLevel', e.target.value)}
              />
            </Field>
          )}

          <Field id="hb-visibility" label="Kdo to uvidí">
            <NativeSelect
              id="hb-visibility"
              value={s.visibility}
              onChange={(e) => set('visibility', e.target.value as 'campaign' | 'private')}
            >
              <option value="campaign">Všichni v kampani</option>
              <option value="private">Jen já a DM</option>
            </NativeSelect>
          </Field>

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error.message}
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="lg" disabled={pending || !s.name.trim()}>
              {pending ? 'Ukládám…' : 'Uložit'}
            </Button>
            <Link to={back} className={buttonVariants({ variant: 'outline', size: 'lg' })}>
              Zrušit
            </Link>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string
  label: string
  hint?: string
  error?: boolean
  children: ReactNode
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id} className={error ? 'text-destructive' : undefined}>
        {label}
      </Label>
      {children}
      {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
    </div>
  )
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex min-h-11 cursor-pointer items-center gap-3">
      <input type="checkbox" className="size-5 accent-primary" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  )
}
