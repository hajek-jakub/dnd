import { describe, expect, it } from 'vitest'
import type { LootEntry } from './api'
import { assign, countFor, goldShare, toRequest, unassign } from './distribution'

const item = (id: string): LootEntry => ({ id, folderId: null, position: 0, givenTo: '', kind: 'item', data: { name: `Item ${id}` } })
const gold = (id: string, gp: number): LootEntry => ({ id, folderId: null, position: 0, givenTo: '', kind: 'gold', data: { name: 'Truhla', currency: { gp } } })

describe('rozdávání lootu: přiřazení před rozdáním', () => {
  it('přiřadí víc položek jedné postavě a stejnou položku víc postavám bez duplicit', () => {
    let a = assign({}, ['meč', 'lektvar'], ['bob'])
    a = assign(a, ['meč'], ['bob', 'carol'])
    expect(a).toEqual({ meč: ['bob', 'carol'], lektvar: ['bob'] })
    expect(countFor(a, 'bob')).toBe(2)
    expect(countFor(a, 'carol')).toBe(1)
    expect(countFor(a, 'dave')).toBe(0)
  })

  it('odebere postavu z položky, poslední postava zruší celé přiřazení', () => {
    const a = { meč: ['bob', 'carol'], lektvar: ['bob'] }
    expect(unassign(a, 'meč', 'bob')).toEqual({ meč: ['carol'], lektvar: ['bob'] })
    expect(unassign(a, 'lektvar', 'bob')).toEqual({ meč: ['bob', 'carol'] })
    expect(unassign(a, 'meč')).toEqual({ lektvar: ['bob'] })
    expect(a).toEqual({ meč: ['bob', 'carol'], lektvar: ['bob'] }) // původní objekt se nemění
  })

  it('požadavek: jedno přiřazení na položku, zlato pro víc postav rovným dílem, zmizelé položky vynechá', () => {
    const entries = [item('meč'), gold('truhla', 100), gold('měšec', 5)]
    const a = { meč: ['bob', 'carol'], truhla: ['bob', 'carol', 'dave'], měšec: ['bob'], smazaná: ['bob'] }
    expect(toRequest(a, entries)).toEqual([
      { entryId: 'meč', characterIds: ['bob', 'carol'] },
      { entryId: 'truhla', characterIds: ['bob', 'carol', 'dave'], split: true },
      { entryId: 'měšec', characterIds: ['bob'] },
    ])
  })

  it('náhled dílu zlata počítá stejně jako server (zbytek zůstane DM)', () => {
    expect(goldShare({ gp: 100 }, 3)).toEqual({ each: '33 gp, 3 sp, 3 cp', leftoverCp: 1, tooSmall: false })
    expect(goldShare({ gp: 5, sp: 5 }, 1)).toEqual({ each: '5 gp, 5 sp', leftoverCp: 0, tooSmall: false })
    expect(goldShare({ cp: 2 }, 3).tooSmall).toBe(true)
  })
})
