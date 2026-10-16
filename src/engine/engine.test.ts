// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  MULTICLASS_SLOTS,
  abilityModifier,
  activeEffects,
  averageRoll,
  canAttune,
  casterLevel,
  computeSheet,
  groupClasses,
  hasAbilityScoreImprovement,
  hpGainForLevel,
  initialState,
  longRest,
  maxSpellLevel,
  multiclassProblems,
  newSpellAllowance,
  pactSlots,
  shortRest,
  spellSlots,
  spendHitDie,
} from './index'
import { item, levelsOf, loadBundle, makeInput } from './test-helpers'

const bundle = loadBundle()

/** Povinný testovací případ ze zadání: Hajoš, Monk 5 (Way of the Open Hand) / Warlock 1 (The Fiend). */
function hajos(overrides: Parameters<typeof makeInput>[0] = {}) {
  return makeInput({
    scores: { str: 10, dex: 16, con: 14, int: 8, wis: 15, cha: 14 },
    levels: levelsOf(['monk', 5], ['warlock', 1]),
    subclasses: { monk: 'open-hand', warlock: 'fiend' },
    skillProficiencies: { acrobatics: 1, perception: 1, stealth: 2 },
    ...overrides,
  })
}

describe('Hajoš: Monk 5 (Open Hand) / Warlock 1 (Fiend)', () => {
  const sheet = computeSheet(hajos(), bundle)

  it('má proficiency bonus +3 (celkový level 6)', () => {
    expect(sheet.totalLevel).toBe(6)
    expect(sheet.proficiencyBonus.value).toBe(3)
    expect(sheet.classSummary).toBe('Monk 5 / Warlock 1')
  })

  it('má 5 ki bodů, obnovují se na short rest', () => {
    const ki = sheet.resources.find((r) => r.key === 'monk.ki')
    expect(ki).toMatchObject({ name: 'Ki', current: 5, recharge: 'short' })
    expect(ki?.max.value).toBe(5)
  })

  it('má martial arts d6 a unarmored movement +10 ft', () => {
    expect(sheet.martialArtsDie).toBe('1d6')
    expect(sheet.speed.value).toBe(40)
    expect(sheet.speed.sources).toContainEqual({ label: 'Unarmored Movement', value: '+10' })
  })

  it('počítá Unarmored Defense mnicha: 10 + DEX + WIS', () => {
    expect(sheet.ac.value).toBe(10 + 3 + 2)
    expect(sheet.ac.overridden).toBe(false)
    expect(sheet.ac.sources.map((s) => s.label)).toEqual(expect.arrayContaining(['DEX', 'WIS']))
  })

  it('má 1 pact slot 1. úrovně (short rest) a žádné běžné sloty', () => {
    expect(sheet.spellcasting.slots).toEqual([])
    expect(sheet.spellcasting.casterLevel).toBe(0)
    expect(sheet.spellcasting.pact).toEqual({ count: 1, level: 1, used: 0 })
  })

  it('počítá spell save DC warlocka z CHA (8 + 3 + 2)', () => {
    expect(sheet.spellcasting.classes).toHaveLength(1)
    expect(sheet.spellcasting.classes[0]).toMatchObject({ classIndex: 'warlock', ability: 'cha', cantripsKnown: 2, spellsKnown: 2 })
    expect(sheet.spellcasting.classes[0]?.saveDc.value).toBe(13)
    expect(sheet.spellcasting.classes[0]?.attackBonus.value).toBe(5)
  })

  it('má Extra Attack, Stunning Strike a Open Hand Technique ve featurách', () => {
    const names = sheet.features.map((f) => f.name)
    expect(names).toEqual(
      expect.arrayContaining([
        'Extra Attack',
        'Stunning Strike',
        'Open Hand Technique',
        'Ki',
        'Unarmored Defense',
        'Martial Arts',
        'Pact Magic',
        "Dark One's Blessing",
      ]),
    )
    expect(sheet.features.find((f) => f.name === 'Open Hand Technique')).toMatchObject({ source: 'subclass', level: 3 })
    expect(sheet.attacksPerAction).toBe(2)
  })

  it('záchrany: proficient jen STR a DEX (výchozí třída mnich)', () => {
    expect(sheet.saves.str.proficient).toBe(true)
    expect(sheet.saves.dex.proficient).toBe(true)
    expect(sheet.saves.wis.proficient).toBe(false)
    expect(sheet.saves.dex.value).toBe(3 + 3)
    expect(sheet.saves.wis.value).toBe(2)
  })

  it('HP: první level plná kostka, další průměr; hit dice d8 x 6', () => {
    // mnich: 8+2, pak 4x(5+2), warlock 5+2
    expect(sheet.hp.max.value).toBe(10 + 4 * 7 + 7)
    expect(sheet.hitDice).toEqual([{ die: 'd8', total: 6, used: 0, remaining: 6 }])
  })

  it('útok beze zbraně používá martial arts a DEX', () => {
    const unarmed = sheet.attacks.find((a) => a.id === 'unarmed')!
    expect(unarmed.ability).toBe('dex')
    expect(unarmed.damageDice).toBe('1d6')
    expect(unarmed.toHit.value).toBe(3 + 3)
    expect(unarmed.damageBonus.value).toBe(3)
  })

  it('dovednosti a pasivní vnímání', () => {
    expect(sheet.skills.stealth.value).toBe(3 + 6) // DEX + expertise
    expect(sheet.skills.perception.value).toBe(2 + 3)
    expect(sheet.passivePerception.value).toBe(10 + 5)
  })
})

