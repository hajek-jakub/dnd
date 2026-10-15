import { formatModifier } from '@/engine'
import { RollButton } from '@/features/dice/RollButton'
import { d20 } from '@/features/dice/format'
import { ComputedValue } from './ComputedValue'
import { useSheet } from './sheet-context'

/** Klíčové hodnoty na jednom místě: AC, iniciativa, rychlost, proficiency, pasivní vnímání. */
export function StatsCard() {
  const { sheet } = useSheet()
  return (
    <section aria-label="Klíčové hodnoty" className="grid grid-cols-3 gap-2 sm:grid-cols-5">
      <Stat label="AC">
        <ComputedValue title="Armor Class" computed={sheet.ac} overrideKey="ac" className="w-full text-2xl" />
      </Stat>
      <Stat label="Iniciativa">
        <ComputedValue title="Iniciativa" computed={sheet.initiative} overrideKey="initiative" format={formatModifier} className="w-full text-2xl" />
        <RollButton label="Iniciativa" expression={d20(sheet.initiative.value)} text="Hod" className="-mt-2" initiative />
      </Stat>
      <Stat label="Rychlost">
        <ComputedValue title="Rychlost" computed={sheet.speed} overrideKey="speed" format={(n) => `${n} ft`} className="w-full text-2xl" />
      </Stat>
      <Stat label="Proficiency">
        <ComputedValue
          title="Proficiency bonus"
          computed={sheet.proficiencyBonus}
          overrideKey="proficiencyBonus"
          format={formatModifier}
          className="w-full text-2xl"
        />
      </Stat>
      <Stat label="Pasivní vnímání">
        <ComputedValue title="Pasivní vnímání" computed={sheet.passivePerception} overrideKey="passivePerception" className="w-full text-2xl" />
      </Stat>
    </section>
  )
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-xl border bg-card p-2 text-center">
      {children}
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  )
}
