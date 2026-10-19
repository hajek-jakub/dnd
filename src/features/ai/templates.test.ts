import { describe, expect, it } from 'vitest'
import { AI_TEMPLATES, defaults, missing, roomsWord } from './templates'

const byId = (id: string) => AI_TEMPLATES.find((t) => t.id === id)!

describe('šablony AI pomocníka', () => {
  it('dungeon složí zadání s počtem místností, obtížností a levelem', () => {
    const t = byId('dungeon')
    const text = t.compose({ ...defaults(t), name: 'Zatopený chrám', rooms: 3, difficulty: 'těžká', level: '4' })
    expect(text).toContain('Připrav dungeon „Zatopený chrám“ s 3 místnostmi, téma: starobylá hrobka s nemrtvými.')
    expect(text).toContain('Obtížnost setkání: těžká. Družina je na 4. levelu.')
    expect(text).toContain('Každou místnost dej jako samostatný návrh')
  })

  it('bez levelu nechá AI zjistit družinu', () => {
    const t = byId('encounter')
    const text = t.compose(defaults(t))
    expect(text).toContain('Level a počet postav zjisti z družiny.')
    expect(text).toContain('nepřátele vyber sám ze SRD')
    expect(text).toContain('Přidej loot, který z nepřátel padá')
    expect(t.compose({ ...defaults(t), enemies: 'vlci', loot: false })).toMatch(/nepřátelé: vlci\.[\s\S]*Loot nepřidávej/)
  })

  it('obchod chce ceny z pravidel za celou položku', () => {
    const t = byId('shop')
    expect(t.compose({ ...defaults(t), count: 12 })).toContain('asi 12 položek')
    expect(t.compose(defaults(t))).toContain('cena je za celou položku')
  })

  it('povinná políčka a skloňování', () => {
    const rules = byId('rules')
    expect(missing(rules, defaults(rules))).toBe('Na co se chceš zeptat')
    expect(missing(rules, { question: 'grappling' })).toBeNull()
    expect(missing(byId('dungeon'), { ...defaults(byId('dungeon')), level: '' })).toBeNull()
    expect(roomsWord(1)).toBe('1 místností')
    expect(roomsWord(5)).toBe('5 místnostmi')
  })

  it('každá šablona má výchozí hodnoty pro všechna políčka', () => {
    for (const t of AI_TEMPLATES) {
      expect(Object.keys(defaults(t)).sort()).toEqual(t.fields.map((f) => f.key).sort())
      if (t.id !== 'rules') expect(missing(t, defaults(t))).toBeNull()
    }
  })
})
