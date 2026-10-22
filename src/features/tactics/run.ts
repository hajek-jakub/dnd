import { riderFor, type DamageRider } from '@/features/sheet/riders'
import type { CharacterItem } from '@/features/sheet/types'
import type { BatchAttack } from '@/features/dice/api'
import { parseCost, type Cost } from './cost'
import { NO_CLASS_BONUS, rollFor, toHitRoll, withClassBonus, type ClassBonus } from './damage'
import type { Tactic } from './types'

type Rollable = Extract<Tactic, { kind: 'attack' | 'spell' | 'ki' }>

export interface RunPlan {
  /** hody k provedení: jeden záznam = jeden útok (zásah + zranění) */
  attacks: BatchAttack[]
  /** ceny k zaplacení (každá položka jednou, bez ohledu na počet útoků) */
  costs: Cost[]
  /** spotřeba munice podle itemu */
  ammo: { itemId: string; name: string; shots: number }[]
  /** proč něco chybí (došla munice, item není v inventáři) */
  warnings: string[]
  /** munice nestačí ani na jeden útok položky, která ji potřebuje */
  blocked: string | null
  /** kouzlo, na které se seslání soustředí (Hex): po použití se nastaví a jeho bonus se přidá ke zranění */
  concentration: string | null
}

const isRollable = (t: Tactic): t is Rollable => t.kind === 'attack' || t.kind === 'spell' || t.kind === 'ki'

function countOf(t: Rollable): number {
  return Math.max(1, t.data.count ?? 1)
}

/** Co jedno použití položky provede: útoky s hody, ceny a spotřebu munice. Komba provedou všechny své položky. */
export function planRun(tactic: Tactic, all: Tactic[], items: CharacterItem[], rider: DamageRider | null, bonus: ClassBonus = NO_CLASS_BONUS): RunPlan {
  const sources: { t: Rollable; count: number }[] = []
  let costs: Cost[] = []
  if (tactic.kind === 'combo') {
    for (const u of tactic.data.uses ?? []) {
      const t = all.find((x) => x.id === u.id)
      if (t && isRollable(t)) sources.push({ t, count: u.count })
    }
    costs = sources.length > 0 ? sources.map((s) => parseCost(s.t.data.cost)) : [parseCost(tactic.data.cost)]
  } else if (isRollable(tactic)) {
    sources.push({ t: tactic, count: countOf(tactic) })
    costs = [parseCost(tactic.data.cost)]
  } else if (tactic.kind === 'passive') {
    costs = [parseCost(tactic.data.cost)]
  }
  costs = costs.filter((c) => c.type !== 'free')
  // Seslání kouzla se soustředěním (Hex) nastaví soustředění a jeho bonus platí už pro útoky téhož použití.
  const casting = sources.find((s) => s.t.kind === 'spell' && s.t.data.concentration)?.t.title ?? null
  const activeRider = casting !== null ? (riderFor(casting) ?? rider) : rider

  const attacks: BatchAttack[] = []
  const left = new Map(items.map((i) => [i.id, i.quantity]))
  const used = new Map<string, number>()
  const warnings: string[] = []
  let blocked: string | null = null

  for (const { t, count } of sources) {
    const ammoId = t.kind === 'attack' ? t.data.ammo : ''
    const ammoItem = ammoId ? items.find((i) => i.id === ammoId) : undefined
    if (ammoId && !ammoItem) {
      warnings.push(`${t.title}: munice už není v inventáři`)
      blocked ??= `${t.title}: chybí munice`
      continue
    }
    const hit = toHitRoll(t.data.toHit)
    const base = t.kind === 'spell' ? (t.data.roll ? rollFor({ roll: t.data.roll }) : null) : rollFor({ roll: t.data.roll, damage: t.data.damage })
    const withRider = activeRider !== null && (t.kind === 'attack' || t.kind === 'ki') && t.data.hex
    const flags = t.kind === 'attack' || t.kind === 'ki' ? t.data : {}
    const damage = base ? withClassBonus(`${base}${withRider && activeRider ? `+${activeRider.dice}` : ''}`, flags, bonus) : null
    if (hit === null && damage === null) continue
    let shots = count
    if (ammoItem) {
      const have = left.get(ammoItem.id) ?? 0
      if (have < shots) {
        warnings.push(`${t.title}: ${have === 0 ? 'došla munice' : `munice stačí jen na ${have} ${have < 5 ? 'útoky' : 'útoků'}`} (${ammoItem.name})`)
        shots = have
      }
      if (shots === 0) blocked ??= `${t.title}: došla munice (${ammoItem.name})`
      left.set(ammoItem.id, have - shots)
      used.set(ammoItem.id, (used.get(ammoItem.id) ?? 0) + shots)
    }
    for (let i = 1; i <= shots; i++) {
      attacks.push({ label: `${t.title}${count > 1 ? ` #${i}` : ''}`, ...(hit ? { toHit: hit } : {}), ...(damage ? { damage } : {}) })
    }
  }

  const ammo = [...used].filter(([, n]) => n > 0).map(([itemId, shots]) => ({ itemId, name: items.find((i) => i.id === itemId)?.name ?? '', shots }))
  return { attacks, costs, ammo, warnings, blocked, concentration: casting }
}

