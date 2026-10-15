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
  attacks: { name: string; toHit: number; damage: string; damageType: string }[]
  inventory: { item: string; qty: number; equipped?: boolean; base?: string; magicBonus?: number; damageDice?: string; extraDamage?: string }[]
  sheetValues: {
    proficiencyBonus: number
    modifiers: Record<string, number>
    savingThrows: Record<string, number>
    skills: Record<string, number>
    passivePerception: number
    armorClass: number
    initiative: number
    kiMax: number
    kiSaveDC: number
    martialArtsDie: string
    eldritchBlastBeams: number
    darkOnesBlessingTempHp: number
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
  const nunchakuRow = seed.attacks.find((a) => a.name === 'Nunchaku')!
  const [extraDice, ...extraType] = (spearRow.extraDamage ?? '').split(' ')
  return [
    // Nunchaku nejsou v SRD: kostku a typ zranění seed bere z řádku útoku na papíře (homebrew d8), simple melee je odhad (viz CharacterSeeder)
    weapon('nunchaku', 'Nunchaku', { damageDice: nunchakuRow.damage.slice(0, nunchakuRow.damage.indexOf('+')), damageType: 'Bludgeoning', category: 'simple', range: 'melee', properties: ['Light'], weight: 1 }),
    weapon('crossbow', 'Light Crossbow', srdWeapon('Crossbow, light')),
    weapon('spear', 'Demonic Spear', { ...srdWeapon(spearRow.base!), damageDice: spearRow.damageDice ?? srdWeapon(spearRow.base!).damageDice }, {
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

  it('útoky z papíru (včetně Unarmed Strike a homebrew Nunchaku): k20, kostky i bonus ke zranění odpovídají', () => {
    for (const row of seed.attacks) {
      const attack = sheet.attacks.find((a) => a.name === (row.name === 'Crossbow' ? 'Light Crossbow' : row.name))
      expect(attack, row.name).toBeDefined()
      expect(attack!.toHit.value, `${row.name}: k20`).toBe(row.toHit)
      const m = /^(\d+d\d+)\+(\d+)/.exec(row.damage)!
      expect(attack!.damageBonus.value, `${row.name}: bonus ke zranění`).toBe(Number(m[2]))
      expect(attack!.damageDice, `${row.name}: kostka`).toBe(m[1])
    }
  })

  it('Demonic Spear: +1 magický bonus a 1d4 fire se propíšou do útoku', () => {
    const spear = sheet.attacks.find((a) => a.name === 'Demonic Spear')!
    expect(spear.toHit.value).toBe(8) // DEX 4 + proficiency 3 + magie 1
    expect(spear.damageBonus.value).toBe(5) // DEX 4 + magie 1
    expect(spear.damageDice).toBe('1d8') // homebrew: d8 místo d6 u obyčejného Spear
    expect(spear.extraDamage).toEqual([{ dice: '1d4', type: 'Fire' }])
  })
})

/** Dopočty, které engine zatím nemá jako samostatnou hodnotu: ověřují se z pravidel (SRD 5.1) a čísel enginu. */
describe('Hajoš ze seedu: další hodnoty z papíru', () => {
  it('martial arts kostka je d6 (pravidla 2014, Monk 5), jako na papíře', () => {
    expect(sheet.martialArtsDie).toBe(`1${v.martialArtsDie}`)
    const unarmed = sheet.attacks.find((a) => a.name === 'Unarmed Strike')!
    expect(unarmed.damageDice).toBe('1d6')
  })

  it('Ki: maximum 5 a DC záchranného hodu ki je 8 + proficiency + WIS = 13', () => {
    expect(sheet.resources.find((r) => r.key === 'monk.ki')?.max.value).toBe(v.kiMax)
    expect(8 + sheet.proficiencyBonus.value + sheet.abilities.wis.modifier).toBe(v.kiSaveDC)
  })

  it('Dark One\'s Blessing: dočasná HP = CHA modifikátor + level warlocka = 4 (jak je uložené v seedu)', () => {
    expect(sheet.abilities.cha.modifier + 1).toBe(v.darkOnesBlessingTempHp)
    expect(sheet.hp.temp).toBe(v.darkOnesBlessingTempHp)
  })

  it('Eldritch Blast má na celkovém levelu 6 dva paprsky (další přibývají na 5., 11. a 17. levelu)', () => {
    const beams = (level: number) => 1 + [5, 11, 17].filter((l) => level >= l).length
    expect(beams(sheet.totalLevel)).toBe(v.eldritchBlastBeams)
    expect([1, 4, 5, 10, 11, 16, 17, 20].map(beams)).toEqual([1, 1, 2, 2, 3, 3, 4, 4])
  })
})

/**
 * Rozdíly mezi papírem a enginem, které NEJSOU chyba výpočtu. Každý je vědomě zdokumentovaný, ať se nepletou do testů výše.
 */
describe('Hajoš ze seedu: známé rozdíly proti papíru', () => {
  it('Spell save DC warlocka: papír má 13, správně je 14 (8 + proficiency 3 + CHA 3)', () => {
    // Rozdíl NENÍ v seznamu discrepancies. Papírových 13 je DC záchranného hodu ki (8 + 3 + WIS 2), warlockovo DC je o 1 vyšší.
    const warlock = sheet.spellcasting.classes.find((c) => c.classIndex === 'warlock')!
    expect(warlock.saveDc.value).toBe(14)
    expect(v.warlockSpellSaveDC).toBe(13)
  })
})
