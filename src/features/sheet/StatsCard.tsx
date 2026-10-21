import { formatModifier } from '@/engine'
import { RollButton } from '@/features/dice/RollButton'
import { d20 } from '@/features/dice/format'
import { ComputedValue } from './ComputedValue'
import { cn } from '@/lib/utils'
import { useSheet } from './sheet-context'
import type { CharacterItem } from './types'

/** Klíčové hodnoty na jednom místě: AC, iniciativa, rychlost, proficiency, pasivní vnímání. */
export function StatsCard() {
  const { sheet, character } = useSheet()
  return (
    <section aria-label="Klíčové hodnoty" className="grid grid-cols-6 gap-2 sm:grid-cols-5">
      <Stat label="AC">
        <ComputedValue title="Armor Class" computed={sheet.ac} overrideKey="ac" className="w-full text-2xl" hints={acHints(character.items)} />
      </Stat>
      <Stat label="Iniciativa">
        <ComputedValue title="Iniciativa" computed={sheet.initiative} overrideKey="initiative" format={formatModifier} className="w-full text-2xl" />
        <RollButton label="Iniciativa" expression={d20(sheet.initiative.value)} text="Hod" className="-mt-2" initiative />
      </Stat>
      <Stat label="Rychlost">
        <ComputedValue title="Rychlost" computed={sheet.speed} overrideKey="speed" format={(n) => `${n} ft`} className="w-full text-2xl" />
      </Stat>
      <Stat label="Proficiency" wide>
        <ComputedValue
          title="Proficiency bonus"
          computed={sheet.proficiencyBonus}
          overrideKey="proficiencyBonus"
          format={formatModifier}
          className="w-full text-2xl"
        />
      </Stat>
      <Stat label="Pasivní vnímání" wide>
        <ComputedValue title="Pasivní vnímání" computed={sheet.passivePerception} overrideKey="passivePerception" className="w-full text-2xl" />
      </Stat>
    </section>
  )
}

/** Zbroj nebo štít v batohu, když postava nic takového nenosí: do AC se nepočítá (častý důvod, proč se AC „nezměnilo“). */
function acHints(items: CharacterItem[]): string[] {
  const hints: string[] = []
  for (const [kind, what] of [
    ['armor', 'zbroj'],
    ['shield', 'štít'],
  ] as const) {
    const worn = items.some((i) => i.kind === kind && i.equipped && i.armor)
    const carried = items.filter((i) => i.kind === kind && !i.equipped && i.armor)
    if (!worn && carried.length > 0) {
      hints.push(`V batohu je ${what} ${carried.map((i) => i.name).join(', ')}, ale postava ji nenosí, takže se do AC nepočítá. Nasadit jde v Inventáři tlačítkem „Nosit“.`)
    }
  }
  return hints
}

/** Dlaždice hodnoty: popisek vždy nahoře, ať jsou popisky i čísla v řadě ve stejné výšce (iniciativa má navíc dole tlačítko Hod). */
function Stat({ label, children, wide = false }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={cn('flex flex-col items-center rounded-xl border bg-card p-2 text-center sm:col-span-1', wide ? 'col-span-3' : 'col-span-2')}>
      <span className="font-display text-[0.7rem] font-semibold tracking-wider text-muted-foreground uppercase">{label}</span>
      {children}
    </div>
  )
}
