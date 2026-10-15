import { useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { CameraIcon, PlusIcon, Trash2Icon, XIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Modal } from '@/components/ui/modal'
import { NativeSelect } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { Avatar } from './Avatar'
import { PhotoCropper } from './PhotoCropper'
import { useDeleteCharacter, useDeletePhoto, useRevertLevel, useUploadPhoto } from './api'
import { useSheet } from './sheet-context'
import { ALIGNMENTS } from './labels'
import { COMMON_LANGUAGES, MAX_LANGUAGE_LENGTH, languagesOf, withLanguage, withoutLanguage } from './languages'

export function ProfileTab() {
  const { character, canEdit, isDm, update } = useSheet()
  return (
    <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
      <div className="space-y-6">
        <PhotoCard />
        {canEdit && <DetailsForm key={character.rev} />}
        {canEdit && <LanguagesCard />}
      </div>
      <div className="space-y-6">
        {canEdit && <PersonalityForm key={`p${character.rev}`} />}
        {isDm && (
          <Card>
            <CardHeader>
              <CardTitle>Viditelnost pro hráče</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Label htmlFor="visibility">{character.kind === 'npc' ? 'Co vidí hráči u tohoto NPC' : 'Co vidí ostatní hráči'}</Label>
              <NativeSelect
                id="visibility"
                value={character.visibility}
                onChange={(e) => update({ visibility: e.target.value as 'public_only' | 'full' })}
              >
                <option value="public_only">Jen veřejný náhled (jméno, fotka, rasa, třída, level)</option>
                <option value="full">Celý sheet (jen ke čtení)</option>
              </NativeSelect>
            </CardContent>
          </Card>
        )}
        <LevelHistoryCard />
        {canEdit && <DangerCard />}
      </div>
    </div>
  )
}

/** Jazyky postavy. Hráči, kteří sdílejí jazyk, si v Zprávách můžou psát tak, že to nikdo jiný (ani DM) nevidí. */
function LanguagesCard() {
  const { character, update } = useSheet()
  const [name, setName] = useState('')
  const languages = languagesOf(character.extraProficiencies)

  function add(e: FormEvent) {
    e.preventDefault()
    const next = withLanguage(character.extraProficiencies, name)
    if (next !== character.extraProficiencies) update({ extraProficiencies: next })
    setName('')
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Jazyky</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {languages.length === 0 ? (
          <p className="text-sm text-muted-foreground">Zatím žádný jazyk.</p>
        ) : (
          <ul aria-label="Znám jazyky" className="flex flex-wrap gap-2">
            {languages.map((l) => (
              <li key={l} className="flex items-center rounded-full border pl-3">
                {l}
                <button
                  type="button"
                  aria-label={`Odebrat jazyk ${l}`}
                  className="inline-flex size-11 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
                  onClick={() => update({ extraProficiencies: withoutLanguage(character.extraProficiencies, l) })}
                >
                  <XIcon aria-hidden className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <form onSubmit={add} className="flex gap-2">
          <Label htmlFor="pf-language" className="sr-only">
            Přidat jazyk
          </Label>
          <Input id="pf-language" list="pf-language-options" maxLength={MAX_LANGUAGE_LENGTH} placeholder="Přidat jazyk (např. Orc)" value={name} onChange={(e) => setName(e.target.value)} />
          <datalist id="pf-language-options">
            {COMMON_LANGUAGES.filter((l) => !languages.some((x) => x.toLowerCase() === l.toLowerCase())).map((l) => (
              <option key={l} value={l} />
            ))}
          </datalist>
          <Button type="submit" variant="secondary" disabled={name.trim() === ''}>
            <PlusIcon aria-hidden /> Přidat
          </Button>
        </form>
        <p className="text-xs text-muted-foreground">Když stejný jazyk umí i jiný hráč, můžete si v Zprávách psát tak, že to nikdo jiný (ani DM) neuvidí.</p>
      </CardContent>
    </Card>
  )
}

function PhotoCard() {
  const { character, canEdit } = useSheet()
  const [file, setFile] = useState<File | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const upload = useUploadPhoto(character.id)
  const remove = useDeletePhoto(character.id)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Fotka</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-4">
        <Avatar id={character.id} name={character.name} version={character.photoVersion} className="size-28 text-4xl" />
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <input
              ref={input}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              className="sr-only"
              aria-label="Vybrat fotku postavy"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null)
                e.target.value = ''
              }}
            />
            <Button variant="secondary" onClick={() => input.current?.click()}>
              <CameraIcon aria-hidden /> {character.photoVersion ? 'Změnit fotku' : 'Nahrát fotku'}
            </Button>
            {character.photoVersion && (
              <Button
                variant="outline"
                onClick={() => remove.mutate(undefined, { onError: () => toast.error('Fotku se nepodařilo odstranit') })}
                disabled={remove.isPending}
              >
                Odstranit
              </Button>
            )}
          </div>
        )}
      </CardContent>
      <Modal open={file !== null} onClose={() => setFile(null)} title="Ořez fotky">
        {file && (
          <PhotoCropper
            file={file}
            pending={upload.isPending}
            onCancel={() => setFile(null)}
            onDone={(blob) =>
              upload.mutate(blob, {
                onSuccess: () => {
                  toast.success('Fotka nahrána')
                  setFile(null)
                },
                onError: (e) => toast.error(e.message),
              })
            }
          />
        )}
      </Modal>
    </Card>
  )
}

