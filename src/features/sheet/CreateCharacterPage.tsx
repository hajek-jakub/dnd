import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeftIcon, DicesIcon } from 'lucide-react'
import { toast } from 'sonner'
import { ABILITIES, SKILLS, abilityModifier, computeSheet, formatModifier, initialState, type AbilityKey, type SkillKey } from '@/engine'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { FullPageSpinner } from '@/components/FullPageSpinner'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { ApiError } from '@/lib/api'
import { useRules } from '@/features/rules/api'
import { useCampaign } from '@/features/campaigns/api'
import { useCreateCharacter, useEngineBundle } from './api'
import { toEngineInput } from './model'
import { ABILITY_LABELS, ALIGNMENTS, SKILL_LABELS } from './labels'
import type { CharacterFull } from './types'
import { usePageTitle } from '@/lib/page-title'

const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8]
/** Level třídy, na kterém se vybírá subclass (stejná tabulka jako na serveru). */
const SUBCLASS_LEVEL: Record<string, number> = { cleric: 1, sorcerer: 1, warlock: 1, druid: 2, wizard: 2 }

function roll4d6DropLowest(): number {
  const dice = Array.from({ length: 4 }, () => {
    const b = new Uint32Array(1)
    crypto.getRandomValues(b)
    return ((b[0] ?? 0) % 6) + 1
  })
  return dice
    .sort((a, b) => a - b)
    .slice(1)
    .reduce((a, b) => a + b, 0)
}

