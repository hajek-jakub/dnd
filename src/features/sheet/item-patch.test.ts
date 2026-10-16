import { describe, expect, it } from 'vitest'
import { applyItemPatch } from './item-patch'
import type { CharacterItem } from './types'

const base: CharacterItem = {
  id: 'i', ruleId: null, name: 'Kopí', description: '', kind: 'weapon', quantity: 1, equipped: false, attuned: false, requiresAttunement: false,
  consumable: false, curse: { text: 'Šepot', revealed: false }, rarity: null, armor: null, weapon: null, effects: [], notes: '',
}

describe('optimistická změna itemu', () => {
  it('kletba ze vstupu (text) má v cache tvar {text, revealed}', () => {
    expect(applyItemPatch(base, { name: 'Nové kopí', curse: 'Jiný šepot', curseRevealed: true })).toMatchObject({ name: 'Nové kopí', curse: { text: 'Jiný šepot', revealed: true } })
    expect(applyItemPatch(base, { curse: null }).curse).toBeNull()
  })

  it('samotné odhalení kletbu ponechá a změní jen revealed; bez kletby nic', () => {
    expect(applyItemPatch(base, { curseRevealed: true }).curse).toEqual({ text: 'Šepot', revealed: true })
    expect(applyItemPatch({ ...base, curse: null }, { curseRevealed: true }).curse).toBeNull()
    expect(applyItemPatch(base, { equipped: true })).toMatchObject({ equipped: true, curse: { text: 'Šepot', revealed: false } })
  })
})
