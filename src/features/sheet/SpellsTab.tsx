import { useState } from 'react'
import { PlusIcon, SparklesIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Modal } from '@/components/ui/modal'
import { NativeSelect } from '@/components/ui/native-select'
import { ApiError } from '@/lib/api'
import { DescriptionText } from '@/features/rules/DescriptionText'
import { factsFor } from '@/features/rules/facts'
import { useRule, useRules } from '@/features/rules/api'
import { cn } from '@/lib/utils'
import { groupClasses } from '@/engine'
import { useAddSpell, useDeleteSpell, useUpdateSpell } from './api'
import { toEngineInput } from './model'
import { useSheet } from './sheet-context'
import type { CharacterSpell } from './types'

/** Třídy, které si kouzla připravují každý den (ostatní mají pevný seznam známých kouzel). */
const PREPARED_CLASSES = new Set(['cleric', 'druid', 'paladin', 'wizard'])

export function SpellsTab() {
  const { character, sheet, canEdit } = useSheet()
  const [adding, setAdding] = useState(false)
  const [detail, setDetail] = useState<CharacterSpell | null>(null)
  const [casting, setCasting] = useState<CharacterSpell | null>(null)
  const update = useUpdateSpell(character.id)
  const levels = [...new Set(character.spells.map((s) => s.level))].sort((a, b) => a - b)

  return (
    <div className="space-y-4">
      <ConcentrationBanner />
      <SlotsSummary />

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
          <CardTitle>Kouzla</CardTitle>
          {canEdit && (
            <Button onClick={() => setAdding(true)}>
              <PlusIcon aria-hidden /> Přidat kouzlo
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-5">
          {sheet.spellcasting.classes.map((c) => {
            const mine = character.spells.filter((s) => s.classIdx === c.classIndex)
            const cantrips = mine.filter((s) => s.level === 0).length
            // Kouzla vždy připravená (domény, přísahy, archetyp jako Cowboy Magic) se do limitu známých ani připravených nepočítají.
            const leveled = mine.filter((s) => s.level > 0 && !s.alwaysPrepared)
            const prepared = leveled.filter((s) => s.prepared).length
            return (
              <p key={c.classIndex} className="text-sm text-muted-foreground">
                <strong className="text-foreground">{c.className}:</strong> cantripy {cantrips}
                {c.cantripsKnown !== null ? ` / ${c.cantripsKnown}` : ''}
                {PREPARED_CLASSES.has(c.classIndex)
                  ? `, připravená kouzla ${prepared}${c.preparedMax !== null ? ` / ${c.preparedMax}` : ''}`
                  : `, známá kouzla ${leveled.length}${c.spellsKnown !== null ? ` / ${c.spellsKnown}` : ''}`}
                {(c.cantripsKnown !== null && cantrips > c.cantripsKnown) ||
                (c.spellsKnown !== null && !PREPARED_CLASSES.has(c.classIndex) && leveled.length > c.spellsKnown) ||
                (c.preparedMax !== null && prepared > c.preparedMax)
                  ? ' (víc, než dovolují pravidla, ale aplikace tě neblokuje)'
                  : ''}
              </p>
            )
          })}

          {character.spells.length === 0 && <p className="text-muted-foreground">Postava zatím nemá žádná kouzla.</p>}

          {levels.map((level) => (
            <section key={level} aria-label={level === 0 ? 'Cantripy' : `Kouzla ${level}. úrovně`} className="space-y-2">
              <h3 className="font-semibold">{level === 0 ? 'Cantripy' : `${level}. úroveň`}</h3>
              <ul className="grid grid-cols-[minmax(0,1fr)] gap-2 tab:grid-cols-2">
                {character.spells
                  .filter((s) => s.level === level)
                  .map((s) => (
                    <li key={s.id} className="flex flex-wrap items-center gap-2 rounded-xl border bg-card p-3">
                      <button type="button" onClick={() => setDetail(s)} className="min-h-11 min-w-0 flex-1 text-left">
                        <span className="flex flex-wrap items-center gap-2 font-medium">
                          {s.name}
                          {s.concentration && (
                            <span className="rounded-full border px-2 text-xs font-normal" title="Koncentrace">
                              K
                            </span>
                          )}
                          {s.ritual && (
                            <span className="rounded-full border px-2 text-xs font-normal" title="Rituál">
                              R
                            </span>
                          )}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {[
                            s.school,
                            s.castingTime,
                            s.range,
                            s.classIdx
                              ? character.spells.length && sheet.spellcasting.classes.find((c) => c.classIndex === s.classIdx)?.className
                              : null,
                            s.alwaysPrepared ? 'navíc ze subclassu, nepočítá se do limitu' : null,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      </button>
                      {canEdit && level > 0 && PREPARED_CLASSES.has(s.classIdx) && (
                        <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            className="size-5 accent-primary"
                            checked={s.prepared || s.alwaysPrepared}
                            disabled={s.alwaysPrepared}
                            onChange={(e) =>
                              update.mutate(
                                { spellId: s.id, patch: { prepared: e.target.checked } },
                                { onError: () => toast.error('Změna se nepodařila') },
                              )
                            }
                          />
                          Připravené
                        </label>
                      )}
                      {canEdit && (
                        <Button variant="secondary" onClick={() => setCasting(s)} aria-label={`Seslat ${s.name}`}>
                          <SparklesIcon aria-hidden /> Seslat
                        </Button>
                      )}
                    </li>
                  ))}
              </ul>
            </section>
          ))}
        </CardContent>
      </Card>

      <AddSpellDialog open={adding} onClose={() => setAdding(false)} />
      <SpellDetailDialog spell={detail} onClose={() => setDetail(null)} />
      <CastDialog spell={casting} onClose={() => setCasting(null)} />
    </div>
  )
}

function ConcentrationBanner() {
  const { character, adjust, canEdit } = useSheet()
  const current = character.state.concentration
  if (!current) return null
  return (
    <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500 bg-amber-500/10 p-3">
      <span>
        Soustředíš se na <strong>{current}</strong>
      </span>
      {canEdit && (
        <Button variant="outline" onClick={() => adjust([{ op: 'concentration', set: null }])}>
          Ukončit koncentraci
        </Button>
      )}
    </div>
  )
}

function SlotsSummary() {
  const { sheet } = useSheet()
  const { slots, pact } = sheet.spellcasting
  if (slots.length === 0 && !pact) return null
  return (
    <section aria-label="Sloty" className="flex flex-wrap gap-2">
      {slots.map((s) => (
        <span key={s.level} className="rounded-xl border bg-card px-3 py-2 text-sm">
          {s.level}. úroveň: <strong>{s.max - s.used}</strong> / {s.max}
        </span>
      ))}
      {pact && (
        <span className="rounded-xl border bg-card px-3 py-2 text-sm">
          Pact ({pact.level}. úroveň): <strong>{pact.count - pact.used}</strong> / {pact.count}
        </span>
      )}
    </section>
  )
}

function SpellDetailDialog({ spell, onClose }: { spell: CharacterSpell | null; onClose: () => void }) {
  const { character, canEdit } = useSheet()
  const remove = useDeleteSpell(character.id)
  const { data: entry, isPending } = useRule(spell?.ruleId)
  const facts = entry ? factsFor(entry) : []
  return (
    <Modal open={spell !== null} onClose={onClose} title={spell?.name ?? 'Kouzlo'}>
      {spell && (
        <div className="space-y-4">
          {isPending && <p className="text-muted-foreground">Načítám…</p>}
          {entry && (
            <>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-xl border p-3 text-sm">
                {facts.map(([label, value]) => (
                  <div key={label} className="contents">
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="font-medium">{value}</dd>
                  </div>
                ))}
              </dl>
              <DescriptionText text={entry.description} />
              {typeof entry.data.higher_level === 'string' && entry.data.higher_level && (
                <section className="space-y-1">
                  <h3 className="font-semibold">Na vyšší úrovni</h3>
                  <DescriptionText text={entry.data.higher_level} />
                </section>
              )}
            </>
          )}
          {canEdit && (
            <Button
              variant="destructive"
              disabled={remove.isPending}
              onClick={() => {
                if (!window.confirm(`Odebrat kouzlo „${spell.name}“ z postavy?`)) return
                remove.mutate(spell.id, { onSuccess: onClose, onError: () => toast.error('Kouzlo se nepodařilo odebrat') })
              }}
            >
              <Trash2Icon aria-hidden /> Odebrat z postavy
            </Button>
          )}
        </div>
      )}
    </Modal>
  )
}

function CastDialog({ spell, onClose }: { spell: CharacterSpell | null; onClose: () => void }) {
  const { sheet, character, adjust } = useSheet()
  const { slots, pact } = sheet.spellcasting
  const { data: entry } = useRule(spell?.ruleId)
  const [choice, setChoice] = useState<string>('')

  if (!spell)
    return (
      <Modal open={false} onClose={onClose} title="Seslat kouzlo">
        {null}
      </Modal>
    )

  // Možnosti: běžné sloty od úrovně kouzla výš, pact slot (pokud jeho úroveň stačí) a rituál bez slotu.
  const options: { id: string; label: string }[] = []
  if (spell.level > 0) {
    for (const s of slots) {
      if (s.level >= spell.level && s.max - s.used > 0)
        options.push({
          id: `slot:${s.level}`,
          label: `Slot ${s.level}. úrovně (zbývá ${s.max - s.used})${s.level > spell.level ? ' – vyšší úroveň' : ''}`,
        })
    }
    if (pact && pact.level >= spell.level && pact.count - pact.used > 0)
      options.push({
        id: 'pact',
        label: `Pact slot ${pact.level}. úrovně (zbývá ${pact.count - pact.used})${pact.level > spell.level ? ' – vyšší úroveň' : ''}`,
      })
    if (spell.ritual) options.push({ id: 'ritual', label: 'Jako rituál (+10 minut, bez slotu)' })
  }
  const selected = spell.level === 0 ? 'free' : options.some((o) => o.id === choice) ? choice : (options[0]?.id ?? '')
  const upcastLevel = selected.startsWith('slot:') ? Number(selected.slice(5)) : selected === 'pact' ? (pact?.level ?? spell.level) : spell.level
  const currentFocus = character.state.concentration

  function cast() {
    if (!spell) return
    const ops: Parameters<typeof adjust>[0] = []
    if (selected.startsWith('slot:')) {
      const level = Number(selected.slice(5))
      const slot = slots.find((s) => s.level === level)
      if (slot) ops.push({ op: 'slot', level, delta: 1, max: slot.max })
    } else if (selected === 'pact' && pact) {
      ops.push({ op: 'pact', delta: 1, max: pact.count })
    }
    if (spell.concentration) ops.push({ op: 'concentration', set: spell.name })
    if (ops.length > 0) adjust(ops)
    toast.success(
      `${spell.name}${upcastLevel > spell.level ? ` (${upcastLevel}. úroveň)` : ''} seslán${spell.concentration ? '. Soustředíš se.' : '.'}`,
    )
    onClose()
  }

  return (
    <Modal open onClose={onClose} title={`Seslat: ${spell.name}`}>
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          {spell.level === 0 ? 'Cantrip' : `${spell.level}. úroveň`} · {spell.castingTime} · {spell.range}
        </p>

        {spell.level === 0 ? (
          <p>Cantripy nespotřebují slot.</p>
        ) : options.length === 0 ? (
          <p role="alert" className="text-destructive">
            Nemáš žádný volný slot, který by na toto kouzlo stačil.
          </p>
        ) : (
          <fieldset className="space-y-2">
            <legend className="mb-1 text-sm font-medium">Čím chceš kouzlo seslat?</legend>
            {options.map((o) => (
              <label
                key={o.id}
                className={cn(
                  'flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border p-3',
                  selected === o.id && 'border-primary bg-muted',
                )}
              >
                <input
                  type="radio"
                  name="slot-choice"
                  className="size-5 accent-primary"
                  checked={selected === o.id}
                  onChange={() => setChoice(o.id)}
                />
                <span>{o.label}</span>
              </label>
            ))}
          </fieldset>
        )}

        {upcastLevel > spell.level && entry && typeof entry.data.higher_level === 'string' && entry.data.higher_level && (
          <section className="space-y-1 rounded-lg border bg-muted/40 p-3">
            <h3 className="text-sm font-semibold">Na vyšší úrovni</h3>
            <DescriptionText text={entry.data.higher_level} />
          </section>
        )}

        {spell.concentration && currentFocus && currentFocus !== spell.name && (
          <p role="alert" className="text-sm text-amber-700 dark:text-amber-400">
            Koncentrace na {currentFocus} skončí, protože {spell.name} vyžaduje koncentraci.
          </p>
        )}

        <Button size="lg" className="w-full" onClick={cast} disabled={spell.level > 0 && options.length === 0}>
          Seslat
        </Button>
      </div>
    </Modal>
  )
}

function AddSpellDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { character, bundle } = useSheet()
  const classes = groupClasses(toEngineInput(character))
  const [classIdx, setClassIdx] = useState(classes[0]?.classIndex ?? '')
  const [q, setQ] = useState('')
  const [level, setLevel] = useState('')
  const add = useAddSpell(character.id)
  const className = bundle.classes[classIdx]?.name
  const rules = useRules({
    kinds: ['spell'],
    q: q.trim() || undefined,
    level: level || undefined,
    tag: className,
    campaignId: character.campaignId,
    sort: 'level',
  })
  const entries = rules.data?.pages.flatMap((p) => p.entries) ?? []
  const known = new Set(character.spells.filter((s) => s.classIdx === classIdx).map((s) => s.ruleId))

  return (
    <Modal open={open} onClose={onClose} title="Přidat kouzlo">
      <div className="space-y-3">
        <div className="space-y-2">
          <Label htmlFor="sp-class">Seznam kouzel třídy</Label>
          <NativeSelect id="sp-class" value={classIdx} onChange={(e) => setClassIdx(e.target.value)}>
            {classes.map((c) => (
              <option key={c.classIndex} value={c.classIndex}>
                {bundle.classes[c.classIndex]?.name ?? c.classIndex}
              </option>
            ))}
            <option value="">Mimo třídu (rasa, item, ...)</option>
          </NativeSelect>
        </div>
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <Input type="search" aria-label="Hledat kouzlo" placeholder="Hledat podle názvu…" value={q} onChange={(e) => setQ(e.target.value)} />
          <NativeSelect aria-label="Úroveň kouzla" className="w-36" value={level} onChange={(e) => setLevel(e.target.value)}>
            <option value="">Všechny</option>
            {Array.from({ length: 10 }, (_, i) => (
              <option key={i} value={i}>
                {i === 0 ? 'Cantrip' : `Level ${i}`}
              </option>
            ))}
          </NativeSelect>
        </div>
        <ul className="scroll-area max-h-[45dvh] space-y-2 pr-2">
          {entries.map((e) => (
            <li key={e.id} className="flex items-center justify-between gap-2 rounded-lg border p-2">
              <span className="min-w-0">
                <span className="block truncate font-medium">{e.name}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {(e.level ?? 0) === 0 ? 'Cantrip' : `Level ${e.level}`} · {e.category}
                  {e.isHomebrew ? ' · homebrew' : ''}
                </span>
              </span>
              <Button
                variant="secondary"
                disabled={add.isPending || known.has(e.id)}
                aria-label={`Přidat ${e.name}`}
                onClick={() =>
                  add.mutate(
                    { ruleId: e.id, classIdx },
                    {
                      onSuccess: () => toast.success(`Přidáno: ${e.name}`),
                      onError: (err) => toast.error(err instanceof ApiError ? err.message : 'Přidání se nepodařilo.'),
                    },
                  )
                }
              >
                {known.has(e.id) ? 'Už má' : 'Přidat'}
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
      </div>
    </Modal>
  )
}
