import { describe, expect, it } from 'vitest'
import { groupOf, proficiencyEntries, withProficiency, withoutProficiency } from './proficiencies'

describe('proficiencies', () => {
  it('rozdělí proficiencies z třídy podle názvu a vlastní podle předpony', () => {
    expect(groupOf('Light Armor')).toBe('armor')
    expect(groupOf('Shields')).toBe('armor')
    expect(groupOf('Martial Weapons')).toBe('weapon')
    expect(groupOf('Longswords')).toBe('weapon')
    expect(groupOf("Thieves' Tools")).toBe('tool')
    expect(groupOf('Herbalism Kit')).toBe('tool')
    expect(groupOf("Tool: Navigator's Tools")).toBe('tool')
    expect(groupOf('Weapon: Harpoon')).toBe('weapon')
    expect(groupOf('Firearms (Cowboy Marksmanship)')).toBe('weapon')
  })

  it('jazyky vynechá, z třídy jsou jen ty, které nejsou mezi vlastními', () => {
    const extra = ['Language: Elvish', "Tool: Smith's Tools"]
    const list = proficiencyEntries(['Light Armor', 'Simple Weapons', ...extra], extra)
    expect(list.map((p) => [p.name, p.group, p.fromClass])).toEqual([
      ['Light Armor', 'armor', true],
      ['Simple Weapons', 'weapon', true],
      ["Smith's Tools", 'tool', false],
    ])
  })

  it('přidá s předponou (engine pak zná proficiency se zbraní), bez duplicit; odebere přesný zápis', () => {
    const a = withProficiency([], 'weapon', '  Longbow ')
    expect(a).toEqual(['Weapon: Longbow'])
    expect(withProficiency(a, 'weapon', 'longbow')).toBe(a)
    expect(withProficiency(a, 'other', 'Vehicles (land)')).toEqual(['Weapon: Longbow', 'Vehicles (land)'])
    expect(withProficiency(a, 'tool', '')).toBe(a)
    expect(withoutProficiency(['Language: Orc', 'Weapon: Longbow'], 'Weapon: Longbow')).toEqual(['Language: Orc'])
  })
})
