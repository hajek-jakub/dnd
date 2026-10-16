import { beforeAll, describe, expect, it } from 'vitest'
import { Client, createCampaign, expectStatus, joinAsPlayer, registerUser, type TestUser } from './client'

const character = (name: string, classIndex: string, extra: Record<string, unknown> = {}) => ({
  name,
  abilityScores: { str: 14, dex: 14, con: 14, int: 10, wis: 14, cha: 10 },
  levels: [{ classIndex, hpRoll: null }],
  ...extra,
})

describe('AC: magická zbroj a zbraň z pravidel, druhy itemů a automatické nasazení', () => {
  let dm: TestUser
  let bob: TestUser
  let campaignId: string
  let otherCampaignId: string
  let bobChar: string

  async function rule(kinds: string, name: string): Promise<string> {
    const res = await dm.client.get(`/rules?kinds=${kinds}&q=${encodeURIComponent(name)}&limit=100`)
    const entry = res.body.entries.find((e: { name: string }) => e.name === name)
    if (!entry) throw new Error(`Pravidlo ${name} nenalezeno`)
    return entry.id
  }
  const add = (user: TestUser, characterId: string, body: unknown) => user.client.post(`/characters/${characterId}/items`, body)
  const items = async (characterId: string) => (await dm.client.get(`/characters/${characterId}`)).body.character.items as any[]
  const npc = async (name: string, classIndex = 'fighter') =>
    (await dm.client.post(`/campaigns/${campaignId}/characters`, character(name, classIndex, { kind: 'npc' }))).body.character.id as string

  beforeAll(async () => {
    dm = await registerUser('geardm')
    campaignId = await createCampaign(dm, 'Výbava')
    otherCampaignId = await createCampaign(dm, 'Cizí výbava')
    bob = await joinAsPlayer(dm, campaignId, 'gearbob')
    bobChar = (await bob.client.post(`/campaigns/${campaignId}/characters`, character('Bob', 'fighter'))).body.character.id
  })

  describe('magická zbroj a zbraň dostane hodnoty základu (jinak by se nepočítala do AC ani útoků)', () => {
    it('Dwarven Plate je plátová zbroj 18 s bonusem +2 a postava ji rovnou nosí', async () => {
      const id = await npc('Trpaslík')
      const res = await add(dm, id, { ruleId: await rule('magic_item', 'Dwarven Plate') })
      expectStatus(res, 201)
      expect(res.body.item).toMatchObject({
        name: 'Dwarven Plate', kind: 'armor', rarity: 'very rare', equipped: true,
        armor: { base: 18, dexBonus: false, magicBonus: 2, strMinimum: 15, stealthDisadvantage: true },
      })
      expect(res.body.item.description).toMatch(/\+2 bonus to AC/)
    })

    it('Elven Chain je chain shirt +1, Animated Shield štít s attunementem, Mithral bez nevýhody na Stealth', async () => {
      const id = await npc('Elf')
      const chain = (await add(dm, id, { ruleId: await rule('magic_item', 'Elven Chain') })).body.item
      expect(chain).toMatchObject({ kind: 'armor', armor: { base: 13, dexBonus: true, maxDexBonus: 2, magicBonus: 1 } })
      const shield = (await add(dm, id, { ruleId: await rule('magic_item', 'Animated Shield') })).body.item
      expect(shield).toMatchObject({ kind: 'shield', requiresAttunement: true, equipped: true, armor: { base: 2, magicBonus: 0 } })
      const mithral = await add(dm, id, { ruleId: await rule('magic_item', 'Mithral Armor'), baseRuleId: await rule('armor', 'Half Plate Armor') })
      expectStatus(mithral, 201)
      expect(mithral.body.item).toMatchObject({ name: 'Mithral Armor (Half Plate Armor)', armor: { base: 15, stealthDisadvantage: false, strMinimum: 0 } })
    })

    it('Armor, +1 bez základu vrátí 422, se základem má název i hodnoty základu a žádný duplicitní efekt', async () => {
      const armorPlus = await rule('magic_item', 'Armor, +1')
      const missing = await add(dm, bobChar, { ruleId: armorPlus })
      expectStatus(missing, 422)
      expect(missing.body.error.field).toBe('baseRuleId')
      const res = await add(dm, bobChar, { ruleId: armorPlus, baseRuleId: await rule('armor', 'Chain Mail') })
      expectStatus(res, 201)
      expect(res.body.item).toMatchObject({ name: 'Armor, +1 (Chain Mail)', kind: 'armor', armor: { base: 16, magicBonus: 1 }, effects: [] })
      // základ musí sedět: zbraň ani štít nejsou zbroj
      for (const wrong of [await rule('weapon', 'Longsword'), await rule('armor', 'Shield')]) {
        const bad = await add(dm, bobChar, { ruleId: armorPlus, baseRuleId: wrong })
        expectStatus(bad, 422)
        expect(bad.body.error.field).toBe('baseRuleId')
      }
    })

    it('Weapon, +2 na Longswordu a Sun Blade jsou zbraně s magickým bonusem (ne bonus ke všem útokům)', async () => {
      const weapon = (await add(dm, bobChar, { ruleId: await rule('magic_item', 'Weapon, +2'), baseRuleId: await rule('weapon', 'Longsword') })).body.item
      expect(weapon).toMatchObject({
        name: 'Weapon, +2 (Longsword)', kind: 'weapon', effects: [],
        weapon: { damageDice: '1d8', damageType: 'Slashing', category: 'martial', range: 'melee', magicBonus: 2 },
      })
      const sun = (await add(dm, bobChar, { ruleId: await rule('magic_item', 'Sun Blade') })).body.item
      expect(sun).toMatchObject({ name: 'Sun Blade', kind: 'weapon', requiresAttunement: true, weapon: { damageDice: '1d8', magicBonus: 2 } })
      const arrows = (await add(dm, bobChar, { ruleId: await rule('magic_item', 'Arrow of Slaying') })).body.item
      expect(arrows).toMatchObject({ kind: 'other', consumable: true, weapon: null })
    })

    it('základ smí být homebrew zbraň této kampaně, z cizí kampaně ne', async () => {
      const weaponPlus = await rule('magic_item', 'Weapon, +1')
      const hb = (data: Record<string, unknown>) => ({ kind: 'weapon', name: 'Bič s háčky', description: 'x', damageDice: '1d6', damageType: 'Slashing', category: 'martial', range: 'melee', ...data })
      const own = await dm.client.post(`/campaigns/${campaignId}/homebrew`, hb({}))
      expectStatus(own, 201)
      const ok = await add(dm, bobChar, { ruleId: weaponPlus, baseRuleId: own.body.entry.id })
      expectStatus(ok, 201)
      expect(ok.body.item).toMatchObject({ name: 'Weapon, +1 (Bič s háčky)', weapon: { damageDice: '1d6', magicBonus: 1 } })
      const foreign = await dm.client.post(`/campaigns/${otherCampaignId}/homebrew`, hb({ name: 'Cizí bič' }))
      const bad = await add(dm, bobChar, { ruleId: weaponPlus, baseRuleId: foreign.body.entry.id })
      expectStatus(bad, 422)
      expect(bad.body.error.field).toBe('baseRuleId')
    })

    it('souhrnný záznam „Armor, +1, +2, or +3“ nejde přidat (nemá jeden bonus)', async () => {
      const res = await add(dm, bobChar, { ruleId: await rule('magic_item', 'Armor, +1, +2, or +3'), baseRuleId: await rule('armor', 'Chain Mail') })
      expectStatus(res, 422)
      expect(res.body.error).toMatchObject({ field: 'ruleId', message: expect.stringContaining('Armor, +1') })
    })

    it('detail pravidla nabídne základ: Dwarven Plate → Plate Armor, Armor +1 → vybrat, Bag of Holding nic', async () => {
      const detail = async (name: string) => (await dm.client.get(`/rules/${await rule('magic_item', name)}`)).body.entry.itemBase
      expect(await detail('Dwarven Plate')).toEqual({ type: 'armor', baseRuleId: await rule('armor', 'Plate Armor') })
      expect(await detail('Armor, +1')).toEqual({ type: 'armor', baseRuleId: null })
      expect(await detail('Spellguard Shield')).toEqual({ type: 'shield', baseRuleId: await rule('armor', 'Shield') })
      expect(await detail('Sun Blade')).toEqual({ type: 'weapon', baseRuleId: await rule('weapon', 'Longsword') })
      expect(await detail('Bag of Holding')).toBeNull()
    })

    it('explicitní hodnoty zbroje nahradí základ (loot ukládá hotové hodnoty)', async () => {
      const res = await add(dm, bobChar, { ruleId: await rule('magic_item', 'Armor, +2'), armor: { base: 14, dexBonus: true, maxDexBonus: 2, magicBonus: 2 } })
      expectStatus(res, 201)
      expect(res.body.item).toMatchObject({ kind: 'armor', armor: { base: 14, magicBonus: 2 } })
    })
  })

  describe('druhy itemů podle kategorie pravidla', () => {
    it('hůl, hůlka, žezlo, lektvar, svitek a prsten', async () => {
      const kinds: Record<string, string> = {
        'Immovable Rod': 'rod',
        'Oil of Sharpness': 'potion',
        'Wand of Magic Missiles': 'wand',
        'Staff of Healing': 'staff',
        'Potion of Healing': 'potion',
        'Ring of Protection': 'wondrous',
        'Bag of Holding': 'wondrous',
      }
      for (const [name, kind] of Object.entries(kinds)) {
        const item = (await add(bob, bobChar, { ruleId: await rule('magic_item', name) })).body.item
        expect(item.kind, name).toBe(kind)
      }
      const potion = (await add(bob, bobChar, { ruleId: await rule('magic_item', 'Potion of Healing') })).body.item
      expect(potion.consumable).toBe(true)
    })

    it('homebrew item s typem Potion je lektvar, který se spotřebuje', async () => {
      const hb = await dm.client.post(`/campaigns/${campaignId}/homebrew`, { kind: 'magic_item', name: 'Lektvar odvahy', description: 'x', itemType: 'Potion' })
      expectStatus(hb, 201)
      const item = (await add(bob, bobChar, { ruleId: hb.body.entry.id })).body.item
      expect(item).toMatchObject({ kind: 'potion', consumable: true })
    })

    it('Bracers of Defense platí jen bez zbroje a štítu', async () => {
      const item = (await add(bob, bobChar, { ruleId: await rule('magic_item', 'Bracers of Defense') })).body.item
      expect(item.effects).toEqual([{ target: 'ac.unarmored', value: 2, source: 'Bracers of Defense' }])
    })
  })

  describe('automatické nasazení zbroje a štítu', () => {
    it('bojovník nosí první zbroj a štít, další zbroj už ne; zbroj bez hodnot ani zbraň se nenasadí', async () => {
      const id = await npc('Rytíř')
      expect((await add(dm, id, { ruleId: await rule('armor', 'Leather Armor') })).body.item.equipped).toBe(true)
      expect((await add(dm, id, { ruleId: await rule('armor', 'Chain Mail') })).body.item.equipped).toBe(false)
      expect((await add(dm, id, { ruleId: await rule('armor', 'Shield') })).body.item.equipped).toBe(true)
      expect((await add(dm, id, { ruleId: await rule('weapon', 'Longsword') })).body.item.equipped).toBe(false)
      const other = await npc('Panoš')
      expect((await add(dm, other, { name: 'Zbroj bez hodnot', kind: 'armor' })).body.item.equipped).toBe(false)
      expect((await add(dm, other, { ruleId: await rule('armor', 'Scale Mail') })).body.item.equipped).toBe(true)
    })

    it('jen zbroj, kterou postava umí nosit: zloděj lehkou ano, těžkou ne; kouzelník nic; multiclass bojovník střední ano', async () => {
      const rogue = await npc('Zloděj', 'rogue')
      expect((await add(dm, rogue, { ruleId: await rule('armor', 'Chain Mail') })).body.item.equipped).toBe(false)
      expect((await add(dm, rogue, { ruleId: await rule('armor', 'Shield') })).body.item.equipped).toBe(false)
      expect((await add(dm, rogue, { ruleId: await rule('armor', 'Studded Leather Armor') })).body.item.equipped).toBe(true)
      const wizard = await npc('Mág', 'wizard')
      expect((await add(dm, wizard, { ruleId: await rule('armor', 'Leather Armor') })).body.item.equipped).toBe(false)
      const multi = (await dm.client.post(`/campaigns/${campaignId}/characters`, character('Mág s mečem', 'wizard', {
        kind: 'npc', abilityScores: { str: 14, dex: 14, con: 14, int: 14, wis: 10, cha: 10 }, levels: [{ classIndex: 'wizard', hpRoll: null }, { classIndex: 'fighter', hpRoll: null }],
      }))).body.character.id
      expect((await add(dm, multi, { ruleId: await rule('armor', 'Plate Armor') })).body.item.equipped).toBe(false)
      expect((await add(dm, multi, { ruleId: await rule('armor', 'Scale Mail') })).body.item.equipped).toBe(true)
    })

    it('mnich zbroj ani štít sám nenasadí, barbar jen štít', async () => {
      const monk = await npc('Mnich', 'monk')
      expect((await add(dm, monk, { ruleId: await rule('armor', 'Leather Armor') })).body.item.equipped).toBe(false)
      expect((await add(dm, monk, { ruleId: await rule('armor', 'Shield') })).body.item.equipped).toBe(false)
      const barbarian = await npc('Barbar', 'barbarian')
      expect((await add(dm, barbarian, { ruleId: await rule('armor', 'Hide Armor') })).body.item.equipped).toBe(false)
      expect((await add(dm, barbarian, { ruleId: await rule('armor', 'Shield') })).body.item.equipped).toBe(true)
    })

    it('Předat: Batan zbroj rovnou nosí, když žádnou nenosí (jinak by se jeho AC nezměnilo)', async () => {
      const batan = await npc('Batan')
      await add(bob, bobChar, { ruleId: await rule('armor', 'Leather Armor') })
      const scale = (await add(bob, bobChar, { ruleId: await rule('armor', 'Scale Mail') })).body.item
      expectStatus(await bob.client.post(`/characters/${bobChar}/transfer`, { toCharacterId: batan, itemId: scale.id }), 200)
      expect((await items(batan)).find((i) => i.id === scale.id)).toMatchObject({ equipped: true, kind: 'armor' })
      // druhou zbroj už nenasadí
      const ring = (await add(bob, bobChar, { ruleId: await rule('armor', 'Ring Mail') })).body.item
      await bob.client.post(`/characters/${bobChar}/transfer`, { toCharacterId: batan, itemId: ring.id })
      expect((await items(batan)).find((i) => i.id === ring.id).equipped).toBe(false)
    })
  })

  describe('oprava dřív rozdaných magických zbrojí při seedu', () => {
    it('Dwarven Plate uložený postaru (bez hodnot) dostane hodnoty a nasadí se; obecná Armor, +1 zůstane', async () => {
      const id = await npc('Starý trpaslík')
      const plate = (await add(dm, id, { ruleId: await rule('magic_item', 'Dwarven Plate') })).body.item
      const generic = (await add(dm, id, { ruleId: await rule('magic_item', 'Armor, +1'), baseRuleId: await rule('armor', 'Leather Armor') })).body.item
      // starý tvar: wondrous item bez hodnot zbroje, nenošený
      for (const item of [plate, generic]) {
        expectStatus(await dm.client.patch(`/characters/${id}/items/${item.id}`, { kind: 'wondrous', armor: null, equipped: false }), 200)
      }
      expect((await items(id)).find((i) => i.id === plate.id)).toMatchObject({ kind: 'wondrous', armor: null, equipped: false })

      // Bracers of Defense postaru: bonus k AC platil i ve zbroji
      const bracers = (await add(dm, id, { ruleId: await rule('magic_item', 'Bracers of Defense') })).body.item
      await dm.client.patch(`/characters/${id}/items/${bracers.id}`, { effects: [{ target: 'ac', value: 2, source: 'Bracers of Defense' }] })

      const key = { 'X-Migrate-Key': 'test-migrate' }
      const seed = await new Client().request('POST', '/admin/seed', {}, key)
      expectStatus(seed, 200)
      expect(seed.body.repaired).toBeGreaterThanOrEqual(2)
      expect(seed.body.repairedItems).toEqual(expect.arrayContaining(['Dwarven Plate (Starý trpaslík)', 'Bracers of Defense (Starý trpaslík)']))
      expect((await items(id)).find((i) => i.id === bracers.id).effects).toEqual([{ target: 'ac.unarmored', value: 2, source: 'Bracers of Defense' }])
      const after = await items(id)
      expect(after.find((i) => i.id === plate.id)).toMatchObject({ kind: 'armor', equipped: true, armor: { base: 18, magicBonus: 2 } })
      expect(after.find((i) => i.id === generic.id)).toMatchObject({ kind: 'wondrous', armor: null })
      // podruhé už není co opravovat
      await new Client().request('POST', '/admin/seed', {}, key)
      expect((await items(id)).find((i) => i.id === plate.id)).toMatchObject({ kind: 'armor', equipped: true })
    })
  })
})
