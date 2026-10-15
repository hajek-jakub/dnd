import { describe, expect, it } from 'vitest'
import { damageRoll, rollFor, toHitRoll } from './damage'

describe('damageRoll', () => {
  it('zahodí slova a spojí kostky', () => {
    expect(damageRoll('1d8+5 + 1d4 fire')).toBe('1d8+5+1d4')
    expect(damageRoll('2d6 necrotic')).toBe('2d6')
    expect(damageRoll('d6+4')).toBe('1d6+4')
    expect(damageRoll('1d10-1')).toBe('1d10-1')
  })
  it('bez kostky null', () => {
    expect(damageRoll('5')).toBeNull()
    expect(damageRoll('')).toBeNull()
    expect(damageRoll('automaticky')).toBeNull()
  })
})

describe('rollFor', () => {
  it('upřednostní roll', () => {
    expect(rollFor({ roll: '1d8+5+1d4', damage: 'nesmysl' })).toBe('1d8+5+1d4')
    expect(rollFor({ roll: '', damage: '1d6+4 bludgeoning' })).toBe('1d6+4')
    expect(rollFor({ roll: 'd6+4', damage: '' })).toBe('1d6+4')
    expect(rollFor({ roll: '', damage: '' })).toBeNull()
  })
})

describe('toHitRoll', () => {
  it('doplní 1 před d20', () => {
    expect(toHitRoll('d20+8')).toBe('1d20+8')
    expect(toHitRoll('+7')).toBe('1d20+7')
    expect(toHitRoll('d20-1')).toBe('1d20-1')
    expect(toHitRoll('')).toBeNull()
    expect(toHitRoll('auto')).toBeNull()
  })
})
