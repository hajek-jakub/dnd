import { describe, expect, it } from 'vitest'
import { buildReel, landingOffset, REEL_LENGTH, WINNER_INDEX } from './reel'

describe('buildReel', () => {
  it('výherce je zlatý na pevné pozici, pás má jen jména účastníků', () => {
    const names = ['Borys', 'DM', 'Enros', 'Pedro', 'Robin']
    for (let n = 0; n < 50; n++) {
      const reel = buildReel(names, 'Pedro')
      expect(reel).toHaveLength(REEL_LENGTH)
      expect(reel[WINNER_INDEX]).toEqual({ name: 'Pedro', rarity: 'gold' })
      expect(reel[WINNER_INDEX - 1]!.name).not.toBe('Pedro')
      expect(reel[WINNER_INDEX + 1]!.name).not.toBe('Pedro')
      for (const card of reel) expect(names).toContain(card.name)
    }
  })

  it('funguje i bez seznamu jmen', () => {
    expect(buildReel([], 'DM')[WINNER_INDEX]!.name).toBe('DM')
  })
})

describe('landingOffset', () => {
  it('střed okna skončí na středu výherce (bez odchylky)', () => {
    const offset = landingOffset(100, 500, 0)
    expect(offset + 250).toBe(WINNER_INDEX * 100 + 50)
  })

  it('odchylka nevyjede z karty výherce', () => {
    for (const j of [-0.5, 0.5]) {
      const center = landingOffset(100, 500, j) + 250
      expect(center).toBeGreaterThan(WINNER_INDEX * 100)
      expect(center).toBeLessThan((WINNER_INDEX + 1) * 100)
    }
  })
})
