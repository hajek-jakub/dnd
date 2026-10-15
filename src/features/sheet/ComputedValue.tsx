import { useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Modal } from '@/components/ui/modal'
import { cn } from '@/lib/utils'
import type { Computed } from '@/engine'
import { useSheet } from './sheet-context'

/**
 * Dopočítaná hodnota. Klepnutí ukáže, z čeho se skládá, a (pokud smíš) dovolí hodnotu ručně přepsat.
 * Přepsaná hodnota je viditelně označená a jde jedním tlačítkem vrátit k výpočtu.
 */
export function ComputedValue({
  title,
  computed,
  overrideKey,
  format = (n) => String(n),
  className,
  children,
}: {
  title: string
  computed: Computed
  overrideKey: string
  format?: (n: number) => string
  className?: string
  /** Vlastní obsah tlačítka místo samotné hodnoty. */
  children?: ReactNode
}) {
  const { canEdit, setOverride } = useSheet()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')

  function openDialog() {
    setDraft(String(computed.value))
    setOpen(true)
  }

  const draftNumber = Number(draft.replace(',', '.'))
  const draftValid = draft.trim() !== '' && Number.isFinite(draftNumber)

  return (
    <>
      <button
        type="button"
        onClick={openDialog}
        aria-label={`${title}: ${format(computed.value)}${computed.overridden ? ' (přepsáno ručně)' : ''}. Zobrazit detail`}
        className={cn('relative inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg transition-colors hover:bg-muted', className)}
      >
        {children ?? <span className="font-semibold tabular-nums">{format(computed.value)}</span>}
        {computed.overridden && (
          <span aria-hidden className="absolute -top-1 -right-1 rounded-full bg-amber-500 px-1.5 text-[10px] leading-4 font-bold text-black">
            ručně
          </span>
        )}
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title={title}>
        <div className="space-y-4">
          <p className="text-3xl font-bold tabular-nums">
            {format(computed.value)}
            {computed.overridden && (
              <span className="ml-2 rounded-full bg-amber-500 px-2 py-0.5 align-middle text-xs font-bold text-black">přepsáno ručně</span>
            )}
          </p>

          <section aria-label="Z čeho se hodnota skládá">
            <h3 className="mb-1 text-sm font-medium text-muted-foreground">Podle pravidel: {format(computed.base)}</h3>
            <ul className="divide-y rounded-lg border text-sm">
              {computed.sources.map((s, i) => (
                <li key={i} className="flex justify-between gap-3 px-3 py-2">
                  <span>{s.label}</span>
                  <span className="font-medium tabular-nums">{s.value}</span>
                </li>
              ))}
            </ul>
          </section>

          {canEdit ? (
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault()
                if (!draftValid) return
                setOverride(overrideKey, draftNumber)
                setOpen(false)
              }}
            >
              <div className="space-y-2">
                <Label htmlFor={`override-${overrideKey}`}>Přepsat hodnotu</Label>
                <Input
                  id={`override-${overrideKey}`}
                  type="number"
                  inputMode="numeric"
                  step="any"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                />
                <p className="text-sm text-muted-foreground">Pravidla mají výjimky: hodnotu můžeš přepsat, výpočet zůstane k dispozici.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="submit" disabled={!draftValid}>
                  Přepsat
                </Button>
                {computed.overridden && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setOverride(overrideKey, null)
                      setOpen(false)
                    }}
                  >
                    Vrátit k výpočtu ({format(computed.base)})
                  </Button>
                )}
              </div>
            </form>
          ) : (
            <p className="text-sm text-muted-foreground">Tuhle postavu nemůžeš upravovat.</p>
          )}
        </div>
      </Modal>
    </>
  )
}
