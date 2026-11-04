/** Pás karet pro animaci losování (jako otevírání beden v CS:GO): náhodná jména, výherce na pevné pozici. */

export type Rarity = 'blue' | 'purple' | 'pink' | 'red' | 'gold'

export interface ReelCard {
  name: string
  rarity: Rarity
}

export const REEL_LENGTH = 60
/** Index karty, na které pás zastaví (zbytek za ní je vidět vpravo od ukazatele). */
export const WINNER_INDEX = 52

// Váhy barev jako v bednách: modrá častá, zlatá vzácná.
const WEIGHTS: [Rarity, number][] = [
  ['blue', 55],
  ['purple', 25],
  ['pink', 12],
  ['red', 6],
  ['gold', 2],
]

function pickRarity(random: () => number): Rarity {
  let r = random() * 100
  for (const [rarity, weight] of WEIGHTS) {
    if ((r -= weight) < 0) return rarity
  }
  return 'blue'
}

/**
 * `names` jsou ostatní účastníci (bez sebe), `winner` je mezi nimi. Výherce je na `WINNER_INDEX` a je zlatý;
 * těsně vedle něj je jiné jméno (pokud nějaké je), ať to do poslední chvíle vypadá i na souseda.
 */
export function buildReel(names: string[], winner: string, random: () => number = Math.random): ReelCard[] {
  const pool = names.length > 0 ? names : [winner]
  const others = pool.filter((n) => n !== winner)
  const reel: ReelCard[] = []
  for (let i = 0; i < REEL_LENGTH; i++) {
    let name = pool[Math.floor(random() * pool.length)] ?? winner
    if ((i === WINNER_INDEX - 1 || i === WINNER_INDEX + 1) && others.length > 0) name = others[Math.floor(random() * others.length)] ?? name
    reel.push({ name, rarity: i === WINNER_INDEX - 1 || i === WINNER_INDEX + 1 ? 'red' : pickRarity(random) })
  }
  reel[WINNER_INDEX] = { name: winner, rarity: 'gold' }
  return reel
}

/** Posun pásu tak, aby ukazatel uprostřed okna skončil na výherci (`jitter` −0.5 až 0.5 = kde přesně na kartě). */
export function landingOffset(cardWidth: number, viewportWidth: number, jitter: number): number {
  return WINNER_INDEX * cardWidth + cardWidth / 2 + jitter * cardWidth * 0.8 - viewportWidth / 2
}