export function CreateCharacterPage() {
  const { campaignId = '' } = useParams<{ campaignId: string }>()
  const navigate = useNavigate()
  // /characters/new?npc=1: DM zakládá NPC (postavu bez majitele, za kterou hraje on)
  const npc = useSearchParams()[0].get('npc') === '1'
  const { data: campaign, isPending } = useCampaign(campaignId)
  usePageTitle(npc ? 'Nové NPC' : 'Nová postava', campaign?.name)
  const { data: bundle, isPending: bundlePending } = useEngineBundle()
  const { data: races } = useRules({ kinds: ['race'] })
  const create = useCreateCharacter(campaignId)

  const [name, setName] = useState('')
  const [race, setRace] = useState('')
  const [background, setBackground] = useState('')
  const [alignment, setAlignment] = useState('')
  const [classIndex, setClassIndex] = useState('fighter')
  const [level, setLevel] = useState(1)
  const [subclass, setSubclass] = useState('')
  const [speed, setSpeed] = useState('30')
  const [scores, setScores] = useState<Record<AbilityKey, number>>({ str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 })
  const [skills, setSkills] = useState<Set<SkillKey>>(new Set())
  const [error, setError] = useState<string | null>(null)

  if (isPending || bundlePending) return <FullPageSpinner />
  if (!campaign || !bundle) return <Navigate to="/" replace />

  const classes = Object.values(bundle.classes).sort((a, b) => a.name.localeCompare(b.name))
  const cls = bundle.classes[classIndex]
  const subclassLevel = SUBCLASS_LEVEL[classIndex] ?? 3
  const subclassOptions = cls?.subclasses ?? []
  const raceNames = races?.pages.flatMap((p) => p.entries.map((e) => e.name)) ?? []

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    if (!bundle) return
    const levels = Array.from({ length: level }, () => ({ classIndex, hpRoll: null }))
    const subclasses = subclass && level >= subclassLevel ? { [classIndex]: subclass } : {}
    const skillProficiencies = Object.fromEntries([...skills].map((s) => [s, 1 as const]))
    // Počáteční HP = maximum podle pravidel (první level plná kostka, další průměr).
    const preview = computeSheet(
      toEngineInput({
        abilityScores: scores,
        levels: levels.map((l) => ({ ...l, choices: {} })),
        subclasses,
        baseSpeed: 30,
        skillProficiencies,
        extraSaveProficiencies: [],
        extraProficiencies: [],
        overrides: {},
        customResources: [],
        state: initialState(1),
      } as unknown as CharacterFull),
      bundle,
    )
    create.mutate(
      {
        ...(npc ? { kind: 'npc' as const } : {}),
        name: name.trim(),
        race: race.trim(),
        background: background.trim(),
        alignment,
        abilityScores: scores,
        baseSpeed: Number.parseInt(speed, 10) || 30,
        levels,
        subclasses,
        skillProficiencies,
        state: { hpCurrent: preview.hp.max.value },
      },
      {
        onSuccess: (c) => {
          toast.success(npc ? 'NPC vytvořeno. Fotku můžeš nahrát na záložce Postava.' : 'Postava vytvořena. Fotku můžeš nahrát na záložce Postava.')
          void navigate(`/characters/${c.id}`)
        },
        onError: (e) => setError(e instanceof ApiError ? e.message : 'Postavu se nepodařilo vytvořit.'),
      },
    )
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Link to={`/campaigns/${campaignId}`} className="inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeftIcon aria-hidden className="size-4" /> {campaign.name}
      </Link>
      <h1 className="text-2xl font-bold">{npc ? 'Nové NPC' : 'Nová postava'}</h1>
      {npc && <p className="text-sm text-muted-foreground">NPC nepatří žádnému hráči ani tobě, hraješ za něj ty. Hráči ho vidí v kampani a můžou mu předat peníze.</p>}

      <form onSubmit={onSubmit} className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Základ</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field id="c-name" label="Jméno postavy">
              <Input id="c-name" required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="c-race" label="Rasa">
                <Input id="c-race" list="c-races" maxLength={100} value={race} onChange={(e) => setRace(e.target.value)} />
                <datalist id="c-races">
                  {raceNames.map((r) => (
                    <option key={r} value={r} />
                  ))}
                </datalist>
              </Field>
              <Field id="c-bg" label="Background">
                <Input id="c-bg" list="c-bgs" maxLength={100} value={background} onChange={(e) => setBackground(e.target.value)} />
                <datalist id="c-bgs">
                  <option value="Acolyte" />
                  <option value="Charlatan" />
                  <option value="Criminal" />
                  <option value="Entertainer" />
                  <option value="Folk Hero" />
                  <option value="Guild Artisan" />
                  <option value="Hermit" />
                  <option value="Noble" />
                  <option value="Outlander" />
                  <option value="Sage" />
                  <option value="Sailor" />
                  <option value="Soldier" />
                  <option value="Urchin" />
                </datalist>
              </Field>
              <Field id="c-align" label="Alignment">
                <NativeSelect id="c-align" value={alignment} onChange={(e) => setAlignment(e.target.value)}>
                  <option value="">Neurčeno</option>
                  {ALIGNMENTS.map((a) => (
                    <option key={a}>{a}</option>
                  ))}
                </NativeSelect>
              </Field>
              <Field id="c-speed" label="Základní rychlost (ft)">
                <Input id="c-speed" type="number" inputMode="numeric" min={0} max={200} value={speed} onChange={(e) => setSpeed(e.target.value)} />
              </Field>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Třída</CardTitle>
            <p className="text-sm text-muted-foreground">
              Další levely a multiclass přidáš později průvodcem level upu. Zde zvol třídu a aktuální level.
            </p>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-3">
            <Field id="c-class" label="Třída">
              <NativeSelect
                id="c-class"
                value={classIndex}
                onChange={(e) => {
                  setClassIndex(e.target.value)
                  setSubclass('')
                }}
              >
                {classes.map((c) => (
                  <option key={c.index} value={c.index}>
                    {c.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field id="c-level" label="Level">
              <NativeSelect id="c-level" value={level} onChange={(e) => setLevel(Number(e.target.value))}>
                {Array.from({ length: 20 }, (_, i) => (
                  <option key={i + 1} value={i + 1}>
                    {i + 1}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            {level >= subclassLevel && subclassOptions.length > 0 && (
              <Field id="c-sub" label="Subclass">
                <NativeSelect id="c-sub" value={subclass} onChange={(e) => setSubclass(e.target.value)}>
                  <option value="">Zatím nevybráno</option>
                  {subclassOptions.map((s) => (
                    <option key={s.index} value={s.index}>
                      {s.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Vlastnosti</CardTitle>
            <p className="text-sm text-muted-foreground">Zadej hodnoty včetně rasových bonusů.</p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setScores(Object.fromEntries(ABILITIES.map((a, i) => [a, STANDARD_ARRAY[i] ?? 10])) as Record<AbilityKey, number>)}
              >
                Standardní sada
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setScores(Object.fromEntries(ABILITIES.map((a) => [a, roll4d6DropLowest()])) as Record<AbilityKey, number>)}
              >
                <DicesIcon aria-hidden /> Hodit 4d6
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {ABILITIES.map((a) => (
                <div key={a} className="space-y-1">
                  <Label htmlFor={`c-${a}`}>
                    {ABILITY_LABELS[a]} <span className="text-muted-foreground">({formatModifier(abilityModifier(scores[a]))})</span>
                  </Label>
                  <Input
                    id={`c-${a}`}
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={30}
                    required
                    value={scores[a]}
                    onChange={(e) => setScores((s) => ({ ...s, [a]: Number.parseInt(e.target.value, 10) || 1 }))}
                  />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Dovednosti s proficiency</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-x-4 sm:grid-cols-2">
              {SKILLS.map((s) => (
                <li key={s.key}>
                  <label className="flex min-h-11 cursor-pointer items-center gap-3">
                    <input
                      type="checkbox"
                      className="size-5 accent-primary"
                      checked={skills.has(s.key)}
                      onChange={(e) =>
                        setSkills((prev) => {
                          const next = new Set(prev)
                          if (e.target.checked) next.add(s.key)
                          else next.delete(s.key)
                          return next
                        })
                      }
                    />
                    <span>
                      {SKILL_LABELS[s.key]} <span className="text-xs text-muted-foreground uppercase">{s.ability}</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" size="lg" disabled={create.isPending || !name.trim()}>
            {create.isPending ? 'Vytvářím…' : npc ? 'Vytvořit NPC' : 'Vytvořit postavu'}
          </Button>
          <Link to={`/campaigns/${campaignId}`} className={buttonVariants({ variant: 'outline', size: 'lg' })}>
            Zrušit
          </Link>
        </div>
      </form>
    </div>
  )
}

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  )
}
