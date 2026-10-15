import { describe, expect, it } from 'vitest'
import { placeholderDice } from './dice-visual'

describe('kostky z výrazu před odpovědí serveru', () => {
  it('rozloží výraz na kostky se znaménkem', () => {
    expect(placeholderDice('2d6+3')).toEqual({ dice: [{ sides: 6, sign: 1 }, { sides: 6, sign: 1 }], more: 0 })
    expect(placeholderDice('d20')).toEqual({ dice: [{ sides: 20, sign: 1 }], more: 0 })
    expect(placeholderDice('1d8+1d4-1d6').dice.map((d) => `${d.sign}d${d.sides}`)).toEqual(['1d8', '1d4', '-1d6'])
  })

  it('kritický zásah zdvojí počty kostek, konstanty se ignorují', () => {
    expect(placeholderDice('1d8+4', true).dice).toHaveLength(2)
    expect(placeholderDice('5', false).dice).toHaveLength(0)
  })

  it('příliš mnoho kostek se zkrátí na limit a zbytek se jen spočítá', () => {
    const r = placeholderDice('100d6')
    expect(r.dice).toHaveLength(8)
    expect(r.more).toBe(92)
    expect(placeholderDice('30d4', false, 5)).toMatchObject({ more: 25 })
  })
})