describe('proficiency bonus podle celkového levelu', () => {
  it.each([
    [1, 2],
    [4, 2],
    [5, 3],
    [8, 3],
    [9, 4],
    [12, 4],
    [13, 5],
    [16, 5],
    [17, 6],
    [20, 6],
  ])('level %i -> +%i', (level, expected) => {
    expect(computeSheet(makeInput({ levels: levelsOf(['fighter', level]) }), bundle).proficiencyBonus.value).toBe(expected)
  })
})

describe('spell sloty', () => {
  it('Wizard 3 / Cleric 2 používá multiclass tabulku (caster level 5)', () => {
    const classes = groupClasses({ levels: levelsOf(['wizard', 3], ['cleric', 2]), subclasses: {} })
    expect(casterLevel(bundle, classes)).toBe(5)
    expect(spellSlots(bundle, classes)).toEqual([4, 3, 2, 0, 0, 0, 0, 0, 0])
    const sheet = computeSheet(makeInput({ levels: levelsOf(['wizard', 3], ['cleric', 2]), scores: { int: 16, wis: 14 } }), bundle)
    expect(sheet.spellcasting.slots).toEqual([
      { level: 1, max: 4, used: 0 },
      { level: 2, max: 3, used: 0 },
      { level: 3, max: 2, used: 0 },
    ])
    // každá třída má vlastní DC a ability
    const wizard = sheet.spellcasting.classes.find((c) => c.classIndex === 'wizard')!
    const cleric = sheet.spellcasting.classes.find((c) => c.classIndex === 'cleric')!
    expect(wizard.saveDc.value).toBe(8 + 3 + 3)
    expect(cleric.saveDc.value).toBe(8 + 3 + 2)
    expect(wizard.preparedMax).toBe(3 + 3)
    expect(cleric.preparedMax).toBe(2 + 2)
  })

  it('Paladin 5 (half caster) má sloty 4 / 2', () => {
    const sheet = computeSheet(makeInput({ levels: levelsOf(['paladin', 5]), scores: { cha: 16 } }), bundle)
    expect(sheet.spellcasting.slots).toEqual([
      { level: 1, max: 4, used: 0 },
      { level: 2, max: 2, used: 0 },
    ])
    expect(sheet.spellcasting.classes[0]?.preparedMax).toBe(3 + 2)
  })

  it('jednoslotová tabulka odpovídá SRD pro všechny plné a poloviční sesilatele a všechny levely', () => {
    for (const cls of ['bard', 'cleric', 'druid', 'sorcerer', 'wizard', 'paladin', 'ranger']) {
      for (let level = 1; level <= 20; level++) {
        const table = bundle.classes[cls]!.levels[level]!.spellcasting!
        const expected = Array.from({ length: 9 }, (_, i) => table[`spell_slots_level_${i + 1}`] ?? 0)
        expect(spellSlots(bundle, [{ classIndex: cls, level }]), `${cls} ${level}`).toEqual(expected)
      }
    }
  })

  it('tabulka multiclass má 20 řádků', () => {
    expect(Object.keys(MULTICLASS_SLOTS)).toHaveLength(20)
  })

  it('Paladin 4 / Wizard 3: půlka paladina + celý wizard = caster level 5', () => {
    const classes = groupClasses({ levels: levelsOf(['paladin', 4], ['wizard', 3]), subclasses: {} })
    expect(casterLevel(bundle, classes)).toBe(2 + 3)
  })

  it('Warlock má pact magic zvlášť a nepřičítá se k běžným slotům', () => {
    const classes = groupClasses({ levels: levelsOf(['warlock', 5]), subclasses: {} })
    expect(pactSlots(bundle, classes)).toEqual({ count: 2, level: 3 })
    expect(spellSlots(bundle, classes)).toEqual(Array(9).fill(0))

    const mixed = computeSheet(makeInput({ levels: levelsOf(['warlock', 3], ['wizard', 3]), scores: { int: 16, cha: 14 } }), bundle)
    expect(mixed.spellcasting.slots.map((s) => [s.level, s.max])).toEqual([
      [1, 4],
      [2, 2],
    ]) // jen wizard 3
    expect(mixed.spellcasting.pact).toEqual({ count: 2, level: 2, used: 0 }) // warlock 3
  })

  it('utracené sloty se promítnou do used', () => {
    const state = { ...initialState(10), slotsUsed: { '1': 2 }, pactSlotsUsed: 1 }
    const sheet = computeSheet(makeInput({ levels: levelsOf(['warlock', 2], ['wizard', 1]), state }), bundle)
    expect(sheet.spellcasting.slots[0]).toEqual({ level: 1, max: 2, used: 2 })
    expect(sheet.spellcasting.pact?.used).toBe(1)
  })
})

