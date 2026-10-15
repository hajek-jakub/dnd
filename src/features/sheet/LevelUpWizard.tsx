import { useMemo, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeftIcon, DicesIcon } from 'lucide-react'
import { toast } from 'sonner'
import {
  ABILITIES,
  averageRoll,
  computeSheet,
  formatModifier,
  groupClasses,
  hasAbilityScoreImprovement,
  hpGainForLevel,
  multiclassProblems,
  newSpellAllowance,
  type AbilityKey,
  type RulesBundle,
} from '@/engine'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { FullPageSpinner } from '@/components/FullPageSpinner'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { useCampaign } from '@/features/campaigns/api'
import { engineRulesOf } from '@/features/campaigns/ruleset'
import { DescriptionText } from '@/features/rules/DescriptionText'
import { useRules } from '@/features/rules/api'
import { ApiError } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useCharacter, useClassFeatures, useEngineBundle, useLevelUp, type LevelUpInput } from './api'
import { ABILITY_LABELS } from './labels'
import { toEngineInput } from './model'
import type { CharacterFull } from './types'

const SUBCLASS_LEVEL: Record<string, number> = { cleric: 1, sorcerer: 1, warlock: 1, druid: 2, wizard: 2 }
const STEPS = ['Třída', 'Životy', 'Featury', 'Vlastnosti', 'Kouzla', 'Souhrn'] as const
type Step = (typeof STEPS)[number]

function rollDie(sides: number): number {
  const b = new Uint32Array(1)
  const limit = Math.floor(0x100000000 / sides) * sides
  do crypto.getRandomValues(b)
  while ((b[0] ?? 0) >= limit)
  return ((b[0] ?? 0) % sides) + 1
}

export function LevelUpPage() {
  const { id } = useParams<{ id: string }>()
  const { data: character, isPending } = useCharacter(id)
  const { data: bundle, isPending: bundlePending } = useEngineBundle()
  if (isPending || bundlePending) return <FullPageSpinner />
  if (!character || !bundle) return <Navigate to="/" replace />
  if (character.levels.length >= 20) return <Navigate to={`/characters/${character.id}`} replace />
  return <Wizard character={character} bundle={bundle} />
}

