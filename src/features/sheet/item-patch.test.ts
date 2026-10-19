import { describe, expect, it } from 'vitest'
import { applyItemPatch } from './item-patch'
import type { CharacterItem } from './types'

const base: CharacterItem = {
  id: 'i', ruleId: null, name: 'Kopí', description: '', kind: 'weapon', quantity: 1, equipped: false, attuned: false, requiresAttunement: false,
  consumable: false, charges: null, curse: { text: 'Šepot', revealed: false }, rarity: null, armor: null, weapon: null, effects: [], notes: '',
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

  it('náboje ze vstupu si ponechají spotřebované, oříznuté na nové maximum', () => {
    const wand = { ...base, charges: { max: 7, used: 5, recharge: '1d6+1' } }
    expect(applyItemPatch(wand, { charges: { max: 7, recharge: 'all' } }).charges).toEqual({ max: 7, used: 5, recharge: 'all' })
    expect(applyItemPatch(wand, { charges: { max: 3, recharge: null } }).charges).toEqual({ max: 3, used: 3, recharge: null })
    expect(applyItemPatch(wand, { charges: null }).charges).toBeNull()
    expect(applyItemPatch(base, { charges: { max: 2, recharge: null } }).charges).toEqual({ max: 2, used: 0, recharge: null })
  })
})