describe('AC', () => {
  it('barbar používá Unarmored Defense 10 + DEX + CON, štít se přičte', () => {
    const base = makeInput({ levels: levelsOf(['barbarian', 3]), scores: { dex: 14, con: 16 } })
    expect(computeSheet(base, bundle).ac.value).toBe(10 + 2 + 3)
    const withShield = {
      ...base,
      items: [item({ id: 's', name: 'Shield', kind: 'shield', armor: { base: 2, dexBonus: false, maxDexBonus: null } })],
    }
    expect(computeSheet(withShield, bundle).ac.value).toBe(17)
  })

  it('mnich se štítem ztratí Unarmored Defense', () => {
    const input = makeInput({
      levels: levelsOf(['monk', 3]),
      scores: { dex: 16, wis: 16 },
      items: [item({ id: 's', name: 'Shield', kind: 'shield', armor: { base: 2, dexBonus: false, maxDexBonus: null } })],
    })
    expect(computeSheet(input, bundle).ac.value).toBe(10 + 3 + 2) // 10 + DEX + štít
  })

  it('zbroj respektuje limit DEX a těžká zbroj DEX ignoruje', () => {
    const scores = { dex: 18 }
    const halfPlate = item({ id: 'a', name: 'Half Plate', kind: 'armor', armor: { base: 15, dexBonus: true, maxDexBonus: 2 } })
    expect(computeSheet(makeInput({ scores, items: [halfPlate] }), bundle).ac.value).toBe(17)
    const chain = item({ id: 'a', name: 'Chain Mail', kind: 'armor', armor: { base: 16, dexBonus: false, maxDexBonus: null } })
    expect(computeSheet(makeInput({ scores, items: [chain] }), bundle).ac.value).toBe(16)
    const leather = item({ id: 'a', name: 'Leather', kind: 'armor', armor: { base: 11, dexBonus: true, maxDexBonus: null } })
    expect(computeSheet(makeInput({ scores, items: [leather] }), bundle).ac.value).toBe(15)
  })

  it('neequipnutá zbroj se nepočítá', () => {
    const plate = item({ id: 'a', name: 'Plate', kind: 'armor', equipped: false, armor: { base: 18, dexBonus: false, maxDexBonus: null } })
    expect(computeSheet(makeInput({ items: [plate] }), bundle).ac.value).toBe(10)
  })

  it('magická zbroj +1 a bonus od DM se propíšou s původem', () => {
    const input = makeInput({
      scores: { dex: 12 },
      items: [
        item({ id: 'a', name: 'Studded Leather +1', kind: 'armor', armor: { base: 12, dexBonus: true, maxDexBonus: null, magicBonus: 1 } }),
      ],
      effects: [{ target: 'ac', value: 1, source: 'Požehnání od DM' }],
    })
    const ac = computeSheet(input, bundle).ac
    expect(ac.value).toBe(12 + 1 + 1 + 1)
    expect(ac.sources).toContainEqual({ label: 'Požehnání od DM', value: '+1' })
  })

  it('barbarská rychlost: Fast Movement jen bez těžké zbroje', () => {
    const base = makeInput({ levels: levelsOf(['barbarian', 5]) })
    expect(computeSheet(base, bundle).speed.value).toBe(40)
    const heavy = {
      ...base,
      items: [item({ id: 'a', name: 'Plate', kind: 'armor', armor: { base: 18, dexBonus: false, maxDexBonus: null } })],
    }
    expect(computeSheet(heavy, bundle).speed.value).toBe(30)
  })
})

