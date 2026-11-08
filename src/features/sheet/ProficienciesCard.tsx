import { useState, type FormEvent } from 'react'
import { PlusIcon, XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { PROFICIENCY_GROUPS, proficiencyEntries, withProficiency, withoutProficiency, type ProficiencyGroup } from './proficiencies'
import { useSheet } from './sheet-context'

/** Proficiencies se zbrojí, zbraněmi a nástroji: z první třídy (jen ke čtení) a vlastní (přidat, odebrat). Jazyky mají vlastní kartu. */
export function ProficienciesCard() {
  const { character, sheet, canEdit, update, bundle } = useSheet()
  const [group, setGroup] = useState<ProficiencyGroup>('tool')
  const [name, setName] = useState('')
  const entries = proficiencyEntries(sheet.proficiencies, character.extraProficiencies)
  const firstClass = character.levels[0] ? (bundle.classes[character.levels[0].classIndex]?.name ?? '') : ''

  function add(e: FormEvent) {
    e.preventDefault()
    const next = withProficiency(character.extraProficiencies, group, name)
    if (next !== character.extraProficiencies) update({ extraProficiencies: next })
    setName('')
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Proficiencies</CardTitle>
        <p className="text-sm text-muted-foreground">Se kterými zbraněmi, zbrojí a nástroji umíš zacházet.</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {PROFICIENCY_GROUPS.map((g) => {
          const list = entries.filter((e) => e.group === g.key)
          if (list.length === 0) return null
          return (
            <section key={g.key} aria-label={g.label} className="space-y-1.5">
              <h3 className="text-sm font-medium text-muted-foreground">{g.label}</h3>
              <ul className="flex flex-wrap gap-2">
                {list.map((p) => (
                  <li key={p.raw} className={p.fromClass || !canEdit ? 'flex min-h-11 items-center rounded-full border px-3' : 'flex items-center rounded-full border pl-3'}>
                    {p.name}
                    {p.fromClass && firstClass && <span className="ml-1 text-xs text-muted-foreground">({firstClass})</span>}
                    {!p.fromClass && canEdit && (
                      <button
                        type="button"
                        aria-label={`Odebrat proficiency ${p.name}`}
                        className="inline-flex size-11 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
                        onClick={() => update({ extraProficiencies: withoutProficiency(character.extraProficiencies, p.raw) })}
                      >
                        <XIcon aria-hidden className="size-4" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )
        })}
        {entries.length === 0 && <p className="text-sm text-muted-foreground">Zatím žádné proficiencies.</p>}
        {canEdit && (
          <form onSubmit={add} className="space-y-2">
            <div className="grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-[10rem_minmax(0,1fr)_auto]">
              <div>
                <Label htmlFor="prof-group" className="sr-only">
                  Druh proficiency
                </Label>
                <NativeSelect id="prof-group" value={group} onChange={(e) => setGroup(e.target.value as ProficiencyGroup)}>
                  {PROFICIENCY_GROUPS.map((g) => (
                    <option key={g.key} value={g.key}>
                      {g.label}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div>
                <Label htmlFor="prof-name" className="sr-only">
                  Název proficiency
                </Label>
                <Input id="prof-name" value={name} maxLength={50} placeholder="např. Smith's Tools, Longbow" onChange={(e) => setName(e.target.value)} />
              </div>
              <Button type="submit" variant="secondary" aria-label="Přidat proficiency" disabled={name.trim() === ''}>
                <PlusIcon aria-hidden /> Přidat
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Proficiencies z první třídy se počítají samy. Další (z rasy, backgroundu, multiclassu, od DM) přidej sem; zbraň zapsaná anglicky jako v pravidlech (Longbow, Martial Weapons) dá útoku bonus za proficiency.
            </p>
          </form>
        )}
      </CardContent>
    </Card>
  )
}
