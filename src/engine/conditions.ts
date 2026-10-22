import type { AbilityKey } from './abilities'
import type { Effect } from './types'

/** Režim k20 pro konkrétní druh hodu podle stavů (výhoda a nevýhoda se navzájem ruší, jako v pravidlech). */
export type D20Mode = 'normal' | 'advantage' | 'disadvantage'

export interface ModeInfo {
  mode: D20Mode
  /** Stavy, které za režimem stojí (např. ['Poisoned']). */
  sources: string[]
}

export interface ConditionImpact {
  condition: string
  /** Co stav dělá, česky (zobrazí se hráči i DM). */
  text: string
}

export interface ConditionEffects {
  /** Výpis pro hráče: každý známý stav s popisem dopadu. Neznámé (vlastní) stavy tu nejsou. */
  impacts: ConditionImpact[]
  /** Režim hodu útoku (zbraní i kouzlem). */
  attack: ModeInfo
  /** Režim zkoušek vlastností a dovedností, iniciativy (stavy platné pro všechny vlastnosti). */
  check: ModeInfo
  /** Režim zkoušek podle vlastnosti: společný `check` plus stavy jen pro jednu vlastnost (Rage: výhoda na STR). Dovednost patří ke své vlastnosti. */
  checks: Record<AbilityKey, ModeInfo>
  /** Režim záchranných hodů podle vlastnosti. */
  saves: Record<AbilityKey, ModeInfo & { autoFail: string[] }>
  /** Neschopný jednat (Incapacitated, Paralyzed, Stunned, Unconscious, Petrified). */
  incapacitated: string[]
  /** Postih ke k20 v číslech (2024: Exhaustion −2 za úroveň); stejné číslo už je v `effects`. */
  d20Penalty: number
  /** Číselné efekty pro výpočet (2024 Exhaustion: útoky, dovednosti, záchranné hody, iniciativa, kouzla, rychlost). */
  effects: Effect[]
  /** Stavy, kvůli kterým je rychlost 0 / poloviční. */
  speedZero: string[]
  speedHalved: string[]
  /** Exhaustion (2014, úroveň 4+): maximum HP je poloviční. */
  hpMaxHalved: string[]
}

/** Rozebere zápis stavu: 'Exhaustion 3' → { key: 'exhaustion', level: 3 }. Bez čísla je to úroveň 1. Ostatní stavy mají jen klíč. */
export function parseCondition(name: string): { key: string; level: number | null } {
  const text = name.trim().toLowerCase()
  const exhaustion = /^exhaustion(?:\s+(\d+))?$/.exec(text)
  if (exhaustion) return { key: 'exhaustion', level: Math.min(6, Math.max(1, Number(exhaustion[1] ?? 1))) }
  return { key: text, level: null }
}

/** Úroveň vyčerpání (0 = žádné) ze seznamu stavů. */
export function exhaustionLevel(conditions: string[]): number {
  return Math.max(
    0,
    ...conditions.map((c) => {
      const p = parseCondition(c)
      return p.key === 'exhaustion' ? (p.level ?? 1) : 0
    }),
  )
}

/** Stavy ze SRD, mezi kterými si DM vybírá (Exhaustion s úrovní se zapisuje jako 'Exhaustion 3'). */
export const SRD_CONDITIONS = [
  'Blinded',
  'Charmed',
  'Deafened',
  'Exhaustion',
  'Frightened',
  'Grappled',
  'Incapacitated',
  'Invisible',
  'Paralyzed',
  'Petrified',
  'Poisoned',
  'Prone',
  'Restrained',
  'Stunned',
  'Unconscious',
] as const

const SAVE_KEYS: AbilityKey[] = ['str', 'dex', 'con', 'int', 'wis', 'cha']

interface Rule {
  text: string
  attack?: 'advantage' | 'disadvantage'
  check?: boolean
  /** Zkoušky jen pro některé vlastnosti (Rage: výhoda na zkoušky STR). */
  checks?: Partial<Record<AbilityKey, 'advantage' | 'disadvantage'>>
  saves?: Partial<Record<AbilityKey, 'advantage' | 'disadvantage'>>
  autoFail?: AbilityKey[]
  incapacitated?: boolean
  speedZero?: boolean
}

