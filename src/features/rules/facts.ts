import type { RuleDetail } from '@/lib/types'
import { capitalize, formatPrice } from './labels'

export type Fact = [label: string, value: string]

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)
const num = (v: unknown): number | null => (typeof v === 'number' ? v : null)
const names = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? x : (str((x as { name?: unknown })?.name) ?? ''))).filter(Boolean) : []

function ordinal(level: number): string {
  return level === 1 ? '1st' : level === 2 ? '2nd' : level === 3 ? '3rd' : `${level}th`
}

/** Údaje zobrazené nad popisem, podle druhu záznamu. */
export function factsFor(e: RuleDetail): Fact[] {
  const d = e.data
  const facts: Fact[] = []
  const add = (label: string, value: string | number | null | undefined) => {
    if (value !== null && value !== undefined && value !== '') facts.push([label, String(value)])
  }

  switch (e.kind) {
    case 'spell': {
      add('Úroveň', e.level === 0 ? 'Cantrip' : `${ordinal(e.level ?? 0)} level`)
      add('Škola', e.category)
      add('Seslání', str(d.casting_time))
      add('Dosah', str(d.range))
      const components = Array.isArray(d.components) ? d.components.join(', ') : str(d.components)
      add('Komponenty', components && str(d.material) ? `${components} (${str(d.material)})` : (components ?? str(d.material)))
      const flags = [d.concentration === true ? 'koncentrace' : null, d.ritual === true ? 'rituál' : null].filter(Boolean)
      add('Trvání', [str(d.duration), ...flags].filter(Boolean).join(', '))
      add('Třídy', names(d.classes).join(', '))
      break
    }
    case 'magic_item': {
      add('Typ', e.category)
      add('Vzácnost', e.rarity ? capitalize(e.rarity) : null)
      add('Attunement', e.attunement === null ? null : e.attunement ? 'vyžaduje' : 'nevyžaduje')
      add('Cena', formatPrice(e.priceGp, e.priceNote))
      add('Zdroj', e.source)
      break
    }
    case 'weapon': {
      add('Kategorie', [str(d.weapon_category), str(d.weapon_range)].filter(Boolean).join(' · '))
      const dmg = d.damage as { dice?: string; type?: string } | undefined
      add('Zranění', dmg?.dice ? `${dmg.dice} ${dmg.type ?? ''}`.trim() : null)
      const two = d.two_handed_damage as { dice?: string; type?: string } | undefined
      add('Oběma rukama', two?.dice ? `${two.dice} ${two.type ?? ''}`.trim() : null)
      const range = d.range as { normal?: number; long?: number } | undefined
      add('Dostřel', range?.normal ? (range.long ? `${range.normal}/${range.long} ft` : `${range.normal} ft`) : null)
      add('Vlastnosti', names(d.properties).join(', '))
      add('Cena', formatPrice(e.priceGp, e.priceNote))
      break
    }
    case 'armor': {
      add('Kategorie', str(d.armor_category))
      const ac = d.armor_class as { base?: number; dex_bonus?: boolean; max_bonus?: number | null } | undefined
      if (ac?.base !== undefined) {
        add('AC', ac.dex_bonus ? `${ac.base} + DEX${ac.max_bonus ? ` (max ${ac.max_bonus})` : ''}` : String(ac.base))
      }
      add('Min. síla', num(d.str_minimum) ? String(d.str_minimum) : null)
      add('Stealth', d.stealth_disadvantage === true ? 'nevýhoda' : null)
      add('Cena', formatPrice(e.priceGp, e.priceNote))
      break
    }
    case 'equipment': {
      add('Kategorie', e.category)
      add('Cena', formatPrice(e.priceGp, e.priceNote))
      break
    }
    case 'feature': {
      add('Třída', e.category)
      add('Level', e.level)
      const subclass = (d.subclass as { name?: string } | undefined)?.name
      add('Subclass', subclass)
      break
    }
    case 'class': {
      add('Hit die', num(d.hit_die) !== null ? `d${d.hit_die}` : null)
      add('Saving throws', names(d.saving_throws).join(', '))
      add('Subclassy', names(d.subclasses).join(', '))
      add('Proficiencies', names(d.proficiencies).join(', '))
      break
    }
    case 'subclass': {
      add('Třída', e.category)
      add('Typ', str(d.subclass_flavor))
      break
    }
    case 'race': {
      add('Rychlost', num(d.speed) !== null ? `${d.speed} ft` : null)
      add('Velikost', str(d.size))
      const bonuses = Array.isArray(d.ability_bonuses)
        ? (d.ability_bonuses as { ability_score?: { name?: string }; bonus?: number }[])
            .map((b) => `${b.ability_score?.name ?? ''} +${b.bonus ?? 0}`)
            .join(', ')
        : null
      add('Bonusy vlastností', bonuses)
      add('Rysy', names(d.traits).join(', '))
      add('Subrasy', names(d.subraces).join(', '))
      break
    }
    case 'subrace': {
      add('Rasa', e.category)
      const bonuses = Array.isArray(d.ability_bonuses)
        ? (d.ability_bonuses as { ability_score?: { name?: string }; bonus?: number }[])
            .map((b) => `${b.ability_score?.name ?? ''} +${b.bonus ?? 0}`)
            .join(', ')
        : null
      add('Bonusy vlastností', bonuses)
      add('Rysy', names(d.racial_traits).join(', '))
      break
    }
    case 'skill':
      add('Vlastnost', e.category)
      break
    case 'language':
      add('Typ', e.category)
      add('Písmo', str(d.script))
      break
    default:
      add('Kategorie', e.category)
  }
  return facts
}