describe('efekty a attunement', () => {
  const ring = item({
    id: 'r',
    name: 'Ring of Protection',
    kind: 'item',
    requiresAttunement: true,
    effects: [
      { target: 'ac', value: 1, source: '' },
      { target: 'save.all', value: 1, source: '' },
    ],
  })

  it('item vyžadující attunement působí jen attunovaný a equipnutý', () => {
    expect(computeSheet(makeInput({ items: [ring] }), bundle).ac.value).toBe(10)
    const attuned = computeSheet(makeInput({ items: [{ ...ring, attuned: true }] }), bundle)
    expect(attuned.ac.value).toBe(11)
    expect(attuned.saves.wis.value).toBe(1)
    expect(attuned.ac.sources).toContainEqual({ label: 'Ring of Protection', value: '+1' })
    expect(computeSheet(makeInput({ items: [{ ...ring, attuned: true, equipped: false }] }), bundle).ac.value).toBe(10)
  })

  it('maximálně 3 attunované itemy', () => {
    const items = [1, 2, 3, 4].map((n) => item({ id: `i${n}`, name: `Item ${n}`, kind: 'item', requiresAttunement: true, attuned: n <= 3 }))
    expect(canAttune(items, 'i4')).toBe(false)
    expect(canAttune(items, 'i2')).toBe(true) // už je attunovaný
    expect(
      canAttune(
        items.map((i) => (i.id === 'i3' ? { ...i, attuned: false } : i)),
        'i4',
      ),
    ).toBe(true)
    expect(computeSheet(makeInput({ items }), bundle).attunement).toEqual({ used: 3, max: 3 })
  })

  it('activeEffects slučuje DM efekty a efekty itemů', () => {
    const effects = activeEffects({ effects: [{ target: 'speed', value: 10, source: 'Haste' }], items: [{ ...ring, attuned: true }] })
    expect(effects.map((e) => e.source)).toEqual(['Haste', 'Ring of Protection', 'Ring of Protection'])
  })

  it('bonusy se propisují do útoků, zranění, kouzel a HP', () => {
    const input = makeInput({
      levels: levelsOf(['wizard', 1]),
      scores: { str: 16, int: 16 },
      items: [
        item({
          id: 'w',
          name: 'Longsword',
          kind: 'weapon',
          weapon: {
            damageDice: '1d8',
            damageType: 'Slashing',
            category: 'martial',
            range: 'melee',
            properties: ['Versatile'],
            magicBonus: 1,
          },
        }),
      ],
      effects: [
        { target: 'attack.melee', value: 1, source: 'Bless' },
        { target: 'damage.all', value: 2, source: 'Rage' },
        { target: 'spell.dc', value: 1, source: 'Rod' },
        { target: 'hp.max', value: 5, source: 'Aid' },
      ],
    })
    const sheet = computeSheet(input, bundle)
    const sword = sheet.attacks.find((a) => a.id === 'w')!
    expect(sword.proficient).toBe(false) // wizard nemá martial weapons
    expect(sword.toHit.value).toBe(3 + 0 + 1 + 1)
    expect(sword.damageBonus.value).toBe(3 + 1 + 2)
    expect(sheet.spellcasting.classes[0]?.saveDc.value).toBe(8 + 2 + 3 + 1)
    expect(sheet.hp.max.value).toBe(6 + 0 + 5)
  })
})