function DetailsForm() {
  const { character, update } = useSheet()
  const [form, setForm] = useState({
    name: character.name,
    race: character.race,
    subrace: character.subrace,
    background: character.background,
    alignment: character.alignment,
    baseSpeed: String(character.baseSpeed),
    description: character.description,
  })
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }))

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    const speed = Number.parseInt(form.baseSpeed, 10)
    update({
      name: form.name.trim(),
      race: form.race,
      subrace: form.subrace,
      background: form.background,
      alignment: form.alignment,
      description: form.description,
      baseSpeed: Number.isFinite(speed) ? speed : 30,
    })
    toast.success('Uloženo')
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Základní údaje</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <Field id="pf-name" label="Jméno">
            <Input id="pf-name" required maxLength={100} value={form.name} onChange={(e) => set('name', e.target.value)} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="pf-race" label="Rasa">
              <Input id="pf-race" maxLength={100} value={form.race} onChange={(e) => set('race', e.target.value)} />
            </Field>
            <Field id="pf-subrace" label="Subrasa">
              <Input id="pf-subrace" maxLength={100} value={form.subrace} onChange={(e) => set('subrace', e.target.value)} />
            </Field>
            <Field id="pf-bg" label="Background">
              <Input id="pf-bg" maxLength={100} placeholder="nedoplněno" value={form.background} onChange={(e) => set('background', e.target.value)} />
            </Field>
            <Field id="pf-align" label="Alignment">
              <NativeSelect id="pf-align" value={form.alignment} onChange={(e) => set('alignment', e.target.value)}>
                <option value="">nedoplněno</option>
                {ALIGNMENTS.map((a) => (
                  <option key={a}>{a}</option>
                ))}
              </NativeSelect>
            </Field>
            <Field id="pf-speed" label="Základní rychlost (ft)">
              <Input
                id="pf-speed"
                type="number"
                inputMode="numeric"
                min={0}
                max={200}
                value={form.baseSpeed}
                onChange={(e) => set('baseSpeed', e.target.value)}
              />
            </Field>
          </div>
          <Field id="pf-desc" label="Vzhled a popis">
            <Textarea id="pf-desc" rows={4} maxLength={20000} value={form.description} onChange={(e) => set('description', e.target.value)} />
          </Field>
          <Button type="submit">Uložit</Button>
        </form>
      </CardContent>
    </Card>
  )
}

