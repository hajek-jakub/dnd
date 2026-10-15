import { describe, expect, it } from 'vitest'
import type { DiceRoll } from './api'
import { breakdown, d20, damageExpression, describeRoll, naturalNote } from './format'

const roll = (over: Partial<DiceRoll> = {}): DiceRoll => ({
  id: 1,
  userId: 'u',
  userName: 'Bob',
  characterId: null,
  characterName: null,
  label: 'Test',
  expression: '1d20+7',
  mode: 'normal',
  crit: false,
  hidden: false,
  total: 19,
  attempts: [{ total: 19, terms: [{ sign: 1, count: 1, sides: 20, rolls: [12] }, { sign: 1, constant: 7 }] }],
  chosen: 0,
  natural: 12,
  createdAt: '2026-10-15T18:00:00Z',
  ...over,
})

describe('výrazy kostek', () => {
  it('d20 s modifikátorem', () => {
    expect(d20(7)).toBe('1d20+7')
    expect(d20(-1)).toBe('1d20-1')
    expect(d20(0)).toBe('1d20')
  })

  it('zranění: kostka, bonus a doplňková zranění; bez kostky (nezbraňový útok) null', () => {
    expect(damageExpression('1d6', 5, [{ dice: '1d4' }])).toBe('1d6+5+1d4')
    expect(damageExpression('1d8', -1)).toBe('1d8-1')
    expect(damageExpression('2d6', 0)).toBe('2d6')
    expect(damageExpression('1', 4)).toBeNull()
  })
})

describe('popis hodu', () => {
  it('rozpis kostek a součet', () => {
    expect(breakdown(roll().attempts[0]!)).toBe('[12] + 7')
    expect(breakdown({ total: 0, terms: [{ sign: 1, count: 2, sides: 6, rolls: [3, 4] }, { sign: -1, constant: 2 }] })).toBe('[3, 4] − 2')
    expect(describeRoll(roll())).toBe('1d20+7 = 19 ([12] + 7)')
  })

  it('výhoda ukáže oba hody a ten vybraný', () => {
    const adv = roll({
      mode: 'advantage',
      chosen: 1,
      total: 22,
      attempts: [
        { total: 10, terms: [{ sign: 1, count: 1, sides: 20, rolls: [3] }, { sign: 1, constant: 7 }] },
        { total: 22, terms: [{ sign: 1, count: 1, sides: 20, rolls: [15] }, { sign: 1, constant: 7 }] },
      ],
    })
    expect(describeRoll(adv)).toContain('výhoda: (10) / 22')
    expect(describeRoll(adv)).toContain('= 22 ([15] + 7)')
  })

  it('přirozená 20 a 1', () => {
    expect(naturalNote(roll({ natural: 20 }))).toBe('crit')
    expect(naturalNote(roll({ natural: 1 }))).toBe('fail')
    expect(naturalNote(roll({ natural: 12 }))).toBeNull()
    expect(naturalNote(roll({ natural: null }))).toBeNull()
  })
})
