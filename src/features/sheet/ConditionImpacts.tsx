import { useSheet } from './sheet-context'

/** Co stavy postavy znamenají (nevýhoda, rychlost 0, ...). Hody a hodnoty výše se podle nich upraví samy. */
export function ConditionImpacts() {
  const { sheet } = useSheet()
  const { impacts, incapacitated } = sheet.conditions
  if (impacts.length === 0) return null
  return (
    <section aria-label="Dopady stavů" data-testid="condition-impacts" className="space-y-1 rounded-xl border border-amber-500/60 bg-amber-500/5 p-3 text-sm">
      <h2 className="font-display text-xs font-semibold tracking-wider text-muted-foreground uppercase">Dopady stavů</h2>
      <ul className="space-y-1">
        {impacts.map((i) => (
          <li key={i.condition}>
            <strong>{i.condition}:</strong> {i.text}
          </li>
        ))}
      </ul>
      {incapacitated.length > 0 && <p className="text-xs text-muted-foreground">Neschopný jednat: {incapacitated.join(', ')}.</p>}
      <p className="text-xs text-muted-foreground">Červená tečka u kostky = nevýhoda ze stavu, zelená = výhoda. Hod se nastaví sám.</p>
    </section>
  )
}
