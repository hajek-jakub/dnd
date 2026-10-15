// @vitest-environment node
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { ABILITIES, SKILLS, computeSheet, initialState, type AbilityKey, type InventoryItem, type SkillKey } from './index'
import { levelsOf, loadBundle, makeInput } from './test-helpers'

/**
 * Hajoš z papírového sheetu (seed/hajos.json) jako fixture pro engine: z VSTUPŮ ze seedu (staty, třídy, proficiencies, itemy)
 * engine dopočítá stejná čísla, jaká jsou na papíře v sekci sheetValues. Výjimky jsou vypsané níže a každá má důvod.
 */
const ROOT = path.resolve(import.meta.dirname, '../..')
const seed = JSON.parse(readFileSync(path.join(ROOT, 'seed/hajos.json'), 'utf8')) as SeedFile
const bundle = loadBundle()

interface SeedFile {
  abilityScores: Record<string, number>
  proficiencies: { skills: string[]; expertise: string[]; savingThrows: string[] }
  hitPoints: { max: number; current: number; temp: number }
  attacks: { name: string; toHit: number; damage: string }[]
  inventory: { item: string; qty: number; equipped?: boolean; base?: string; magicBonus?: number; extraDamage?: string }[]
  sheetValues: {
    proficiencyBonus: number
    modifiers: Record<string, number>
    savingThrows: Record<string, number>
    skills: Record<string, number>
    passivePerception: number
    armorClass: number
    initiative: number
    kiMax: number
    warlockSpellSaveDC: number
    warlockSpellAttack: number
    discrepancies: string[]
  }
}

// --- SRD data zbraní (stejná, jaká se seedují do DB), aby si test staty nevymýšlel
interface SrdEquipment {
  name: string
  weapon_category?: string
  weapon_range?: string
  damage?: { damage_dice: string; damage_type: { name: string } }
  properties?: { name: string }[]
  weight?: number
}
const srd = JSON.parse(readFileSync(path.join(ROOT, 'api/data/srd51/5e-SRD-Equipment.json'), 'utf8')) as SrdEquipment[]

function srdWeapon(name: string) {
  const e = srd.find((x) => x.name.toLowerCase() === name.toLowerCase())
  if (!e?.damage) throw new Error(`SRD zbraň ${name} nenalezena`)
  return {
    damageDice: e.damage.damage_dice,
    damageType: e.damage.damage_type.name,
    category: e.weapon_category?.toLowerCase() === 'martial' ? ('martial' as const) : ('simple' as const),
    range: e.weapon_range?.toLowerCase() === 'ranged' ? ('ranged' as const) : ('melee' as const),
    properties: (e.properties ?? []).map((p) => p.name),
    weight: e.weight ?? 0,
  }
}

/** Itemy tak, jak je z inventáře ze seedu vyrobí server (SRD zbraně, homebrew Nunchaku a Demonic Spear podle seed skriptu). */
function inventoryFromSeed(): InventoryItem[] {
  const weapon = (id: string, name: string, stats: ReturnType<typeof srdWeapon>, extra: Partial<NonNullable<InventoryItem['weapon']>> = {}): InventoryItem => ({
    id,
    name,
    kind: 'weapon',
    quantity: seed.inventory.find((i) => i.item === name)?.qty ?? 1,
    weight: stats.weight,
    equipped: true, // zbraně s řádkem v sekci attacks se nosí v ruce
    attuned: false,
    requiresAttunement: false,
    weapon: { damageDice: stats.damageDice, damageType: stats.damageType, category: stats.category, range: stats.range, properties: stats.properties, ...extra },
    effects: [],
  })
  const spearRow = seed.inventory.find((i) => i.item === 'Demonic Spear')!
  const [extraDice, ...extraType] = (spearRow.extraDamage ?? '').split(' ')
  return [
    // Nunchaku nejsou v SRD a papír k nim neříká víc než název: základ 1d6 bludgeoning, simple, melee, Light (viz CharacterSeeder)
    weapon('nunchaku', 'Nunchaku', { damageDice: '1d6', damageType: 'Bludgeoning', category: 'simple', range: 'melee', properties: ['Light'], weight: 1 }),
    weapon('crossbow', 'Light Crossbow', srdWeapon('Crossbow, light')),
    weapon('spear', 'Demonic Spear', srdWeapon(spearRow.base!), {
      magicBonus: spearRow.magicBonus,
      extraDamage: [{ dice: extraDice!, type: extraType.join(' ').replace(/^./, (c) => c.toUpperCase()) }],
    }),
    weapon('dart', 'Dart', srdWeapon('Dart')),
  ]
}

