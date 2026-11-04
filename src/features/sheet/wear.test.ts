import { describe, expect, it } from 'vitest'
import { isThievesTools, tracksBreakage, wearHint } from './wear'

describe('opotřebení zbraně', () => {
  it('počítadlo mají zbraně a Thieves’ Tools, zbroj ne', () => {
    expect(tracksBreakage({ kind: 'weapon', name: 'Dagger' })).toBe(true)
    expect(tracksBreakage({ kind: 'other', name: "Thieves' Tools" })).toBe(true)
    expect(tracksBreakage({ kind: 'other', name: 'Thieves Tools' })).toBe(true)
    expect(isThievesTools('  THIEVES’ TOOLS ')).toBe(true)
    expect(tracksBreakage({ kind: 'armor', name: 'Leather Armor' })).toBe(false)
    expect(tracksBreakage({ kind: 'other', name: 'Rope' })).toBe(false)
  })

  it('nula je čerstvá věc, rozbitá se opravou vynuluje', () => {
    expect(wearHint(0, false)).toContain('zvedni na 1')
    expect(wearHint(3, false)).toContain('víc než 3')
    expect(wearHint(4, true)).toContain('Oprava')
  })
})