/** Pravidla stavů podle SRD 5.1 (2024 je stejné kromě Exhaustion). Co engine neumí spočítat, stojí jen v popisu. */
const RULES: Record<string, Rule> = {
  blinded: { text: 'Nevýhoda na útoky; útoky proti tobě mají výhodu. Automaticky neuspěješ ve zkouškách, které vyžadují zrak.', attack: 'disadvantage' },
  charmed: { text: 'Nemůžeš útočit na toho, kdo tě okouzlil, ani na něj zacílit škodlivé schopnosti. Ten má výhodu na sociální zkoušky proti tobě.' },
  deafened: { text: 'Automaticky neuspěješ ve zkouškách, které vyžadují sluch.' },
  frightened: {
    text: 'Nevýhoda na zkoušky vlastností a útoky, dokud vidíš zdroj strachu. K tomu zdroji se nemůžeš dobrovolně přiblížit.',
    attack: 'disadvantage',
    check: true,
  },
  grappled: { text: 'Rychlost je 0 a nejde zvýšit.', speedZero: true },
  incapacitated: { text: 'Nemůžeš provádět akce ani reakce.', incapacitated: true },
  invisible: { text: 'Výhoda na útoky; útoky proti tobě mají nevýhodu.', attack: 'advantage' },
  paralyzed: {
    text: 'Nemůžeš jednat ani se hýbat. Automaticky neuspěješ v záchranných hodech na STR a DEX. Útoky proti tobě mají výhodu a zásah zblízka je kritický.',
    incapacitated: true,
    speedZero: true,
    autoFail: ['str', 'dex'],
  },
  petrified: {
    text: 'Jsi kámen: nemůžeš jednat ani se hýbat. Automaticky neuspěješ v záchranných hodech na STR a DEX. Útoky proti tobě mají výhodu, máš odolnost proti všem zraněním a imunitu vůči jedu a nemoci.',
    incapacitated: true,
    speedZero: true,
    autoFail: ['str', 'dex'],
  },
  // Rage barbara (stav si zapíná hráč tlačítkem Rage; bonus ke zranění počítá engine u útoků na STR zblízka).
  raging: {
    text: 'Rage: výhoda na zkoušky vlastnosti a záchranné hody na STR, bonus ke zranění zbraněmi zblízka na STR, odolnost proti bodnému, drtivému a sečnému zranění. Nemůžeš sesílat kouzla ani se soustředit. Končí po 1 minutě, nebo když neútočíš ani neutrpíš zranění.',
    saves: { str: 'advantage' },
    checks: { str: 'advantage' },
  },
  poisoned: { text: 'Nevýhoda na útoky a zkoušky vlastností.', attack: 'disadvantage', check: true },
  prone: { text: 'Nevýhoda na útoky. Útoky zblízka proti tobě mají výhodu, útoky z dálky nevýhodu. Vstát stojí polovinu rychlosti.', attack: 'disadvantage' },
  restrained: {
    text: 'Rychlost je 0. Nevýhoda na útoky a záchranné hody na DEX; útoky proti tobě mají výhodu.',
    attack: 'disadvantage',
    saves: { dex: 'disadvantage' },
    speedZero: true,
  },
  stunned: {
    text: 'Nemůžeš jednat ani se hýbat. Automaticky neuspěješ v záchranných hodech na STR a DEX. Útoky proti tobě mají výhodu.',
    incapacitated: true,
    speedZero: true,
    autoFail: ['str', 'dex'],
  },
  unconscious: {
    text: 'Jsi bez vědomí: nemůžeš jednat ani se hýbat, upustíš věci a padneš (Prone). Automaticky neuspěješ v záchranných hodech na STR a DEX. Útoky proti tobě mají výhodu a zásah zblízka je kritický.',
    incapacitated: true,
    speedZero: true,
    autoFail: ['str', 'dex'],
  },
}

const EXHAUSTION_2014 = [
  'Nevýhoda na zkoušky vlastností.',
  'Rychlost je poloviční.',
  'Nevýhoda na útoky a záchranné hody.',
  'Maximum HP je poloviční.',
  'Rychlost je 0.',
  'Smrt.',
]

interface Pool {
  adv: string[]
  dis: string[]
}

/** Výhoda + nevýhoda se ruší (pravidlo 5e: jedna výhoda i jedna nevýhoda dají normální hod bez ohledu na počet). */
function mergeMode(pool: Pool): ModeInfo {
  if (pool.adv.length > 0 && pool.dis.length > 0) return { mode: 'normal', sources: [...pool.adv, ...pool.dis] }
  if (pool.dis.length > 0) return { mode: 'disadvantage', sources: pool.dis }
  if (pool.adv.length > 0) return { mode: 'advantage', sources: pool.adv }
  return { mode: 'normal', sources: [] }
}

