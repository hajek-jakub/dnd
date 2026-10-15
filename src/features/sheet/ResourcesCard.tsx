import { useState, type FormEvent } from 'react'
import { PlusIcon, Trash2Icon } from 'lucide-react'
import { groupClasses, spellSlots } from '@/engine'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Modal } from '@/components/ui/modal'
import { NativeSelect } from '@/components/ui/native-select'
import { ComputedValue } from './ComputedValue'
import { useSheet } from './sheet-context'
import { toEngineInput } from './model'
import { Stepper } from './Stepper'
import { RECHARGE_LABELS } from './labels'

export function ResourcesCard() {
  const { sheet, character, bundle, canEdit, adjust, update } = useSheet()
  const { slots, pact } = sheet.spellcasting
  const baseSlots = spellSlots(bundle, groupClasses(toEngineInput(character)))
  const [adding, setAdding] = useState(false)

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <CardTitle>Zdroje a sloty</CardTitle>
        {canEdit && (
          <Button variant="outline" onClick={() => setAdding(true)}>
            <PlusIcon aria-hidden /> Vlastní zdroj
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {slots.length === 0 && !pact && sheet.resources.length === 0 && (
          <p className="text-sm text-muted-foreground">Zatím žádné zdroje. Přidej vlastní, třeba náboje nebo kouzelné předměty s nábojem.</p>
        )}

        {slots.length > 0 && (
          <section aria-label="Spell sloty" className="space-y-1">
            <h3 className="text-sm font-medium text-muted-foreground">Spell sloty (zbývající / celkem)</h3>
            {slots.map((s) => (
              <div key={s.level} className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-1 text-sm">
                  {s.level}. úroveň
                  <ComputedValue
                    title={`Sloty ${s.level}. úrovně: maximum`}
                    computed={{
                      value: s.max,
                      base: baseSlots[s.level - 1] ?? 0,
                      overridden: `slots.${s.level}` in character.overrides,
                      sources: [{ label: 'Tabulka pro tvoje třídy', value: baseSlots[s.level - 1] ?? 0 }],
                    }}
                    overrideKey={`slots.${s.level}`}
                    className="min-h-11 text-xs text-muted-foreground"
                  >
                    <span>max {s.max}</span>
                  </ComputedValue>
                </span>
                <Stepper
                  label={`Sloty ${s.level}. úrovně`}
                  value={s.max - s.used}
                  max={s.max}
                  disabled={!canEdit}
                  minusLabel={`Použít slot ${s.level}. úrovně`}
                  plusLabel={`Vrátit slot ${s.level}. úrovně`}
                  onDelta={(d) => adjust([{ op: 'slot', level: s.level, delta: -d, max: s.max }])}
                />
              </div>
            ))}
          </section>
        )}

        {pact && (
          <section aria-label="Pact magic" className="space-y-1">
            <h3 className="text-sm font-medium text-muted-foreground">Pact Magic (obnova na short rest)</h3>
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm">Sloty {pact.level}. úrovně</span>
              <Stepper
                label="Pact sloty"
                value={pact.count - pact.used}
                max={pact.count}
                disabled={!canEdit}
                minusLabel="Použít pact slot"
                plusLabel="Vrátit pact slot"
                onDelta={(d) => adjust([{ op: 'pact', delta: -d, max: pact.count }])}
              />
            </div>
          </section>
        )}

        {sheet.resources.length > 0 && (
          <section aria-label="Zdroje" className="space-y-1">
            <h3 className="text-sm font-medium text-muted-foreground">Zdroje</h3>
            {sheet.resources.map((r) => (
              <div key={r.key} className="flex items-center justify-between gap-3">
                <span className="min-w-0 text-sm">
                  <span className="flex items-center gap-1">
                    {r.name}
                    <ComputedValue
                      title={`${r.name}: maximum`}
                      computed={r.max}
                      overrideKey={`resource.${r.key}.max`}
                      className="min-h-11 text-xs text-muted-foreground"
                    >
                      <span>max {r.max.value}</span>
                    </ComputedValue>
                  </span>
                  <span className="block text-xs text-muted-foreground">obnova: {RECHARGE_LABELS[r.recharge]}</span>
                </span>
                <div className="flex items-center gap-1">
                  <Stepper
                    label={r.name}
                    value={r.current}
                    max={r.max.value}
                    disabled={!canEdit}
                    minusLabel={`${r.name}: použít`}
                    plusLabel={`${r.name}: vrátit`}
                    onDelta={(d) => adjust([{ op: 'resource', key: r.key, delta: d, max: r.max.value }])}
                  />
                  {r.custom && canEdit && (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Smazat zdroj ${r.name}`}
                      onClick={() => {
                        if (window.confirm(`Smazat vlastní zdroj „${r.name}“?`))
                          update({ customResources: character.customResources.filter((c) => c.key !== r.key) })
                      }}
                    >
                      <Trash2Icon aria-hidden />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </section>
        )}
      </CardContent>
      <AddResourceDialog open={adding} onClose={() => setAdding(false)} />
    </Card>
  )
}

function AddResourceDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { character, update } = useSheet()
  const [name, setName] = useState('')
  const [max, setMax] = useState('3')
  const [recharge, setRecharge] = useState<'short' | 'long' | 'dawn' | 'manual'>('long')

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    const maxNumber = Number.parseInt(max, 10)
    if (!name.trim() || !(maxNumber >= 0)) return
    const key = `custom.${Date.now().toString(36)}`
    update({ customResources: [...character.customResources, { key, name: name.trim(), max: maxNumber, recharge }] })
    setName('')
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title="Nový vlastní zdroj">
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="res-name">Název</Label>
          <Input id="res-name" required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} placeholder="Např. Náboje do kuše" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="res-max">Maximum</Label>
            <Input id="res-max" type="number" inputMode="numeric" min={0} max={9999} required value={max} onChange={(e) => setMax(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="res-recharge">Obnova</Label>
            <NativeSelect id="res-recharge" value={recharge} onChange={(e) => setRecharge(e.target.value as typeof recharge)}>
              {Object.entries(RECHARGE_LABELS).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </NativeSelect>
          </div>
        </div>
        <Button type="submit" className="w-full" disabled={!name.trim()}>
          Přidat
        </Button>
      </form>
    </Modal>
  )
}