const skillKey = (name: string): SkillKey => {
  const key = name.toLowerCase().replace(/ /g, '-')
  const found = SKILLS.find((s) => s.key === key)
  if (!found) throw new Error(`Neznámá dovednost ${name}`)
  return found.key
}

const input = makeInput({
  scores: Object.fromEntries(ABILITIES.map((a) => [a, seed.abilityScores[a.toUpperCase()]])) as Record<AbilityKey, number>,
  levels: levelsOf(['monk', 5], ['warlock', 1]),
  subclasses: { monk: 'open-hand', warlock: 'fiend' },
  skillProficiencies: {
    ...Object.fromEntries(seed.proficiencies.skills.map((s) => [skillKey(s), 1])),
    ...Object.fromEntries(seed.proficiencies.expertise.map((s) => [skillKey(s), 2])),
  },
  // Savy STR a DEX dává Monk sám (první třída), do vstupu se nic navíc neukládá.
  extraSaveProficiencies: [],
  items: inventoryFromSeed(),
  state: { ...initialState(seed.hitPoints.current), hpTemp: seed.hitPoints.temp },
})
const sheet = computeSheet(input, bundle)
const v = seed.sheetValues

describe('Hajoš ze seedu: engine vychází stejně jako papírový sheet', () => {
  it('nic z dopočítaných hodnot se do vstupu neukládá jako override', () => {
    expect(input.overrides).toEqual({})
  })

  it('proficiency bonus, modifikátory, HP a pasivní vnímání', () => {
    expect(sheet.proficiencyBonus.value).toBe(v.proficiencyBonus)
    for (const a of ABILITIES) expect(sheet.abilities[a].modifier, `modifikátor ${a}`).toBe(v.modifiers[a.toUpperCase()])
    expect(sheet.hp.max.value).toBe(seed.hitPoints.max)
    expect(sheet.hp.current).toBe(seed.hitPoints.current)
    expect(sheet.hp.temp).toBe(seed.hitPoints.temp)
    expect(sheet.passivePerception.value).toBe(v.passivePerception)
  })

  it('záchranné hody (včetně opraveného STR +3)', () => {
    for (const a of ABILITIES) expect(sheet.saves[a].value, `save ${a}`).toBe(v.savingThrows[a.toUpperCase()])
    expect(sheet.saves.str.value).toBe(3) // papír: "+5 +3", správně 3 (STR 0 + proficiency 3)
  })

  it('dovednosti (včetně opraveného Stealth +7)', () => {
    expect(Object.keys(v.skills)).toHaveLength(SKILLS.length)
    for (const [label, expected] of Object.entries(v.skills)) {
      expect(sheet.skills[skillKey(label)].value, label).toBe(expected)
    }
    expect(sheet.skills.stealth.value).toBe(7) // papír: +6, správně DEX 4 + proficiency 3
  })

  it('AC (Unarmored Defense), iniciativa, rychlost, ki a sloty', () => {
    expect(sheet.ac.value).toBe(v.armorClass)
    expect(sheet.ac.sources.map((s) => s.label).join(' ')).toMatch(/Unarmored/i)
    expect(sheet.initiative.value).toBe(v.initiative)
    expect(sheet.speed.value).toBe(40) // 30 + 10 Unarmored Movement
    expect(sheet.resources.find((r) => r.key === 'monk.ki')?.max.value).toBe(v.kiMax)
    expect(sheet.spellcasting.pact).toMatchObject({ count: 1, level: 1 })
  })

  it('spell attack warlocka', () => {
    const warlock = sheet.spellcasting.classes.find((c) => c.classIndex === 'warlock')!
    expect(warlock.ability).toBe('cha')
    expect(warlock.attackBonus.value).toBe(v.warlockSpellAttack)
  })

  it('útoky z papíru: k20 a kostky odpovídají (kromě rozdílů 2014/2024 níže)', () => {
    for (const row of seed.attacks) {
      const attack = sheet.attacks.find((a) => a.name === (row.name === 'Crossbow' ? 'Light Crossbow' : row.name))
      expect(attack, row.name).toBeDefined()
      expect(attack!.toHit.value, `${row.name}: k20`).toBe(row.toHit)
      const m = /^(\d+d\d+)\+(\d+)/.exec(row.damage)!
      expect(attack!.damageBonus.value, `${row.name}: bonus ke zranění`).toBe(Number(m[2]))
      if (row.name !== 'Nunchaku') expect(attack!.damageDice, `${row.name}: kostka`).toBe(m[1])
    }
  })

  it('Demonic Spear: +1 magický bonus a 1d4 fire se propíšou do útoku', () => {
    const spear = sheet.attacks.find((a) => a.name === 'Demonic Spear')!
    expect(spear.toHit.value).toBe(8) // DEX 4 + proficiency 3 + magie 1
    expect(spear.damageBonus.value).toBe(5) // DEX 4 + magie 1
    expect(spear.damageDice).toBe('1d6')
    expect(spear.extraDamage).toEqual([{ dice: '1d4', type: 'Fire' }])
  })
})

