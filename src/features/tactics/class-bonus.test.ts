import { describe, expect, it } from 'vitest'
import { NO_CLASS_BONUS, withClassBonus } from './damage'

describe('withClassBonus', () => {
  it('Rage a Sneak Attack se přidají jen položce s příznakem', () => {
    const bonus = { rage: 2, sneak: '3d6' }
    expect(withClassBonus('1d12+3', { rage: true }, bonus)).toBe('1d12+3+2')
    expect(withClassBonus('1d6+4', { sneak: true }, bonus)).toBe('1d6+4+3d6')
    expect(withClassBonus('1d6+4', { rage: true, sneak: true }, bonus)).toBe('1d6+4+2+3d6')
    expect(withClassBonus('1d6+4', {}, bonus)).toBe('1d6+4')
  })

  it('bez zapnutého Rage a Sneak Attack se nic nepřidá', () => {
    expect(withClassBonus('1d12+3', { rage: true, sneak: true }, NO_CLASS_BONUS)).toBe('1d12+3')
  })
})