describe('útoky', () => {
  it('finesse bere lepší z STR a DEX, luk používá DEX, proficiency podle třídy', () => {
    const rapier = item({
      id: 'r',
      name: 'Rapier',
      kind: 'weapon',
      weapon: { damageDice: '1d8', damageType: 'Piercing', category: 'martial', range: 'melee', properties: ['Finesse'] },
    })
    const bow = item({
      id: 'b',
      name: 'Longbow',
      kind: 'weapon',
      weapon: { damageDice: '1d8', damageType: 'Piercing', category: 'martial', range: 'ranged', properties: ['Heavy', 'Two-Handed'] },
    })
    const sheet = computeSheet(makeInput({ levels: levelsOf(['fighter', 1]), scores: { str: 12, dex: 16 }, items: [rapier, bow] }), bundle)
    expect(sheet.attacks.find((a) => a.id === 'r')).toMatchObject({ ability: 'dex', proficient: true })
    expect(sheet.attacks.find((a) => a.id === 'r')?.toHit.value).toBe(3 + 2)
    expect(sheet.attacks.find((a) => a.id === 'b')).toMatchObject({ ability: 'dex' })
  })

  it('Extra Attack se nesčítá mezi třídami, fighter dostává další útoky', () => {
    expect(computeSheet(makeInput({ levels: levelsOf(['fighter', 5]) }), bundle).attacksPerAction).toBe(2)
    expect(computeSheet(makeInput({ levels: levelsOf(['fighter', 11]) }), bundle).attacksPerAction).toBe(3)
    expect(computeSheet(makeInput({ levels: levelsOf(['fighter', 5], ['monk', 5]) }), bundle).attacksPerAction).toBe(2)
    expect(computeSheet(makeInput({ levels: levelsOf(['fighter', 4]) }), bundle).attacksPerAction).toBe(1)
  })

  it('mnich používá martial arts kostku u zbraní mnicha', () => {
    const spear = item({
      id: 's',
      name: 'Spear',
      kind: 'weapon',
      weapon: { damageDice: '1d6', damageType: 'Piercing', category: 'simple', range: 'melee', properties: ['Thrown', 'Versatile'] },
    })
    const sheet = computeSheet(makeInput({ levels: levelsOf(['monk', 11]), scores: { dex: 18, str: 8 }, items: [spear] }), bundle)
    expect(sheet.martialArtsDie).toBe('1d8')
    expect(sheet.attacks.find((a) => a.id === 's')).toMatchObject({ ability: 'dex', damageDice: '1d8' })
  })
})

describe('třídní zdroje', () => {
  it('barbar: rage, bard: bardic inspiration z CHA, sorcerer: sorcery points, cleric: channel divinity', () => {
    const rage = computeSheet(makeInput({ levels: levelsOf(['barbarian', 5]) }), bundle).resources.find((r) => r.key === 'barbarian.rage')
    expect(rage?.max.value).toBe(3)
    const bard = computeSheet(makeInput({ levels: levelsOf(['bard', 5]), scores: { cha: 18 } }), bundle).resources.find(
      (r) => r.key === 'bard.bardic-inspiration',
    )
    expect(bard).toMatchObject({ recharge: 'short' })
    expect(bard?.max.value).toBe(4)
    const sorcerer = computeSheet(makeInput({ levels: levelsOf(['sorcerer', 5]) }), bundle).resources.find(
      (r) => r.key === 'sorcerer.sorcery-points',
    )
    expect(sorcerer?.max.value).toBe(5)
    const cleric = computeSheet(makeInput({ levels: levelsOf(['cleric', 6]) }), bundle).resources.find(
      (r) => r.key === 'cleric.channel-divinity',
    )
    expect(cleric?.max.value).toBe(2)
    const paladin = computeSheet(makeInput({ levels: levelsOf(['paladin', 4]) }), bundle).resources.find(
      (r) => r.key === 'paladin.lay-on-hands',
    )
    expect(paladin?.max.value).toBe(20)
  })

  it('vlastní zdroje fungují stejně jako třídní', () => {
    const input = makeInput({
      customResources: [{ key: 'custom.bag', name: 'Náboje', max: 6, recharge: 'long' }],
      state: { ...initialState(10), resources: { 'custom.bag': 2 } },
    })
    const r = computeSheet(input, bundle).resources.find((x) => x.key === 'custom.bag')
    expect(r).toMatchObject({ name: 'Náboje', current: 2, custom: true, recharge: 'long' })
  })
})