/**
 * Dopady stavů postavy na hody, rychlost a HP. Engine stavy nepřidává ani neodebírá (to dělá DM); jen z nich počítá,
 * co znamenají. Hráč to vidí v popisu stavu a u hodu se nevýhoda nastaví sama.
 */
export function conditionEffects(conditions: string[], ruleset: '2014' | '2024' = '2014'): ConditionEffects {
  const attack: Pool = { adv: [], dis: [] }
  const check: Pool = { adv: [], dis: [] }
  const saves = Object.fromEntries(SAVE_KEYS.map((a) => [a, { adv: [], dis: [], autoFail: [] }])) as unknown as Record<AbilityKey, Pool & { autoFail: string[] }>
  const checksByAbility = Object.fromEntries(SAVE_KEYS.map((a) => [a, { adv: [], dis: [] }])) as unknown as Record<AbilityKey, Pool>
  const impacts: ConditionImpact[] = []
  const incapacitated: string[] = []
  const speedZero: string[] = []
  const speedHalved: string[] = []
  const hpMaxHalved: string[] = []
  const effects: Effect[] = []
  let d20Penalty = 0

  const seen = new Set<string>()
  for (const raw of conditions) {
    const { key } = parseCondition(raw)
    if (seen.has(key)) continue
    seen.add(key)
    if (key === 'exhaustion') {
      const lvl = exhaustionLevel(conditions)
      const label = `Exhaustion ${lvl}`
      if (ruleset === '2024') {
        d20Penalty = 2 * lvl
        const source = label
        for (const target of ['attack.all', 'skill.all', 'save.all', 'initiative', 'spell.dc', 'spell.attack']) effects.push({ target, value: -d20Penalty, source })
        effects.push({ target: 'speed', value: -5 * lvl, source })
        impacts.push({ condition: label, text: `Každý hod k20 (zkoušky, útoky, záchranné hody) má −${d20Penalty}, kouzelné DC také. Rychlost −${5 * lvl} ft.${lvl >= 6 ? ' Úroveň 6 je smrt.' : ''}` })
      } else {
        impacts.push({ condition: label, text: EXHAUSTION_2014.slice(0, lvl).join(' ') })
        check.dis.push(label)
        if (lvl >= 2) speedHalved.push(label)
        if (lvl >= 3) {
          attack.dis.push(label)
          for (const a of SAVE_KEYS) saves[a].dis.push(label)
        }
        if (lvl >= 4) hpMaxHalved.push(label)
        if (lvl >= 5) speedZero.push(label)
      }
      continue
    }
    const rule = RULES[key]
    if (!rule) continue
    const label = raw.trim()
    impacts.push({ condition: label, text: rule.text })
    if (rule.attack === 'disadvantage') attack.dis.push(label)
    if (rule.attack === 'advantage') attack.adv.push(label)
    if (rule.check) check.dis.push(label)
    for (const a of SAVE_KEYS) {
      if (rule.checks?.[a] === 'disadvantage') checksByAbility[a].dis.push(label)
      if (rule.checks?.[a] === 'advantage') checksByAbility[a].adv.push(label)
      if (rule.saves?.[a] === 'disadvantage') saves[a].dis.push(label)
      if (rule.saves?.[a] === 'advantage') saves[a].adv.push(label)
    }
    for (const a of rule.autoFail ?? []) saves[a].autoFail.push(label)
    if (rule.incapacitated) incapacitated.push(label)
    if (rule.speedZero) speedZero.push(label)
  }

  const savesOut = Object.fromEntries(SAVE_KEYS.map((a) => [a, { ...mergeMode(saves[a]), autoFail: saves[a].autoFail }])) as ConditionEffects['saves']
  const checks = Object.fromEntries(
    SAVE_KEYS.map((a) => [a, mergeMode({ adv: [...check.adv, ...checksByAbility[a].adv], dis: [...check.dis, ...checksByAbility[a].dis] })]),
  ) as ConditionEffects['checks']
  return { impacts, attack: mergeMode(attack), check: mergeMode(check), checks, saves: savesOut, incapacitated, d20Penalty, effects, speedZero, speedHalved, hpMaxHalved }
}

/** Spojí režim zvolený hráčem s režimem ze stavů: výhoda a nevýhoda se ruší. */
export function combineMode(chosen: D20Mode, fromConditions: D20Mode): D20Mode {
  if (fromConditions === 'normal') return chosen
  if (chosen === 'normal') return fromConditions
  return chosen === fromConditions ? chosen : 'normal'
}
