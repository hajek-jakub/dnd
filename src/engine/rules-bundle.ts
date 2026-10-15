import type { AbilityKey } from './abilities'
import { isAbilityKey } from './abilities'

/** Surová data z SRD (tvar odpovídá 5e-bits/5e-database; stejně je vrací API /rules/engine). */
export interface RawClass {
  idx: string
  name: string
  data: {
    hit_die: number
    saving_throws?: { index: string }[]
    proficiencies?: { name: string }[]
    spellcasting?: { spellcasting_ability?: { index: string } }
    subclasses?: { index: string; name: string }[]
  }
}

export interface RawLevel {
  idx: string
  name: string
  level: number
  category: string | null
  data: {
    prof_bonus?: number
    class_specific?: Record<string, unknown>
    spellcasting?: Record<string, number>
    features?: { index: string; name: string }[]
    class?: { index: string; name: string }
    subclass?: { index: string; name: string }
  }
}

export type CasterType = 'full' | 'half' | 'third' | 'pact' | 'none'

export interface ClassLevelRules {
  level: number
  profBonus: number
  classSpecific: Record<string, unknown>
  spellcasting: Record<string, number> | null
  features: { index: string; name: string }[]
}

export interface ClassRules {
  index: string
  name: string
  hitDie: number
  saves: AbilityKey[]
  proficiencies: string[]
  spellcastingAbility: AbilityKey | null
  casterType: CasterType
  levels: Record<number, ClassLevelRules>
  subclasses: { index: string; name: string }[]
}

export interface SubclassRules {
  index: string
  name: string
  classIndex: string
  /** Featury podle levelu třídy, na kterém se získají. */
  features: Record<number, { index: string; name: string }[]>
}

export interface RulesBundle {
  classes: Record<string, ClassRules>
  subclasses: Record<string, SubclassRules>
}

const CASTER_TYPES: Record<string, CasterType> = {
  bard: 'full',
  cleric: 'full',
  druid: 'full',
  sorcerer: 'full',
  wizard: 'full',
  paladin: 'half',
  ranger: 'half',
  warlock: 'pact',
}

/** Podtřídy třetinových sesilatelů (nejsou v SRD, ale engine je zná kvůli homebrew a rozšíření). */
export const THIRD_CASTER_SUBCLASSES: Record<string, { classIndex: string; ability: AbilityKey }> = {
  'eldritch-knight': { classIndex: 'fighter', ability: 'int' },
  'arcane-trickster': { classIndex: 'rogue', ability: 'int' },
}

/** Z řádků API (nebo z JSON souborů SRD) sestaví data pro engine. */
export function buildRulesBundle(rawClasses: RawClass[], rawLevels: RawLevel[]): RulesBundle {
  const classes: Record<string, ClassRules> = {}
  for (const c of rawClasses) {
    const ability = c.data.spellcasting?.spellcasting_ability?.index
    classes[c.idx] = {
      index: c.idx,
      name: c.name,
      hitDie: c.data.hit_die,
      saves: (c.data.saving_throws ?? []).map((s) => s.index).filter(isAbilityKey),
      proficiencies: (c.data.proficiencies ?? []).map((p) => p.name),
      spellcastingAbility: ability && isAbilityKey(ability) ? ability : null,
      casterType: CASTER_TYPES[c.idx] ?? 'none',
      levels: {},
      subclasses: c.data.subclasses ?? [],
    }
  }

  const subclasses: Record<string, SubclassRules> = {}
  for (const l of rawLevels) {
    const classIdx = l.data.class?.index
    if (!classIdx) continue
    const features = l.data.features ?? []
    if (l.data.subclass) {
      const sub = (subclasses[l.data.subclass.index] ??= {
        index: l.data.subclass.index,
        name: l.data.subclass.name,
        classIndex: classIdx,
        features: {},
      })
      sub.features[l.level] = features
    } else {
      const cls = classes[classIdx]
      if (!cls) continue
      cls.levels[l.level] = {
        level: l.level,
        profBonus: l.data.prof_bonus ?? 2,
        classSpecific: l.data.class_specific ?? {},
        spellcasting: l.data.spellcasting ?? null,
        features,
      }
    }
  }
  return { classes, subclasses }
}