describe('ruční přepisy (override)', () => {
  it('přepsaná hodnota je označená, původní se zachová a po odstranění přepisu se vrací výpočet', () => {
    const input = hajos()
    const auto = computeSheet(input, bundle)
    const overrides = { ac: 20, 'save.wis': 9, 'spellDc.warlock': 17, 'resource.monk.ki.max': 7 }
    const withOverride = computeSheet({ ...input, overrides }, bundle)
    expect(withOverride.ac).toMatchObject({ value: 20, base: auto.ac.value, overridden: true })
    expect(withOverride.saves.wis).toMatchObject({ value: 9, overridden: true })
    expect(withOverride.spellcasting.classes[0]?.saveDc).toMatchObject({ value: 17, base: 13, overridden: true })
    expect(withOverride.resources.find((r) => r.key === 'monk.ki')?.max).toMatchObject({ value: 7, base: 5, overridden: true })

    // Tlačítko "vrátit k výpočtu" = odstranění přepisu z mapy.
    const { ac: _removed, ...rest } = overrides
    void _removed
    expect(computeSheet({ ...input, overrides: rest }, bundle).ac).toMatchObject({ value: auto.ac.value, overridden: false })
  })

  it('přepis proficiency bonusu se propíše do závislých hodnot', () => {
    const sheet = computeSheet(hajos({ overrides: { proficiencyBonus: 4 } }), bundle)
    expect(sheet.proficiencyBonus).toMatchObject({ value: 4, base: 3, overridden: true })
    expect(sheet.spellcasting.classes[0]?.saveDc).toMatchObject({ value: 14, base: 14, overridden: false })
  })

  it('přepis HP, rychlosti, iniciativy, pasivního vnímání a slotů', () => {
    const input = hajos({ overrides: { 'hp.max': 99, speed: 50, initiative: 7, passivePerception: 20, 'pact.count': 2 } })
    const sheet = computeSheet(input, bundle)
    expect(sheet.hp.max).toMatchObject({ value: 99, overridden: true })
    expect(sheet.speed.value).toBe(50)
    expect(sheet.initiative.value).toBe(7)
    expect(sheet.passivePerception.value).toBe(20)
    expect(sheet.spellcasting.pact?.count).toBe(2)
  })
})

describe('odpočinek', () => {
  const input = hajos()
  const sheet = computeSheet(input, bundle)

  it('spendHitDie léčí kostku + CON a spotřebuje kostku', () => {
    const hurt = { ...initialState(sheet.hp.max.value), hpCurrent: 10 }
    const after = spendHitDie(hurt, sheet, 'd8', 4)
    expect(after.hpCurrent).toBe(10 + 4 + 2)
    expect(after.hitDiceUsed).toEqual({ d8: 1 })
    expect(spendHitDie({ ...hurt, hpCurrent: sheet.hp.max.value - 1 }, sheet, 'd8', 8).hpCurrent).toBe(sheet.hp.max.value)
    const exhausted = computeSheet({ ...input, state: { ...hurt, hitDiceUsed: { d8: 6 } } }, bundle)
    expect(() => spendHitDie({ ...hurt, hitDiceUsed: { d8: 6 } }, exhausted, 'd8', 4)).toThrow()
  })

  it('short rest obnoví ki a pact sloty, ne HP a běžné sloty', () => {
    const used = {
      ...initialState(sheet.hp.max.value),
      hpCurrent: 12,
      resources: { 'monk.ki': 1 },
      pactSlotsUsed: 1,
      slotsUsed: { '1': 1 },
    }
    const after = shortRest(used, sheet)
    expect(after.resources['monk.ki']).toBe(5)
    expect(after.pactSlotsUsed).toBe(0)
    expect(after.hpCurrent).toBe(12)
    expect(after.slotsUsed).toEqual({ '1': 1 })
  })

  it('long rest obnoví HP, sloty, zdroje (ne ruční), polovinu hit dice a death saves', () => {
    const used = {
      ...initialState(sheet.hp.max.value),
      hpCurrent: 3,
      hpTemp: 5,
      deathFailures: 2,
      deathSuccesses: 1,
      hitDiceUsed: { d8: 5 },
      slotsUsed: { '1': 2 },
      pactSlotsUsed: 1,
      resources: { 'monk.ki': 0, 'custom.manual': 0 },
    }
    const withManual = computeSheet(
      { ...input, customResources: [{ key: 'custom.manual', name: 'Ruční', max: 3, recharge: 'manual' }], state: used },
      bundle,
    )
    const after = longRest(used, withManual)
    expect(after.hpCurrent).toBe(sheet.hp.max.value)
    expect(after.hpTemp).toBe(0)
    expect([after.deathSuccesses, after.deathFailures]).toEqual([0, 0])
    expect(after.slotsUsed).toEqual({})
    expect(after.pactSlotsUsed).toBe(0)
    expect(after.resources['monk.ki']).toBe(5)
    expect(after.resources['custom.manual']).toBe(0)
    expect(after.hitDiceUsed).toEqual({ d8: 2 }) // 6 kostek: vrátí se 3
  })

  it('long rest vrátí aspoň jednu hit die', () => {
    const one = computeSheet(makeInput({ levels: levelsOf(['wizard', 1]) }), bundle)
    const after = longRest({ ...initialState(6), hitDiceUsed: { d6: 1 } }, one)
    expect(after.hitDiceUsed).toEqual({ d6: 0 })
  })
})

