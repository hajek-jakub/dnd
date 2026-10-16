import { describe, expect, it } from 'vitest'
import { applyOps } from './model'
import type { CharacterState } from './types'

const base: CharacterState = {
  hpCurrent: null,
  hpTemp: 0,
  deathSuccesses: 0,
  deathFailures: 0,
  hitDiceUsed: {},
  slotsUsed: {},
  pactSlotsUsed: 0,
  resources: {},
  conditions: [],
  concentration: null,
}
const extras = { inspiration: false }

describe('applyOps (optimistická verze serverových úprav)', () => {
  it('HP startují z maxima, jsou oříznuté na 0 a max', () => {
    expect(applyOps(base, [{ op: 'hp', delta: -5, max: 20 }], extras).state.hpCurrent).toBe(15)
    expect(applyOps({ ...base, hpCurrent: 3 }, [{ op: 'hp', delta: -9, max: 20 }], extras).state.hpCurrent).toBe(0)
    expect(applyOps({ ...base, hpCurrent: 18 }, [{ op: 'hp', delta: 9, max: 20 }], extras).state.hpCurrent).toBe(20)
  })

  it('poškození nejdřív spotřebuje dočasná HP', () => {
    const r = applyOps({ ...base, hpCurrent: 10, hpTemp: 4 }, [{ op: 'hp', delta: -6, max: 20 }], extras)
    expect(r.state).toMatchObject({ hpCurrent: 8, hpTemp: 0 })
    expect(applyOps({ ...base, hpCurrent: 10, hpTemp: 4 }, [{ op: 'hp', delta: -3, max: 20 }], extras).state).toMatchObject({
      hpCurrent: 10,
      hpTemp: 1,
    })
  })

  it('sloty, zdroje a kostky se ořezávají do mezí a zdroj startuje z maxima', () => {
    const r = applyOps(
      base,
      [
        { op: 'slot', level: 2, delta: 9, max: 3 },
        { op: 'resource', key: 'monk.ki', delta: -2, max: 5 },
        { op: 'hitDie', die: 'd8', delta: 1, max: 6 },
        { op: 'pact', delta: 1, max: 1 },
      ],
      extras,
    )
    expect(r.state.slotsUsed).toEqual({ '2': 3 })
    expect(r.state.resources).toEqual({ 'monk.ki': 3 })
    expect(r.state.hitDiceUsed).toEqual({ d8: 1 })
    expect(r.state.pactSlotsUsed).toBe(1)
  })

  it('death saves, inspirace a stavy', () => {
    const r = applyOps(
      base,
      [
        { op: 'deathSave', kind: 'failure', delta: 2 },
        { op: 'deathSave', kind: 'success', delta: 3 },
        { op: 'inspiration', set: true },
        { op: 'condition', name: 'Prone', set: true },
        { op: 'condition', name: 'Prone', set: true },
      ],
      extras,
    )
    expect(r.state).toMatchObject({ deathFailures: 2, deathSuccesses: 3, conditions: ['Prone'] })
    expect(r).toMatchObject({ inspiration: true })
  })

  it('koncentrace se nastaví a zruší', () => {
    expect(applyOps(base, [{ op: 'concentration', set: 'Bless' }], extras).state.concentration).toBe('Bless')
    expect(applyOps({ ...base, concentration: 'Bless' }, [{ op: 'concentration', set: null }], extras).state.concentration).toBeNull()
  })

  it('nemění původní stav (immutabilita)', () => {
    const state = { ...base, slotsUsed: { '1': 1 } }
    applyOps(state, [{ op: 'slot', level: 1, delta: 1, max: 4 }], extras)
    expect(state.slotsUsed).toEqual({ '1': 1 })
  })
})
