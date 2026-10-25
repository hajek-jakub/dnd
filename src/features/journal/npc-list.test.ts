import { describe, expect, it } from 'vitest'
import { filterNpcs, groupByLetter, letterOf, sortNpcs } from './npc-list'
import type { JournalNpc } from './npc-api'

const npc = (name: string, extra: Partial<JournalNpc> = {}): JournalNpc => ({
  id: name,
  name,
  race: '',
  description: '',
  visibility: 'all',
  characterId: null,
  characterKind: null,
  photoVersion: null,
  createdBy: 'u',
  createdByName: 'U',
  mine: true,
  canEdit: true,
  places: [],
  createdAt: '',
  updatedAt: '',
  ...extra,
})

describe('seznam NPC', () => {
  it('řadí abecedně podle češtiny a ignoruje velikost písmen', () => {
    expect(sortNpcs([npc('zelda'), npc('Čmuchal'), npc('Alrik'), npc('Cyril'), npc('hana')]).map((n) => n.name)).toEqual(['Alrik', 'Cyril', 'Čmuchal', 'hana', 'zelda'])
  })

  it('písmeno je bez diakritiky, ostatní znaky jsou pod #', () => {
    expect(letterOf('Čmuchal')).toBe('C')
    expect(letterOf('  řezník')).toBe('R')
    expect(letterOf('3 bratři')).toBe('#')
    expect(letterOf('')).toBe('#')
  })

  it('rozdělí na písmena a # dá na konec', () => {
    const groups = groupByLetter([npc('Zelda'), npc('7 trpaslíků'), npc('Čmuchal'), npc('Cyril'), npc('Alrik')])
    expect(groups.map((g) => g.letter)).toEqual(['A', 'C', 'Z', '#'])
    expect(groups[1]!.npcs.map((n) => n.name)).toEqual(['Cyril', 'Čmuchal'])
  })

  it('hledá ve jménu, rase i popisu bez diakritiky a filtruje podle původu', () => {
    const list = [npc('Gorim', { race: 'Trpaslík' }), npc('Hajoš', { characterKind: 'pc', characterId: 'c1', description: 'mnich' }), npc('Tom', { characterKind: 'npc', characterId: 'c2' })]
    expect(filterNpcs(list, 'trpaslik', 'all').map((n) => n.name)).toEqual(['Gorim'])
    expect(filterNpcs(list, 'MNICH', 'all').map((n) => n.name)).toEqual(['Hajoš'])
    expect(filterNpcs(list, '', 'character').map((n) => n.name)).toEqual(['Hajoš'])
    expect(filterNpcs(list, '', 'npc').map((n) => n.name)).toEqual(['Gorim', 'Tom'])
  })
})