/**
 * Rozdíly mezi papírem a enginem, které NEJSOU chyba výpočtu. Každý je vědomě zdokumentovaný, ať se nepletou do testů výše.
 */
describe('Hajoš ze seedu: známé rozdíly proti papíru', () => {
  it('martial arts kostka: engine počítá pravidla 2014 (d6 na Monk 5), papír má d8 podle 2024', () => {
    expect(sheet.martialArtsDie).toBe('1d6')
    const nunchaku = sheet.attacks.find((a) => a.name === 'Nunchaku')!
    expect(nunchaku.damageDice).toBe('1d6') // papír: 1d8+4
    expect(nunchaku.damageBonus.value).toBe(4)
  })

  it('Spell save DC warlocka: papír má 13, správně je 14 (8 + proficiency 3 + CHA 3)', () => {
    // Rozdíl NENÍ v seznamu discrepancies. Papírových 13 je nejspíš DC záchranného hodu ki (8 + 3 + WIS 2).
    const warlock = sheet.spellcasting.classes.find((c) => c.classIndex === 'warlock')!
    expect(warlock.saveDc.value).toBe(14)
    expect(v.warlockSpellSaveDC).toBe(13)
    expect(8 + sheet.proficiencyBonus.value + sheet.abilities.wis.modifier).toBe(v.warlockSpellSaveDC)
  })

  it('Demonic Spear: versatile 1d8 se v útoku nemodeluje (engine ukazuje jednoruční 1d6)', () => {
    expect(sheet.attacks.find((a) => a.name === 'Demonic Spear')!.damageDice).toBe('1d6')
  })
})

/** Papír je psaný podle pravidel 2024: s nimi sedí i martial arts kostka a útok Nunchaku (1d8+4). */
describe('Hajoš ze seedu: kampaň s pravidly 2024', () => {
  const sheet2024 = computeSheet({ ...input, rules: { ruleset: '2024' } }, bundle)

  it('martial arts d8 a Nunchaku 1d8+4 přesně podle papíru', () => {
    expect(sheet2024.martialArtsDie).toBe('1d8')
    const row = seed.attacks.find((a) => a.name === 'Nunchaku')!
    const nunchaku = sheet2024.attacks.find((a) => a.name === 'Nunchaku')!
    expect(row.damage).toBe('1d8+4')
    expect(nunchaku.damageDice).toBe('1d8')
    expect(nunchaku.damageBonus.value).toBe(4)
    expect(nunchaku.toHit.value).toBe(row.toHit)
  })

  it('Focus Points: maximum 5 jako ki na papíře', () => {
    const fp = sheet2024.resources.find((r) => r.key === 'monk.ki')!
    expect(fp.name).toBe('Focus Points')
    expect(fp.max.value).toBe(v.kiMax)
  })

  it('ostatní čísla z papíru zůstávají stejná jako v 2014', () => {
    expect(sheet2024.ac.value).toBe(v.armorClass)
    expect(sheet2024.proficiencyBonus.value).toBe(v.proficiencyBonus)
    expect(sheet2024.hp.max.value).toBe(seed.hitPoints.max)
  })
})
