import type { RulesBundle } from './rules-bundle'
import type { ClassLevels } from './spellcasting'
import type { AttackInfo } from './types'

/**
 * Přídavek ke zranění, který dává třída (Sneak Attack, Colossus Slayer, Improved Divine Smite). Engine ho jen popíše:
 * kostky podle levelu a na které útoky se vztahuje. Jestli podmínka platí (výhoda, cíl pod maximem HP), rozhoduje hráč.
 */
export interface DamageRiderInfo {
  id: string
  name: string
  /** Kostky podle levelu třídy, např. '3d6'. */
  dice: string
  /** Typ zranění: 'weapon' = stejný jako zbraň, jinak název (Radiant). */
  type: string
  /** Z jaké třídy přídavek je (nebo z jaké subclass). */
  source: string
  /** `always` se přidá ke každému zásahu, na který se vztahuje; `toggle` si hráč zapíná sám (platí jen když je splněna podmínka). */
  mode: 'toggle' | 'always'
  /** Na které útoky se vztahuje. */
  applies: 'finesseOrRanged' | 'weapon' | 'meleeWeapon'
  /** Podmínka a omezení česky (zobrazí se u přepínače). */
  note: string
}

const num = (v: unknown): number => (typeof v === 'number' ? v : 0)

/** Přídavky ke zranění podle tříd a levelů postavy (SRD 5.1). */
export function classDamageRiders(classes: ClassLevels[], bundle: RulesBundle): DamageRiderInfo[] {
  const out: DamageRiderInfo[] = []
  for (const c of classes) {
    const cls = bundle.classes[c.classIndex]
    const spec = cls?.levels[c.level]?.classSpecific ?? {}
    const source = cls?.name ?? c.classIndex
    if (c.classIndex === 'rogue') {
      const sneak = spec.sneak_attack as { dice_count?: number; dice_value?: number } | undefined
      if (sneak?.dice_count && sneak.dice_value) {
        out.push({
          id: 'sneak-attack',
          name: 'Sneak Attack',
          dice: `${sneak.dice_count}d${sneak.dice_value}`,
          type: 'weapon',
          source,
          mode: 'toggle',
          applies: 'finesseOrRanged',
          note: 'Jednou za tah, zbraní s Finesse nebo dálkovou. Máš výhodu na útok, nebo je u cíle do 5 ft další nepřítel tvého spojence (a nemáš nevýhodu).',
        })
      }
    }
    if (c.classIndex === 'ranger' && c.subclassIndex === 'hunter' && c.level >= 3) {
      out.push({
        id: 'colossus-slayer',
        name: 'Colossus Slayer',
        dice: '1d8',
        type: 'weapon',
        source: 'Hunter',
        mode: 'toggle',
        applies: 'weapon',
        note: 'Jednou za tah, jen když má cíl méně než své maximum HP.',
      })
    }
    if (c.classIndex === 'paladin' && c.level >= 11) {
      out.push({
        id: 'improved-divine-smite',
        name: 'Improved Divine Smite',
        dice: '1d8',
        type: 'Radiant',
        source,
        mode: 'always',
        applies: 'meleeWeapon',
        note: 'Ke každému zásahu zbraní zblízka.',
      })
    }
  }
  return out
}

/** Platí přídavek pro tento útok? */
export function riderApplies(rider: DamageRiderInfo, attack: Pick<AttackInfo, 'weapon' | 'ranged' | 'finesse'>): boolean {
  if (!attack.weapon) return false
  switch (rider.applies) {
    case 'finesseOrRanged':
      return attack.ranged || attack.finesse
    case 'meleeWeapon':
      return !attack.ranged
    default:
      return true
  }
}

/** Základ pro Rage: bonus ke zranění z tabulky barbara (0, když postava barbar není). */
export function rageDamageBonus(classes: ClassLevels[], bundle: RulesBundle): number {
  const c = classes.find((x) => x.classIndex === 'barbarian')
  return c ? num(bundle.classes.barbarian?.levels[c.level]?.classSpecific.rage_damage_bonus) : 0
}

/** Počet kostek navíc při kritu zbraní zblízka (Brutal Critical: 1 od 9., 2 od 13., 3 od 17. levelu barbara). */
export function brutalCriticalDice(classes: ClassLevels[], bundle: RulesBundle): number {
  const c = classes.find((x) => x.classIndex === 'barbarian')
  return c ? num(bundle.classes.barbarian?.levels[c.level]?.classSpecific.brutal_critical_dice) : 0
}