describe('různé', () => {
  it('modifikátory vlastností', () => {
    expect([1, 8, 9, 10, 11, 12, 15, 20, 30].map(abilityModifier)).toEqual([-5, -1, -1, 0, 0, 1, 2, 5, 10])
  })

  it('HP: minimum 1 za level i při velmi nízké CON a bonus za level (Tough)', () => {
    expect(computeSheet(makeInput({ levels: levelsOf(['wizard', 3]), scores: { con: 3 } }), bundle).hp.max.value).toBe(
      Math.max(1, 6 - 4) + 2 * Math.max(1, 4 - 4),
    )
    const tough = computeSheet(
      makeInput({ levels: levelsOf(['fighter', 2]), effects: [{ target: 'hp.perLevel', value: 2, source: 'Tough' }] }),
      bundle,
    )
    expect(tough.hp.max.value).toBe(10 + 2 + (6 + 2))
  })

  it('hození kostky při levelu se použije místo průměru', () => {
    const rolled = makeInput({
      levels: [
        { classIndex: 'fighter', hpRoll: null },
        { classIndex: 'fighter', hpRoll: 10 },
      ],
    })
    expect(computeSheet(rolled, bundle).hp.max.value).toBe(10 + 10)
  })

  it('subclass třetinového sesilatele (Eldritch Knight) získává sloty', () => {
    const input = makeInput({ levels: levelsOf(['fighter', 7]), subclasses: { fighter: 'eldritch-knight' }, scores: { int: 14 } })
    const sheet = computeSheet(input, bundle)
    expect(sheet.spellcasting.slots).toEqual([
      { level: 1, max: 4, used: 0 },
      { level: 2, max: 2, used: 0 },
    ])
    expect(sheet.spellcasting.classes[0]).toMatchObject({ classIndex: 'fighter', ability: 'int' })
  })
})

describe('pomocná pravidla level upu', () => {
  const scores = (partial: Partial<Record<'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha', number>>) => ({ str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10, ...partial })

  it('prerekvizity multiclassu: nová třída i všechny současné', () => {
    expect(multiclassProblems(scores({ dex: 13, wis: 13 }), ['monk'], 'monk')).toEqual([])
    expect(multiclassProblems(scores({ dex: 13, wis: 13, cha: 13 }), ['monk'], 'warlock')).toEqual([])
    // chybí CHA pro warlocka
    expect(multiclassProblems(scores({ dex: 13, wis: 13 }), ['monk'], 'warlock')).toEqual(['warlock: CHA 13+ (máš 10)'])
    // chybí WIS pro současného mnicha, i když nová třída (wizard) je v pořádku
    expect(multiclassProblems(scores({ dex: 13, int: 13 }), ['monk'], 'wizard')).toEqual(['monk: WIS 13+ (máš 10)'])
    // fighter: stačí STR nebo DEX
    expect(multiclassProblems(scores({ dex: 13 }), ['wizard'], 'fighter')).toEqual(['wizard: INT 13+ (máš 10)'])
    expect(multiclassProblems(scores({ str: 13, int: 13 }), ['wizard'], 'fighter')).toEqual([])
    expect(multiclassProblems(scores({ int: 13 }), ['wizard'], 'fighter')).toEqual(['fighter: STR nebo DEX 13+'])
    // neznámá (homebrew) třída nemá prerekvizity
    expect(multiclassProblems(scores({}), [], 'homebrew')).toEqual([])
  })

  it('přírůstek HP: průměr, hod a modifikátor CON, aspoň 1', () => {
    expect(averageRoll(8)).toBe(5)
    expect(averageRoll(12)).toBe(7)
    expect(hpGainForLevel(8, 14, null)).toBe(5 + 2)
    expect(hpGainForLevel(8, 14, 3)).toBe(3 + 2)
    expect(hpGainForLevel(6, 3, 1)).toBe(1) // 1 - 4 = -3, ale aspoň 1
  })

  it('ASI levely podle tříd ze SRD', () => {
    const asiLevels = (cls: string) => Array.from({ length: 20 }, (_, i) => i + 1).filter((l) => hasAbilityScoreImprovement(bundle, cls, l))
    expect(asiLevels('wizard')).toEqual([4, 8, 12, 16, 19])
    expect(asiLevels('fighter')).toEqual([4, 6, 8, 12, 14, 16, 19])
    expect(asiLevels('rogue')).toEqual([4, 8, 10, 12, 16, 19])
    expect(asiLevels('monk')).toEqual([4, 8, 12, 16, 19])
  })

  it('nová kouzla při level upu', () => {
    expect(newSpellAllowance(bundle, 'sorcerer', 2)).toMatchObject({ cantrips: 0, spells: 1, spellbook: 0, maxSpellLevel: 1 })
    expect(newSpellAllowance(bundle, 'sorcerer', 4)).toMatchObject({ cantrips: 1, spells: 1 })
    expect(newSpellAllowance(bundle, 'wizard', 5)).toMatchObject({ spellbook: 2, maxSpellLevel: 3 })
    expect(newSpellAllowance(bundle, 'warlock', 3)).toMatchObject({ maxSpellLevel: 2 }) // pact sloty 2. úrovně
    expect(newSpellAllowance(bundle, 'fighter', 5)).toMatchObject({ cantrips: 0, spells: 0, maxSpellLevel: 0 })
    expect(maxSpellLevel(bundle, 'cleric', 9)).toBe(5)
  })
})


