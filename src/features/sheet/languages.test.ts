import { describe, expect, it } from 'vitest'
import { LANGUAGE_CATALOG, languageLabel, languagesOf, withLanguage, withoutLanguage } from './languages'

describe('jazyky postavy (číselník)', () => {
  const extra = ['Language: Orc', 'Simple weapons', 'language:elvish']
  it('vybere jen jazyky', () => {
    expect(languagesOf(extra)).toEqual(['Orc', 'elvish'])
  })
  it('přidá jen jazyk z číselníku a nezdvojí ho (velikost písmen nevadí)', () => {
    expect(withLanguage(extra, 'Dwarvish')).toEqual([...extra, 'Language: Dwarvish'])
    expect(withLanguage(extra, 'ORC')).toEqual(extra)
    expect(withLanguage(extra, 'Skřetština')).toEqual(extra) // mimo číselník
    expect(withLanguage(extra, '  ')).toEqual(extra)
    expect(withLanguage([], 'deep speech')).toEqual(['Language: Deep Speech'])
  })
  it('odebere jazyk a nechá ostatní proficiencies', () => {
    expect(withoutLanguage(extra, 'orc')).toEqual(['Simple weapons', 'language:elvish'])
  })
  it('popisek je česky s anglickým názvem v závorce, neznámé zůstane', () => {
    expect(languageLabel('Orc')).toBe('Skřetí (Orc)')
    expect(languageLabel('elvish')).toBe('Elfí (Elvish)')
    expect(languageLabel('Klingon')).toBe('Klingon')
    expect(new Set(LANGUAGE_CATALOG.map((l) => l.name)).size).toBe(LANGUAGE_CATALOG.length)
  })
})
