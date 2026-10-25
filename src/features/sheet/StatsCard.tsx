import { formatModifier, type ComputedSheet } from '@/engine'
import { RollButton } from '@/features/dice/RollButton'
import { d20 } from '@/features/dice/format'
import { unusedArmor } from './armor-hints'
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
        <ComputedValue title="Armor Class" computed={sheet.ac} overrideKey="ac" className="w-full text-2xl" hints={acHints(character.items, sheet)} />
      </Stat>
      <Stat label="Iniciativa">
        <ComputedValue title="Iniciativa" computed={sheet.initiative} overrideKey="initiative" format={formatModifier} className="w-full text-2xl" />
        <RollButton label="Iniciativa" expression={d20(sheet.initiative.value)} text="Hod" className="-mt-2" initiative kind={{ check: 'dex' }} />
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
      <Stat label="Passive Perception" wide>
        <ComputedValue title="Passive Perception" computed={sheet.passivePerception} overrideKey="passivePerception" className="w-full text-2xl" />
      </Stat>
    </section>
  )
}

/** Zbroj nebo štít v inventáři, který se do AC nepočítá (častý dotaz, proč se AC „nezměnilo“). */
function acHints(items: CharacterItem[], sheet: ComputedSheet): string[] {
  const unused = unusedArmor(items, sheet)
  return unused.length > 0
    ? [`Do AC se nepočítá ${unused.map((i) => i.name).join(', ')}: bez toho vychází AC stejně nebo lépe (třeba Unarmored Defense), takže to postava jen nese.`]
    : []
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
