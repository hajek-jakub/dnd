/**
 * Kouzla se soustředěním, která přidávají zranění ke každému zásahu (např. Hex na cíl). Aplikace nevede cíle, takže si hráč
 * u útoků zapíná „cíl je pod kouzlem“ sám, protože bonus platí jen proti jednomu cíli. Klíč je název kouzla ze soustředění.
 */
export interface DamageRider {
  name: string
  dice: string
  type: string
}

export const DAMAGE_RIDERS: Record<string, DamageRider> = {
  Hex: { name: 'Hex', dice: '1d6', type: 'Necrotic' },
  "Hunter's Mark": { name: "Hunter's Mark", dice: '1d6', type: 'zbraně' },
}

export function riderFor(concentration: string | null | undefined): DamageRider | null {
  return (concentration && DAMAGE_RIDERS[concentration]) || null
}
