import { ABILITIES, SKILLS, formatModifier, type SkillKey } from '@/engine'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { RollButton } from '@/features/dice/RollButton'
import { d20 } from '@/features/dice/format'
import { ComputedValue } from './ComputedValue'
import { useSheet } from './sheet-context'
import { ABILITY_LABELS, SKILL_LABELS } from './labels'

export function AbilitiesCard() {
  const { sheet } = useSheet()
  return (
    <Card>
      <CardHeader>
        <CardTitle>Vlastnosti</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="grid grid-cols-3 gap-2">
          {ABILITIES.map((a) => (
            <li key={a} className="flex flex-col items-center rounded-xl border p-2 text-center">
              <span className="font-display text-xs font-semibold tracking-wider text-muted-foreground uppercase">{a}</span>
              <span
                className="text-2xl font-bold tabular-nums"
                aria-label={`${ABILITY_LABELS[a]}: modifikátor ${formatModifier(sheet.abilities[a].modifier)}`}
              >
                {formatModifier(sheet.abilities[a].modifier)}
              </span>
              <ComputedValue
                title={`${ABILITY_LABELS[a]} (hodnota)`}
                computed={sheet.abilities[a].score}
                overrideKey={`ability.${a}`}
                className="min-h-11 text-sm text-muted-foreground"
              />
              <RollButton label={`${ABILITY_LABELS[a]} check`} expression={d20(sheet.abilities[a].modifier - sheet.conditions.d20Penalty)} text="Hod" kind={{ check: a }} />
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

export function SavesCard() {
  const { sheet } = useSheet()
  return (
    <Card>
      <CardHeader>
        <CardTitle>Saving Throws</CardTitle>
      </CardHeader>
      <CardContent>
        <ul>
          {ABILITIES.map((a) => (
            <li key={a} className="grid grid-cols-[minmax(0,1fr)_4rem_2.75rem] items-center gap-2 border-b py-0.5 last:border-b-0">
              <span className="flex items-center gap-2 text-sm">
                <span
                  aria-hidden
                  className={cn('size-3 rounded-full border', sheet.saves[a].proficient ? 'border-primary bg-primary' : 'border-muted-foreground/50')}
                />
                <span className="sr-only">{sheet.saves[a].proficient ? 'Proficient: ' : ''}</span>
                {ABILITY_LABELS[a]}
                {sheet.conditions.saves[a].autoFail.length > 0 && (
                  <span className="rounded bg-red-600/10 px-1.5 py-0.5 text-xs font-medium text-red-700 dark:text-red-300">
                    automaticky neúspěch ({sheet.conditions.saves[a].autoFail.join(', ')})
                  </span>
                )}
              </span>
              <span className="flex justify-center">
                <ComputedValue
                  title={`${ABILITY_LABELS[a]} saving throw`}
                  computed={sheet.saves[a]}
                  overrideKey={`save.${a}`}
                  format={formatModifier}
                />
              </span>
              <RollButton label={`${ABILITY_LABELS[a]} saving throw`} expression={d20(sheet.saves[a].value)} className="-my-1" kind={{ save: a }} />
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

export function SkillsCard() {
  const { sheet, character, canEdit, update } = useSheet()

  function cycle(key: SkillKey) {
    const current = character.skillProficiencies[key] ?? 0
    const next = ((current + 1) % 3) as 0 | 1 | 2
    const skills = { ...character.skillProficiencies, [key]: next }
    if (next === 0) delete skills[key]
    update({ skillProficiencies: skills })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Dovednosti</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="tab:columns-2 tab:gap-x-6 lg:columns-1">
          {SKILLS.map((s) => {
            const skill = sheet.skills[s.key]
            return (
              <li key={s.key} className="grid break-inside-avoid grid-cols-[minmax(0,1fr)_4rem_2.75rem] items-center gap-2 border-b last:border-b-0">
                <span className="flex items-center gap-1 text-sm">
                  <button
                    type="button"
                    disabled={!canEdit}
                    onClick={() => cycle(s.key)}
                    aria-label={`${SKILL_LABELS[s.key]}: ${['bez proficiency', 'proficiency', 'expertise'][skill.proficiency]}. Změnit`}
                    className="inline-flex size-11 items-center justify-center disabled:cursor-default"
                  >
                    <span
                      aria-hidden
                      className={cn(
                        'size-3.5 rounded-full border',
                        skill.proficiency === 0 && 'border-muted-foreground/50',
                        skill.proficiency === 1 && 'border-primary bg-primary',
                        skill.proficiency === 2 && 'border-primary bg-primary ring-2 ring-primary/40 ring-offset-2 ring-offset-background',
                      )}
                    />
                  </button>
                  {SKILL_LABELS[s.key]} <span className="text-xs text-muted-foreground uppercase">{s.ability}</span>
                </span>
                <span className="flex justify-center">
                  <ComputedValue title={SKILL_LABELS[s.key]} computed={skill} overrideKey={`skill.${s.key}`} format={formatModifier} />
                </span>
                <RollButton label={SKILL_LABELS[s.key]} expression={d20(skill.value)} kind={{ check: s.ability }} />
              </li>
            )
          })}
        </ul>
        {canEdit && <p className="mt-2 text-xs text-muted-foreground">Klepnutím na tečku přepneš: bez proficiency, proficiency, expertise.</p>}
      </CardContent>
    </Card>
  )
}