describe('Pravidla kampaně: 2014 vs 2024', () => {
  const monkAt = (n: number, ruleset: '2014' | '2024') => computeSheet(makeInput({ levels: levelsOf(['monk', n]), rules: { ruleset } }), bundle)

  it('martial arts kostka je v 2024 o stupeň vyšší (d6 / d8 / d10 / d12) než v 2014 (d4 / d6 / d8 / d10)', () => {
    expect([1, 5, 11, 17].map((n) => monkAt(n, '2014').martialArtsDie)).toEqual(['1d4', '1d6', '1d8', '1d10'])
    expect([1, 5, 11, 17].map((n) => monkAt(n, '2024').martialArtsDie)).toEqual(['1d6', '1d8', '1d10', '1d12'])
  })

  it('bez nastavení se počítá podle 2014', () => {
    expect(computeSheet(makeInput({ levels: levelsOf(['monk', 5]) }), bundle).martialArtsDie).toBe('1d6')
  })

  it('ki se v 2024 jmenuje Focus Points, klíč zdroje i maximum zůstávají', () => {
    const old = monkAt(5, '2014').resources.find((r) => r.key === 'monk.ki')
    const now = monkAt(5, '2024').resources.find((r) => r.key === 'monk.ki')
    expect(old).toMatchObject({ name: 'Ki' })
    expect(now).toMatchObject({ name: 'Focus Points' })
    expect(now?.max.value).toBe(old?.max.value)
  })

  it('monk zbraně: 2014 simple melee a shortsword, 2024 simple melee a martial melee s vlastností Light', () => {
    const scimitar = item({ id: 'sc', name: 'Scimitar', kind: 'weapon', weapon: { damageDice: '1d6', damageType: 'Slashing', category: 'martial', range: 'melee', properties: ['Finesse', 'Light'] } })
    const longsword = item({ id: 'ls', name: 'Longsword', kind: 'weapon', weapon: { damageDice: '1d8', damageType: 'Slashing', category: 'martial', range: 'melee', properties: ['Versatile'] } })
    const run = (ruleset: '2014' | '2024', w: typeof scimitar) =>
      computeSheet(makeInput({ levels: levelsOf(['monk', 11]), scores: { dex: 16, str: 8 }, items: [w], rules: { ruleset } }), bundle).attacks.find((a) => a.id === w.id)!
    expect(run('2014', scimitar).notes).not.toContain('Martial Arts')
    expect(run('2024', scimitar).notes).toContain('Martial Arts')
    expect(run('2024', scimitar).damageDice).toBe('1d10') // martial arts d10 na 11. levelu
    expect(run('2024', longsword).notes).not.toContain('Martial Arts') // martial bez Light není monk zbraň
  })

  it('sada pravidel nic nemění u postav bez mnicha', () => {
    const base = makeInput({ levels: levelsOf(['fighter', 5]), scores: { str: 16 } })
    const a = computeSheet({ ...base, rules: { ruleset: '2014' } }, bundle)
    const b = computeSheet({ ...base, rules: { ruleset: '2024' } }, bundle)
    expect(b).toEqual(a)
  })
})
