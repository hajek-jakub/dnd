import { describe, expect, it } from 'vitest'
import type { CharacterPreview } from '@/features/sheet/types'
import { sendersOf } from './senders'

const pc = (name: string, extra: Partial<CharacterPreview> = {}): CharacterPreview => ({
  id: name,
  campaignId: 'c',
  ownerId: 'u',
  kind: 'pc',
  name,
  race: '',
  classSummary: '',
  level: 1,
  photoVersion: null,
  access: 'public',
  ...extra,
})

describe('jméno v chatu', () => {
  it('ukáže postavu a jméno účtu schová', () => {
    const map = sendersOf([{ userId: 'u', displayName: 'Filip', role: 'player' }], [pc('Robinn')])
    expect(map.get('u')).toMatchObject({ name: 'Robinn', characterName: 'Robinn' })
  })

  it('bez postavy zůstane jméno účtu, NPC se nepočítá', () => {
    const npc = { ...pc('Goblin'), id: 'n', ownerId: null, kind: 'npc' as const }
    const map = sendersOf([{ userId: 'u', displayName: 'Filip', role: 'dm' }], [npc])
    expect(map.get('u')).toMatchObject({ name: 'Filip', characterName: null })
  })

  it('když má víc postav, vezme tu s fotkou', () => {
    const map = sendersOf([{ userId: 'u', displayName: 'Filip', role: 'player' }], [pc('První'), pc('S fotkou', { id: 'foto', photoVersion: '1' })])
    expect(map.get('u')?.name).toBe('S fotkou')
  })
})
