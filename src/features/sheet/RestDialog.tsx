import { useState } from 'react'
import { MoonIcon, SunIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { longRest, shortRest, type CharacterState as EngineState } from '@/engine'
import { useExpireLongRestEffects } from './api'
import { useSheet } from './sheet-context'

function roll(sides: number): number {
  const buffer = new Uint32Array(1)
  // Rovnoměrné rozdělení bez zkreslení (odmítnutí hodnot z "ocasu").
  const limit = Math.floor(0x100000000 / sides) * sides
  do crypto.getRandomValues(buffer)
  while ((buffer[0] ?? 0) >= limit)
  return ((buffer[0] ?? 0) % sides) + 1
}

/** Short rest (včetně utrácení hit dice s hodem) a long rest. */
export function RestButtons() {
  const [mode, setMode] = useState<'short' | 'long' | null>(null)
  const { canEdit } = useSheet()
  if (!canEdit) return null
  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        <Button variant="secondary" size="lg" onClick={() => setMode('short')}>
          <SunIcon aria-hidden /> Short rest
        </Button>
        <Button variant="secondary" size="lg" onClick={() => setMode('long')}>
          <MoonIcon aria-hidden /> Long rest
        </Button>
      </div>
      <ShortRestDialog open={mode === 'short'} onClose={() => setMode(null)} />
      <LongRestDialog open={mode === 'long'} onClose={() => setMode(null)} />
    </>
  )
}

function engineState(character: ReturnType<typeof useSheet>['character'], hpCurrent: number): EngineState {
  return { ...character.state, hpCurrent }
}

function ShortRestDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { sheet, character, hpCurrent, adjust, update } = useSheet()
  const [log, setLog] = useState<string[]>([])
  const conMod = sheet.abilities.con.modifier
  const max = sheet.hp.max.value

  function spend(die: string, total: number) {
    const sides = Number(die.slice(1))
    const rolled = roll(sides)
    const heal = Math.max(0, rolled + conMod)
    const actual = Math.min(heal, max - hpCurrent)
    adjust([
      { op: 'hitDie', die, delta: 1, max: total },
      { op: 'hp', delta: heal, max },
    ])
    setLog((l) => [
      ...l,
      `${die}: hozeno ${rolled} ${conMod >= 0 ? '+' : '−'} ${Math.abs(conMod)} (CON) = ${heal} HP${actual < heal ? ` (vyléčeno ${actual}, víc nejde)` : ''}`,
    ])
  }

  function finish() {
    const next = shortRest(engineState(character, hpCurrent), sheet)
    update({ state: { ...character.state, ...next, hpCurrent: next.hpCurrent } })
    setLog([])
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        setLog([])
        onClose()
      }}
      title="Short rest"
    >
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Můžeš utratit hit dice a vyléčit se. Na konci se obnoví zdroje s obnovou na short rest a pact sloty.
        </p>
        <p className="text-sm">
          HP: <strong>{hpCurrent}</strong> / {max}
        </p>
        <ul className="space-y-2">
          {sheet.hitDice.map((d) => (
            <li key={d.die} className="flex items-center justify-between gap-3">
              <span>
                {d.die}: zbývá <strong>{d.remaining}</strong> z {d.total}
              </span>
              <Button variant="outline" disabled={d.remaining <= 0 || hpCurrent >= max} onClick={() => spend(d.die, d.total)}>
                Utratit {d.die}
              </Button>
            </li>
          ))}
        </ul>
        {log.length > 0 && (
          <ul aria-label="Průběh" className="space-y-1 rounded-lg border bg-muted/40 p-3 text-sm">
            {log.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        )}
        <Button size="lg" className="w-full" onClick={finish}>
          Dokončit short rest
        </Button>
      </div>
    </Modal>
  )
}

function LongRestDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { sheet, character, hpCurrent, update } = useSheet()
  const expire = useExpireLongRestEffects(character.id)
  function confirm() {
    const next = longRest(engineState(character, hpCurrent), sheet)
    update({ state: { ...character.state, ...next } })
    // Bonusy "do long restu" od DM zmizí.
    if (character.effects.some((e) => e.duration === 'long_rest')) expire.mutate()
    onClose()
  }
  return (
    <Modal open={open} onClose={onClose} title="Long rest">
      <div className="space-y-4">
        <ul className="list-disc space-y-1 pl-5 text-sm">
          <li>Plné HP, dočasná HP se ztratí, death saves se vynulují</li>
          <li>Všechny spell sloty a pact sloty se obnoví</li>
          <li>Zdroje s obnovou na short/long rest/úsvit se obnoví (ruční ne)</li>
          <li>Vrátí se polovina hit dice (aspoň jedna)</li>
          <li>Bonusy od DM s trváním „do long restu“ skončí</li>
        </ul>
        <Button size="lg" className="w-full" onClick={confirm}>
          Dát si long rest
        </Button>
      </div>
    </Modal>
  )
}
