import { describe, expect, it } from 'vitest'
import { languagesOf, withLanguage, withoutLanguage } from './languages'

describe('jazyky postavy', () => {
  const extra = ['Language: Orc', 'Simple weapons', 'language:elvish']
  it('vybere jen jazyky', () => {
    expect(languagesOf(extra)).toEqual(['Orc', 'elvish'])
  })
  it('přidá jazyk a nezdvojí ho (velikost písmen nevadí)', () => {
    expect(withLanguage(extra, 'Dwarvish')).toEqual([...extra, 'Language: Dwarvish'])
    expect(withLanguage(extra, 'ORC')).toEqual(extra)
    expect(withLanguage(extra, '  ')).toEqual(extra)
    expect(withLanguage(extra, 'x'.repeat(41))).toEqual(extra)
  })
  it('odebere jazyk a nechá ostatní proficiencies', () => {
    expect(withoutLanguage(extra, 'orc')).toEqual(['Simple weapons', 'language:elvish'])
  })
})