function Wizard({ character, bundle }: { character: CharacterFull; bundle: RulesBundle }) {
  const navigate = useNavigate()
  const levelUp = useLevelUp(character.id)
  const current = useMemo(() => groupClasses(toEngineInput(character)), [character])
  const [classIndex, setClassIndex] = useState(current[current.length - 1]?.classIndex ?? 'fighter')
  const [override, setOverride] = useState(false)
  const [hpMode, setHpMode] = useState<'average' | 'roll'>('average')
  const [hpRoll, setHpRoll] = useState<number | null>(null)
  const [subclass, setSubclass] = useState('')
  const [asiMode, setAsiMode] = useState<'asi' | 'feat'>('asi')
  const [increases, setIncreases] = useState<Partial<Record<AbilityKey, number>>>({})
  const [featName, setFeatName] = useState('')
  const [featDescription, setFeatDescription] = useState('')
  const [featRuleId, setFeatRuleId] = useState<string | null>(null)
  const [addSpells, setAddSpells] = useState<{ ruleId: string; name: string; level: number }[]>([])
  const [removeSpells, setRemoveSpells] = useState<string[]>([])
  const [note, setNote] = useState('')
  const [stepIndex, setStepIndex] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const cls = bundle.classes[classIndex]
  const existing = current.find((c) => c.classIndex === classIndex)
  const newClassLevel = (existing?.level ?? 0) + 1
  const isNewClass = !existing
  const hitDie = cls?.hitDie ?? 8
  const nameOf = (idx: string) => bundle.classes[idx]?.name ?? idx

  const problems = isNewClass
    ? multiclassProblems(
        character.abilityScores,
        current.map((c) => c.classIndex),
        classIndex,
        nameOf,
      )
    : []
  const subclassLevel = SUBCLASS_LEVEL[classIndex] ?? 3
  const needsSubclass = newClassLevel === subclassLevel && !character.subclasses[classIndex] && (cls?.subclasses.length ?? 0) > 0
  const asiLevel = hasAbilityScoreImprovement(bundle, classIndex, newClassLevel)
  const allowance = newSpellAllowance(bundle, classIndex, newClassLevel)
  const casts = (cls?.casterType ?? 'none') !== 'none'
  const asiTotal = Object.values(increases).reduce((n, v) => n + (v ?? 0), 0)

  // Výpočet "před" a "po" enginem: co se tímto level upem změní.
  const { data: campaign } = useCampaign(character.campaignId)
  const baseInput = useMemo(() => toEngineInput(character, engineRulesOf(campaign?.settings)), [character, campaign?.settings])
  const before = useMemo(() => computeSheet({ ...baseInput, state: { ...baseInput.state, hpCurrent: 0 } }, bundle), [baseInput, bundle])
  const afterInput = useMemo(() => {
    const scores = { ...character.abilityScores }
    if (asiLevel && asiMode === 'asi') for (const a of ABILITIES) scores[a] += increases[a] ?? 0
    return {
      ...baseInput,
      abilityScores: scores,
      levels: [...baseInput.levels, { classIndex, hpRoll: hpMode === 'roll' ? hpRoll : null }],
      subclasses: subclass ? { ...baseInput.subclasses, [classIndex]: subclass } : baseInput.subclasses,
    }
  }, [baseInput, character.abilityScores, asiLevel, asiMode, increases, classIndex, hpMode, hpRoll, subclass])
  const after = useMemo(() => computeSheet({ ...afterInput, state: { ...afterInput.state, hpCurrent: 0 } }, bundle), [afterInput, bundle])
  const hpGain = Math.max(0, after.hp.max.base - before.hp.max.base)

  const features = useClassFeatures(classIndex, newClassLevel, subclass || character.subclasses[classIndex])
  const newFeatures = (features.data ?? []).filter((f) => f.level === newClassLevel)

  // Kroky, které se pro tento level nepoužijí, se přeskakují.
  const steps: Step[] = STEPS.filter((s) => (s === 'Vlastnosti' ? asiLevel : s === 'Kouzla' ? casts || addSpells.length > 0 : true))
  const step = steps[Math.min(stepIndex, steps.length - 1)] ?? 'Třída'
  const blocked =
    (step === 'Třída' && problems.length > 0 && !override) ||
    (step === 'Životy' && hpMode === 'roll' && hpRoll === null) ||
    (step === 'Featury' && false) ||
    (step === 'Vlastnosti' && ((asiMode === 'asi' && asiTotal !== 2) || (asiMode === 'feat' && !featName.trim())))

  function submit() {
    setError(null)
    const input: LevelUpInput = { classIndex, hpRoll: hpMode === 'roll' ? hpRoll : null, hpGain }
    if (subclass) input.subclass = subclass
    if (asiLevel) {
      if (asiMode === 'asi' && asiTotal === 2)
        input.asi = { increases: Object.fromEntries(Object.entries(increases).filter(([, v]) => (v ?? 0) > 0)) }
      if (asiMode === 'feat' && featName.trim()) input.feat = { name: featName.trim(), description: featDescription, ruleId: featRuleId }
    }
    if (addSpells.length > 0 || removeSpells.length > 0) {
      input.spells = { add: addSpells.map((s) => ({ ruleId: s.ruleId, classIdx: classIndex })), remove: removeSpells }
    }
    if (note.trim()) input.note = note.trim()
    levelUp.mutate(input, {
      onSuccess: () => {
        toast.success(`Level ${character.levels.length + 1}: ${nameOf(classIndex)} ${newClassLevel}`)
        void navigate(`/characters/${character.id}`)
      },
      onError: (e) => setError(e instanceof ApiError ? e.message : 'Level up se nepodařil.'),
    })
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Link
        to={`/characters/${character.id}`}
        className="inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeftIcon aria-hidden className="size-4" /> {character.name}
      </Link>
      <h1 className="text-2xl font-bold">Level up na level {character.levels.length + 1}</h1>

      <nav aria-label="Kroky průvodce">
        <ol className="flex flex-wrap gap-2 text-sm">
          {steps.map((s, i) => (
            <li
              key={s}
              aria-current={s === step ? 'step' : undefined}
              className={cn(
                'rounded-full border px-3 py-1',
                s === step ? 'border-primary bg-primary text-primary-foreground' : i < stepIndex ? 'bg-muted' : 'text-muted-foreground',
              )}
            >
              {i + 1}. {s}
            </li>
          ))}
        </ol>
      </nav>

      <Card>
        <CardHeader>
          <CardTitle>{step}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {step === 'Třída' && (
            <>
              <div className="space-y-2">
                <Label htmlFor="lu-class">Ve které třídě postoupíš?</Label>
                <NativeSelect
                  id="lu-class"
                  value={classIndex}
                  onChange={(e) => {
                    setClassIndex(e.target.value)
                    setSubclass('')
                    setOverride(false)
                    setAddSpells([])
                    setRemoveSpells([])
                  }}
                >
                  <optgroup label="Současné třídy">
                    {current.map((c) => (
                      <option key={c.classIndex} value={c.classIndex}>
                        {nameOf(c.classIndex)} {c.level} → {c.level + 1}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="Nová třída (multiclass)">
                    {Object.values(bundle.classes)
                      .filter((c) => !current.some((x) => x.classIndex === c.index))
                      .sort((a, b) => a.name.localeCompare(b.name))
                      .map((c) => (
                        <option key={c.index} value={c.index}>
                          {c.name} (nová, level 1)
                        </option>
                      ))}
                  </optgroup>
                </NativeSelect>
              </div>
              {isNewClass && problems.length === 0 && <p className="text-sm text-green-700 dark:text-green-400">Prerekvizity multiclassu splněny.</p>}
              {problems.length > 0 && (
                <div role="alert" className="space-y-2 rounded-lg border border-amber-500 bg-amber-500/10 p-3 text-sm">
                  <p className="font-medium">Prerekvizity multiclassu nejsou splněné:</p>
                  <ul className="list-disc pl-5">
                    {problems.map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </ul>
                  <label className="flex min-h-11 cursor-pointer items-center gap-3">
                    <input
                      type="checkbox"
                      className="size-5 shrink-0 accent-primary"
                      checked={override}
                      onChange={(e) => setOverride(e.target.checked)}
                    />
                    <span>Přesto pokračovat (výjimku povolil DM)</span>
                  </label>
                </div>
              )}
            </>
          )}

          {step === 'Životy' && (
            <>
              <p className="text-sm text-muted-foreground">
                Hit die: <strong>d{hitDie}</strong>, modifikátor CON {formatModifier(after.abilities.con.modifier)}.
              </p>
              <div className="space-y-2" role="radiogroup" aria-label="Způsob určení životů">
                <label
                  className={cn(
                    'flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border p-3',
                    hpMode === 'average' && 'border-primary bg-muted',
                  )}
                >
                  <input
                    type="radio"
                    name="hp-mode"
                    className="size-5 accent-primary"
                    checked={hpMode === 'average'}
                    onChange={() => setHpMode('average')}
                  />
                  <span>
                    Průměr ({averageRoll(hitDie)}) → +{hpGainForLevel(hitDie, after.abilities.con.score.value, null)} HP
                  </span>
                </label>
                <label
                  className={cn(
                    'flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border p-3',
                    hpMode === 'roll' && 'border-primary bg-muted',
                  )}
                >
                  <input
                    type="radio"
                    name="hp-mode"
                    className="size-5 accent-primary"
                    checked={hpMode === 'roll'}
                    onChange={() => setHpMode('roll')}
                  />
                  <span>Hodit kostkou d{hitDie}</span>
                </label>
              </div>
              {hpMode === 'roll' && (
                <div className="flex flex-wrap items-center gap-3">
                  <Button type="button" variant="secondary" onClick={() => setHpRoll(rollDie(hitDie))}>
                    <DicesIcon aria-hidden /> Hodit d{hitDie}
                  </Button>
                  <span className="flex items-center gap-2 text-sm">
                    nebo zadat ručně
                    <Input
                      aria-label="Hozená hodnota"
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={hitDie}
                      className="w-20"
                      value={hpRoll ?? ''}
                      onChange={(e) =>
                        setHpRoll(e.target.value === '' ? null : Math.max(1, Math.min(hitDie, Number.parseInt(e.target.value, 10) || 1)))
                      }
                    />
                  </span>
                  {hpRoll !== null && (
                    <p role="status" className="w-full text-sm">
                      Hozeno <strong>{hpRoll}</strong> → +{hpGainForLevel(hitDie, after.abilities.con.score.value, hpRoll)} HP
                    </p>
                  )}
                </div>
              )}
              <p className="text-sm">
                Maximum HP: {before.hp.max.base} → <strong>{after.hp.max.base}</strong> (+{hpGain})
              </p>
            </>
          )}

          {step === 'Featury' && (
            <>
              {needsSubclass && (
                <div className="space-y-2">
                  <Label htmlFor="lu-sub">Vyber subclass ({nameOf(classIndex)})</Label>
                  <NativeSelect id="lu-sub" value={subclass} onChange={(e) => setSubclass(e.target.value)}>
                    <option value="">Rozhodnu se později</option>
                    {(cls?.subclasses ?? []).map((s) => (
                      <option key={s.index} value={s.index}>
                        {s.name}
                      </option>
                    ))}
                  </NativeSelect>
                  <p className="text-sm text-muted-foreground">
                    Subclass lze doplnit později na sheetu, ale featury z něj se započítají až po výběru.
                  </p>
                </div>
              )}
              {features.isPending && <p className="text-muted-foreground">Načítám…</p>}
              {newFeatures.length === 0 && !features.isPending && (
                <p className="text-muted-foreground">Na tomto levelu nepřibývají žádné nové featury.</p>
              )}
              {newFeatures.map((f) => (
                <details key={`${f.source}-${f.id}`} open className="rounded-lg border">
                  <summary className="flex min-h-11 cursor-pointer items-center justify-between px-3 py-2 font-medium">
                    <span>
                      <span>{f.name}</span>
                      {f.source === 'subclass' && <span className="ml-2 text-xs font-normal text-muted-foreground">({f.className})</span>}
                    </span>
                  </summary>
                  <div className="border-t px-3 py-3 text-sm">
                    <DescriptionText text={f.description} />
                  </div>
                </details>
              ))}
              <div className="space-y-2">
                <Label htmlFor="lu-note">Ruční doplnění (volitelné)</Label>
                <Textarea
                  id="lu-note"
                  rows={3}
                  maxLength={5000}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Co aplikace nezná: homebrew featura, vlastní pravidlo od DM, volba z příručky mimo SRD…"
                />
              </div>
            </>
          )}

          {step === 'Vlastnosti' && (
            <>
              <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Zvýšení vlastností nebo feat">
                {(
                  [
                    ['asi', 'Zvýšit vlastnosti'],
                    ['feat', 'Vybrat feat'],
                  ] as const
                ).map(([m, label]) => (
                  <Button
                    key={m}
                    type="button"
                    role="radio"
                    aria-checked={asiMode === m}
                    variant={asiMode === m ? 'default' : 'outline'}
                    onClick={() => setAsiMode(m)}
                  >
                    {label}
                  </Button>
                ))}
              </div>
              {asiMode === 'asi' ? (
                <>
                  <p className="text-sm text-muted-foreground">Rozděl celkem +2 (jedna vlastnost +2, nebo dvě po +1). Maximum je 20.</p>
                  <ul className="grid grid-cols-2 gap-3">
                    {ABILITIES.map((a) => {
                      const value = increases[a] ?? 0
                      const score = character.abilityScores[a]
                      return (
                        <li key={a} className="flex items-center justify-between gap-2 rounded-lg border p-2">
                          <span className="text-sm">
                            {ABILITY_LABELS[a]} <strong>{score + value}</strong>
                            {value > 0 && <span className="text-green-700 dark:text-green-400"> (+{value})</span>}
                          </span>
                          <span className="flex gap-1">
                            <Button
                              type="button"
                              variant="outline"
                              size="icon"
                              aria-label={`${ABILITY_LABELS[a]}: −1`}
                              disabled={value <= 0}
                              onClick={() => setIncreases((i) => ({ ...i, [a]: value - 1 }))}
                            >
                              −
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="icon"
                              aria-label={`${ABILITY_LABELS[a]}: +1`}
                              disabled={asiTotal >= 2 || value >= 2 || score + value >= 20}
                              onClick={() => setIncreases((i) => ({ ...i, [a]: value + 1 }))}
                            >
                              +
                            </Button>
                          </span>
                        </li>
                      )
                    })}
                  </ul>
                  <p role="status" className="text-sm">
                    Rozdáno: <strong>{asiTotal}</strong> / 2
                  </p>
                </>
              ) : (
                <FeatPicker
                  name={featName}
                  description={featDescription}
                  onChange={(n, d, ruleId) => {
                    setFeatName(n)
                    setFeatDescription(d)
                    setFeatRuleId(ruleId)
                  }}
                />
              )}
            </>
          )}

          {step === 'Kouzla' && (
            <SpellStep
              character={character}
              classIndex={classIndex}
              className={nameOf(classIndex)}
              allowance={allowance}
              addSpells={addSpells}
              setAddSpells={setAddSpells}
              removeSpells={removeSpells}
              setRemoveSpells={setRemoveSpells}
            />
          )}

          {step === 'Souhrn' && (
            <>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                <dt className="text-muted-foreground">Třída</dt>
                <dd className="font-medium">
                  {nameOf(classIndex)} {existing ? `${existing.level} → ${newClassLevel}` : '(nová, level 1)'}
                </dd>
                <dt className="text-muted-foreground">Celkový level</dt>
                <dd className="font-medium">
                  {before.totalLevel} → {after.totalLevel} ({after.classSummary})
                </dd>
                <dt className="text-muted-foreground">Maximum HP</dt>
                <dd className="font-medium">
                  {before.hp.max.base} → {after.hp.max.base} (+{hpGain}, {hpMode === 'roll' ? `hod ${hpRoll}` : 'průměr'})
                </dd>
                {before.proficiencyBonus.base !== after.proficiencyBonus.base && (
                  <>
                    <dt className="text-muted-foreground">Proficiency bonus</dt>
                    <dd className="font-medium">
                      {formatModifier(before.proficiencyBonus.base)} → {formatModifier(after.proficiencyBonus.base)}
                    </dd>
                  </>
                )}
                {subclass && (
                  <>
                    <dt className="text-muted-foreground">Subclass</dt>
                    <dd className="font-medium">{cls?.subclasses.find((s) => s.index === subclass)?.name ?? subclass}</dd>
                  </>
                )}
                {asiLevel && (
                  <>
                    <dt className="text-muted-foreground">{asiMode === 'asi' ? 'Vlastnosti' : 'Feat'}</dt>
                    <dd className="font-medium">
                      {asiMode === 'asi'
                        ? Object.entries(increases)
                            .filter(([, v]) => (v ?? 0) > 0)
                            .map(([a, v]) => `${ABILITY_LABELS[a as AbilityKey]} +${v}`)
                            .join(', ') || '—'
                        : featName || '—'}
                    </dd>
                  </>
                )}
                {newFeatures.length > 0 && (
                  <>
                    <dt className="text-muted-foreground">Nové featury</dt>
                    <dd className="font-medium">{newFeatures.map((f) => f.name).join(', ')}</dd>
                  </>
                )}
                <SlotDiff before={before} after={after} />
                {addSpells.length > 0 && (
                  <>
                    <dt className="text-muted-foreground">Nová kouzla</dt>
                    <dd className="font-medium">{addSpells.map((s) => s.name).join(', ')}</dd>
                  </>
                )}
                {removeSpells.length > 0 && (
                  <>
                    <dt className="text-muted-foreground">Odebraná kouzla</dt>
                    <dd className="font-medium">{removeSpells.map((id) => character.spells.find((s) => s.id === id)?.name).join(', ')}</dd>
                  </>
                )}
                {note.trim() && (
                  <>
                    <dt className="text-muted-foreground">Poznámka</dt>
                    <dd className="font-medium whitespace-pre-line">{note}</dd>
                  </>
                )}
              </dl>
              <p className="text-sm text-muted-foreground">Level up se uloží do historie a půjde vrátit na záložce Postava.</p>
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2">
        {stepIndex > 0 && (
          <Button variant="outline" size="lg" onClick={() => setStepIndex((i) => Math.max(0, i - 1))}>
            Zpět
          </Button>
        )}
        {step !== 'Souhrn' ? (
          <Button size="lg" disabled={blocked} onClick={() => setStepIndex((i) => Math.min(steps.length - 1, i + 1))}>
            Pokračovat
          </Button>
        ) : (
          <Button size="lg" disabled={levelUp.isPending} onClick={submit}>
            {levelUp.isPending ? 'Ukládám…' : 'Potvrdit level up'}
          </Button>
        )}
      </div>
    </div>
  )
}

function SlotDiff({ before, after }: { before: ReturnType<typeof computeSheet>; after: ReturnType<typeof computeSheet> }) {
  const rows: [string, string][] = []
  const levels = new Set([...before.spellcasting.slots.map((s) => s.level), ...after.spellcasting.slots.map((s) => s.level)])
  for (const level of [...levels].sort()) {
    const b = before.spellcasting.slots.find((s) => s.level === level)?.max ?? 0
    const a = after.spellcasting.slots.find((s) => s.level === level)?.max ?? 0
    if (a !== b) rows.push([`Sloty ${level}. úrovně`, `${b} → ${a}`])
  }
  const pb = before.spellcasting.pact
  const pa = after.spellcasting.pact
  if ((pb?.count ?? 0) !== (pa?.count ?? 0) || (pb?.level ?? 0) !== (pa?.level ?? 0))
    rows.push(['Pact sloty', `${pb ? `${pb.count}× ${pb.level}.` : '—'} → ${pa ? `${pa.count}× ${pa.level}.` : '—'}`])
  for (const r of after.resources) {
    const prev = before.resources.find((x) => x.key === r.key)?.max.base ?? 0
    if (prev !== r.max.base) rows.push([r.name, `${prev || '—'} → ${r.max.base}`])
  }
  if (after.speed.base !== before.speed.base) rows.push(['Rychlost', `${before.speed.base} → ${after.speed.base} ft`])
  if (after.attacksPerAction !== before.attacksPerAction) rows.push(['Útoky na akci', `${before.attacksPerAction} → ${after.attacksPerAction}`])
  if (after.martialArtsDie !== before.martialArtsDie && after.martialArtsDie)
    rows.push(['Martial Arts', `${before.martialArtsDie ?? '—'} → ${after.martialArtsDie}`])
  return (
    <>
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="font-medium">{value}</dd>
        </div>
      ))}
    </>
  )
}

function FeatPicker({
  name,
  description,
  onChange,
}: {
  name: string
  description: string
  onChange: (name: string, description: string, ruleId: string | null) => void
}) {
  const rules = useRules({ kinds: ['feat'] })
  const feats = rules.data?.pages.flatMap((p) => p.entries) ?? []
  return (
    <div className="space-y-3">
      {feats.length > 0 && (
        <div className="space-y-2">
          <Label htmlFor="lu-feat-srd">Feat ze SRD</Label>
          <NativeSelect
            id="lu-feat-srd"
            value={feats.find((f) => f.name === name)?.id ?? ''}
            onChange={(e) => {
              const f = feats.find((x) => x.id === e.target.value)
              onChange(f?.name ?? '', f?.summary ?? '', f?.id ?? null)
            }}
          >
            <option value="">Vlastní feat (ručně)</option>
            {feats.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </NativeSelect>
        </div>
      )}
      <div className="space-y-2">
        <Label htmlFor="lu-feat-name">Název featu</Label>
        <Input id="lu-feat-name" maxLength={100} value={name} onChange={(e) => onChange(e.target.value, description, null)} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="lu-feat-desc">Popis (volitelný)</Label>
        <Textarea id="lu-feat-desc" rows={3} maxLength={5000} value={description} onChange={(e) => onChange(name, e.target.value, null)} />
      </div>
      <p className="text-sm text-muted-foreground">
        Efekty featu si případně nastav ručně (přepisy hodnot na sheetu). Aplikace ví jen to, co je v SRD.
      </p>
    </div>
  )
}

function SpellStep({
  character,
  classIndex,
  className,
  allowance,
  addSpells,
  setAddSpells,
  removeSpells,
  setRemoveSpells,
}: {
  character: CharacterFull
  classIndex: string
  className: string
  allowance: ReturnType<typeof newSpellAllowance>
  addSpells: { ruleId: string; name: string; level: number }[]
  setAddSpells: (s: { ruleId: string; name: string; level: number }[]) => void
  removeSpells: string[]
  setRemoveSpells: (s: string[]) => void
}) {
  const [q, setQ] = useState('')
  const [level, setLevel] = useState('')
  const rules = useRules({
    kinds: ['spell'],
    q: q.trim() || undefined,
    level: level || undefined,
    tag: className,
    campaignId: character.campaignId,
    sort: 'level',
  })
  const entries = rules.data?.pages.flatMap((p) => p.entries) ?? []
  const known = new Set(character.spells.filter((s) => s.classIdx === classIndex).map((s) => s.ruleId))
  const mine = character.spells.filter((s) => s.classIdx === classIndex)
  const addedCantrips = addSpells.filter((s) => s.level === 0).length
  const addedSpells = addSpells.filter((s) => s.level > 0).length

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {className} na tomto levelu získává:{' '}
        <strong>
          {allowance.cantrips > 0 ? `${allowance.cantrips} nový cantrip` : 'žádný nový cantrip'}
          {allowance.spells > 0 ? `, ${allowance.spells} nové známé kouzlo` : ''}
          {allowance.spellbook > 0 ? `, ${allowance.spellbook} kouzla do knihy kouzel` : ''}
        </strong>
        {allowance.maxSpellLevel > 0 ? ` (kouzla až do ${allowance.maxSpellLevel}. úrovně)` : ''}. Počty jsou doporučení, aplikace tě neblokuje. Krok
        můžeš přeskočit.
      </p>
      <p role="status" className="text-sm">
        Vybráno: cantripy {addedCantrips}, kouzla {addedSpells}
      </p>

      {addSpells.length > 0 && (
        <ul aria-label="Vybraná nová kouzla" className="space-y-1">
          {addSpells.map((s) => (
            <li key={s.ruleId} className="flex items-center justify-between gap-2 rounded-lg border p-2 text-sm">
              <span>
                {s.name} <span className="text-muted-foreground">({s.level === 0 ? 'cantrip' : `${s.level}. úroveň`})</span>
              </span>
              <Button type="button" variant="ghost" size="sm" onClick={() => setAddSpells(addSpells.filter((x) => x.ruleId !== s.ruleId))}>
                Zrušit
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="grid grid-cols-[1fr_auto] gap-2">
        <Input type="search" aria-label="Hledat kouzlo" placeholder="Hledat kouzlo…" value={q} onChange={(e) => setQ(e.target.value)} />
        <NativeSelect aria-label="Úroveň kouzla" className="w-32" value={level} onChange={(e) => setLevel(e.target.value)}>
          <option value="">Všechny</option>
          {Array.from({ length: Math.max(0, allowance.maxSpellLevel) + 1 }, (_, i) => (
            <option key={i} value={i}>
              {i === 0 ? 'Cantrip' : `Level ${i}`}
            </option>
          ))}
        </NativeSelect>
      </div>
      <ul className="max-h-[40dvh] space-y-2 overflow-y-auto">
        {entries
          .filter((e) => (e.level ?? 0) <= Math.max(allowance.maxSpellLevel, 0) || allowance.maxSpellLevel === 0)
          .map((e) => {
            const chosen = addSpells.some((s) => s.ruleId === e.id)
            return (
              <li key={e.id} className="flex items-center justify-between gap-2 rounded-lg border p-2">
                <span className="min-w-0 text-sm">
                  <span className="block truncate font-medium">{e.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {(e.level ?? 0) === 0 ? 'Cantrip' : `Level ${e.level}`} · {e.category}
                  </span>
                </span>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={chosen || known.has(e.id)}
                  aria-label={`Vybrat ${e.name}`}
                  onClick={() => setAddSpells([...addSpells, { ruleId: e.id, name: e.name, level: e.level ?? 0 }])}
                >
                  {known.has(e.id) ? 'Už zná' : chosen ? 'Vybráno' : 'Vybrat'}
                </Button>
              </li>
            )
          })}
      </ul>

      {mine.length > 0 && (
        <section aria-label="Vyměnit kouzlo" className="space-y-2">
          <h3 className="text-sm font-medium">Vyměnit známé kouzlo (volitelné)</h3>
          <ul className="space-y-1">
            {mine.map((s) => (
              <li key={s.id}>
                <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
                  <input
                    type="checkbox"
                    className="size-5 shrink-0 accent-primary"
                    checked={removeSpells.includes(s.id)}
                    onChange={(e) => setRemoveSpells(e.target.checked ? [...removeSpells, s.id] : removeSpells.filter((x) => x !== s.id))}
                  />
                  <span>
                    Odebrat {s.name} <span className="text-muted-foreground">({s.level === 0 ? 'cantrip' : `${s.level}. úroveň`})</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
