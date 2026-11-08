import { useState, type FormEvent } from 'react'
import { PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import { FormattingTextarea } from '@/components/FormattingTextarea'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Modal } from '@/components/ui/modal'
import { DescriptionText } from '@/features/rules/DescriptionText'
import { useSheet } from './sheet-context'
import type { CustomFeature } from './types'

const newId = () => crypto.randomUUID()

/** Vlastní featury, které engine nezná: manévry Battle Mastera, schopnosti z rasy, od DM, homebrew. */
export function CustomFeaturesCard() {
  const { character, canEdit, update } = useSheet()
  const features = character.customFeatures ?? []
  // null = zavřeno, 'new' = nová featura, jinak upravovaná
  const [editing, setEditing] = useState<CustomFeature | 'new' | null>(null)
  if (features.length === 0 && !canEdit) return null

  const save = (next: CustomFeature[]) => update({ customFeatures: next })

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
        <div>
          <CardTitle>Vlastní featury</CardTitle>
          <p className="text-sm text-muted-foreground">Manévry, schopnosti z rasy nebo od DM, které aplikace sama nezná.</p>
        </div>
        {canEdit && (
          <Button variant="secondary" onClick={() => setEditing('new')}>
            <PlusIcon aria-hidden /> Přidat featuru
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-2">
        {features.length === 0 && <p className="text-sm text-muted-foreground">Zatím žádné. Třeba manévr Battle Mastera: Trip Attack, Riposte…</p>}
        {features.map((f) => (
          <details key={f.id} className="rounded-lg border" data-testid="custom-feature">
            <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-3 px-3 py-2 font-medium">
              <span>{f.name}</span>
              {f.source && <span className="text-xs font-normal text-muted-foreground">{f.source}</span>}
            </summary>
            <div className="space-y-3 border-t px-3 py-3 text-sm">
              {f.description ? <DescriptionText text={f.description} /> : <p className="text-muted-foreground">Bez popisu.</p>}
              {canEdit && (
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" onClick={() => setEditing(f)}>
                    <PencilIcon aria-hidden /> Upravit
                  </Button>
                  <Button
                    variant="outline"
                    aria-label={`Smazat featuru ${f.name}`}
                    onClick={() => {
                      if (window.confirm(`Smazat featuru „${f.name}“?`)) save(features.filter((x) => x.id !== f.id))
                    }}
                  >
                    <Trash2Icon aria-hidden /> Smazat
                  </Button>
                </div>
              )}
            </div>
          </details>
        ))}
      </CardContent>
      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing === 'new' ? 'Nová featura' : 'Upravit featuru'}>
        {editing !== null && (
          <FeatureForm
            feature={editing === 'new' ? undefined : editing}
            onCancel={() => setEditing(null)}
            onSubmit={(f) => {
              save(editing === 'new' ? [...features, f] : features.map((x) => (x.id === f.id ? f : x)))
              setEditing(null)
            }}
          />
        )}
      </Modal>
    </Card>
  )
}

function FeatureForm({ feature, onSubmit, onCancel }: { feature?: CustomFeature; onSubmit: (f: CustomFeature) => void; onCancel: () => void }) {
  const [name, setName] = useState(feature?.name ?? '')
  const [source, setSource] = useState(feature?.source ?? '')
  const [description, setDescription] = useState(feature?.description ?? '')

  function submit(e: FormEvent) {
    e.preventDefault()
    if (name.trim() === '') return
    onSubmit({ id: feature?.id ?? newId(), name: name.trim(), source: source.trim(), description })
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="cf-name">Název</Label>
        <Input id="cf-name" required maxLength={100} value={name} placeholder="Trip Attack" onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="cf-source">Odkud (nepovinné)</Label>
        <Input id="cf-source" maxLength={60} value={source} placeholder="Battle Master: manévr" onChange={(e) => setSource(e.target.value)} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="cf-desc">Popis</Label>
        <FormattingTextarea
          id="cf-desc"
          rows={5}
          maxLength={4000}
          value={description}
          onChange={setDescription}
          placeholder="Po zásahu utratíš superiority die: +1d8 ke zranění a cíl (Large a menší) hází STR save, jinak padne Prone."
          renderPreview={(text) => <DescriptionText text={text} />}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={name.trim() === ''}>
          Uložit
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          Zrušit
        </Button>
      </div>
    </form>
  )
}
