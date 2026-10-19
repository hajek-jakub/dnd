import { useState, type FormEvent } from 'react'
import { ArrowLeftIcon, CastleIcon, CoinsIcon, CrownIcon, ScrollTextIcon, StoreIcon, SwordsIcon, XIcon, type LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { AI_TEMPLATES, defaults, missing, type AiTemplate, type TemplateValues } from './templates'

const ICONS: Record<string, LucideIcon> = { dungeon: CastleIcon, encounter: SwordsIcon, shop: StoreIcon, treasure: CoinsIcon, boss: CrownIcon, rules: ScrollTextIcon }

/** Výběr šablony a její políčka; „Vložit do zprávy“ předá složený text (DM ho může před odesláním upravit). */
export function TemplatePanel({ onInsert, onClose }: { onInsert: (text: string) => void; onClose?: () => void }) {
  const [chosen, setChosen] = useState<AiTemplate | null>(null)
  if (chosen) return <TemplateForm template={chosen} onBack={() => setChosen(null)} onInsert={onInsert} />
  return (
    <section aria-label="Šablony" className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Šablony</h3>
        {onClose && (
          <Button variant="ghost" size="icon" aria-label="Zavřít šablony" onClick={onClose}>
            <XIcon aria-hidden />
          </Button>
        )}
      </div>
      <ul className="grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-2">
        {AI_TEMPLATES.map((t) => {
          const Icon = ICONS[t.id] ?? ScrollTextIcon
          return (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => setChosen(t)}
                aria-label={`Šablona: ${t.title}`}
                className="flex min-h-11 w-full items-start gap-3 rounded-lg border bg-card px-3 py-2 text-left hover:bg-muted"
              >
                <Icon aria-hidden className="mt-0.5 size-5 shrink-0 text-primary" />
                <span className="min-w-0">
                  <span className="block font-medium">{t.title}</span>
                  <span className="block text-xs text-muted-foreground">{t.description}</span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function TemplateForm({ template, onBack, onInsert }: { template: AiTemplate; onBack: () => void; onInsert: (text: string) => void }) {
  const [values, setValues] = useState<TemplateValues>(() => defaults(template))
  const lack = missing(template, values)
  const set = (key: string, value: string | number | boolean) => setValues((v) => ({ ...v, [key]: value }))

  function submit(e: FormEvent) {
    e.preventDefault()
    if (lack) return
    onInsert(template.compose(values))
  }

  return (
    <form aria-label={`Šablona: ${template.title}`} onSubmit={submit} className="space-y-3 rounded-xl border bg-card p-3">
      <div className="flex items-center gap-2">
        <Button type="button" variant="ghost" size="icon" aria-label="Zpět na šablony" onClick={onBack}>
          <ArrowLeftIcon aria-hidden />
        </Button>
        <h3 className="font-semibold">{template.title}</h3>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2">
        {template.fields.map((f) => {
          const id = `tpl-${template.id}-${f.key}`
          if (f.type === 'checkbox') {
            return (
              <label key={f.key} className="flex min-h-11 cursor-pointer items-center gap-3 text-sm sm:col-span-2">
                <input type="checkbox" className="size-5" checked={Boolean(values[f.key])} onChange={(e) => set(f.key, e.target.checked)} />
                <span>{f.label}</span>
              </label>
            )
          }
          return (
            <div key={f.key} className="space-y-1">
              <Label htmlFor={id}>{f.label}</Label>
              {f.type === 'select' ? (
                <NativeSelect id={id} value={String(values[f.key])} onChange={(e) => set(f.key, e.target.value)}>
                  {f.options.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </NativeSelect>
              ) : f.type === 'number' ? (
                <Input
                  id={id}
                  type="number"
                  inputMode="numeric"
                  min={f.min}
                  max={f.max}
                  value={String(values[f.key])}
                  onChange={(e) => set(f.key, Math.min(f.max, Math.max(f.min, Number.parseInt(e.target.value, 10) || f.min)))}
                />
              ) : (
                <Input id={id} value={String(values[f.key])} maxLength={200} placeholder={f.placeholder} onChange={(e) => set(f.key, e.target.value)} />
              )}
            </div>
          )
        })}
      </div>
      {lack && <p className="text-sm text-muted-foreground">Vyplň: {lack}</p>}
      <Button type="submit" disabled={lack !== null}>
        Vložit do zprávy
      </Button>
    </form>
  )
}