function PersonalityForm() {
  const { character, update } = useSheet()
  const [p, setP] = useState(character.personality)
  const [notes, setNotes] = useState(character.notes)
  return (
    <Card>
      <CardHeader>
        <CardTitle>Osobnost a poznámky</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            update({ personality: p, notes })
            toast.success('Uloženo')
          }}
        >
          {(
            [
              ['traits', 'Povahové rysy (traits)'],
              ['ideals', 'Ideály'],
              ['bonds', 'Pouta (bonds)'],
              ['flaws', 'Slabiny (flaws)'],
            ] as const
          ).map(([key, label]) => (
            <Field key={key} id={`pers-${key}`} label={label}>
              <Textarea
                id={`pers-${key}`}
                rows={2}
                className="min-h-16"
                maxLength={2000}
                value={p[key]}
                onChange={(e) => setP((x) => ({ ...x, [key]: e.target.value }))}
              />
            </Field>
          ))}
          <Field id="pf-notes" label="Soukromé poznámky">
            <Textarea id="pf-notes" rows={5} maxLength={20000} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          <Button type="submit">Uložit</Button>
        </form>
      </CardContent>
    </Card>
  )
}

function DangerCard() {
  const { character } = useSheet()
  const navigate = useNavigate()
  const remove = useDeleteCharacter(character.id, character.campaignId)
  return (
    <Card>
      <CardHeader>
        <CardTitle>Nebezpečná zóna</CardTitle>
      </CardHeader>
      <CardContent>
        <Button
          variant="destructive"
          disabled={remove.isPending}
          onClick={() => {
            if (!window.confirm(`Smazat postavu „${character.name}“ včetně všech dat? Tohle nejde vrátit.`)) return
            remove.mutate(undefined, {
              onSuccess: () => void navigate(`/campaigns/${character.campaignId}`),
              onError: () => toast.error('Postavu se nepodařilo smazat'),
            })
          }}
        >
          <Trash2Icon aria-hidden /> Smazat postavu
        </Button>
      </CardContent>
    </Card>
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

function LevelHistoryCard() {
  const { character, bundle, canEdit } = useSheet()
  const revert = useRevertLevel(character.id)
  const nameOf = (idx: string) => bundle.classes[idx]?.name ?? idx
  const perClass: Record<string, number> = {}
  const rows = character.levels.map((l, i) => {
    perClass[l.classIndex] = (perClass[l.classIndex] ?? 0) + 1
    const c = l.choices as {
      hpGain?: number
      subclass?: string
      asi?: Record<string, number>
      feat?: { name: string }
      spellsAdded?: number
      spellsRemoved?: number
      note?: string
    }
    const parts: string[] = []
    if (i === 0) parts.push('plné HP (první level)')
    else parts.push(l.hpRoll === null ? 'HP: průměr' : `HP: hod ${l.hpRoll}`)
    if (c.subclass) parts.push(`subclass: ${bundle.subclasses[c.subclass]?.name ?? c.subclass}`)
    if (c.asi)
      parts.push(
        Object.entries(c.asi)
          .map(([a, v]) => `${a.toUpperCase()} +${v}`)
          .join(', '),
      )
    if (c.feat) parts.push(`feat: ${c.feat.name}`)
    if (c.spellsAdded) parts.push(`+${c.spellsAdded} kouzel`)
    if (c.spellsRemoved) parts.push(`−${c.spellsRemoved} kouzel`)
    return { n: i + 1, title: `${nameOf(l.classIndex)} ${perClass[l.classIndex]}`, parts, note: c.note }
  })
  return (
    <Card>
      <CardHeader>
        <CardTitle>Historie levelů</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <ol className="space-y-2">
          {[...rows].reverse().map((r) => (
            <li key={r.n} className="rounded-lg border p-3 text-sm">
              <p className="font-medium">
                Level {r.n}: {r.title}
              </p>
              <p className="text-muted-foreground">{r.parts.join(' · ')}</p>
              {r.note && <p className="mt-1 whitespace-pre-line text-muted-foreground">{r.note}</p>}
            </li>
          ))}
        </ol>
        {canEdit && character.levels.length > 1 && (
          <Button
            variant="destructive"
            disabled={revert.isPending}
            onClick={() => {
              if (
                !window.confirm(
                  `Vrátit poslední level (level ${character.levels.length})? Vrátí se i změny vlastností, subclassu, kouzel a HP z tohoto level upu.`,
                )
              )
                return
              revert.mutate(undefined, { onSuccess: () => toast.success('Level vrácen'), onError: () => toast.error('Level se nepodařilo vrátit') })
            }}
          >
            Vrátit poslední level
          </Button>
        )}
      </CardContent>
    </Card>
  )
}
