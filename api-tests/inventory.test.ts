import { beforeAll, describe, expect, it } from 'vitest'
import { createCampaign, expectStatus, joinAsPlayer, registerUser, type TestUser } from './client'

const BASE = { abilityScores: { str: 14, dex: 14, con: 12, int: 16, wis: 10, cha: 8 }, levels: [{ classIndex: 'wizard' }, { classIndex: 'wizard' }] }

describe('inventář, peníze, předávání a kouzla', () => {
  let dm: TestUser
  let bob: TestUser
  let carol: TestUser
  let dave: TestUser
  let campaignId: string
  let otherCampaignId: string
  let bobChar: string
  let carolChar: string

  async function ruleId(user: TestUser, kinds: string, name: string, extra = ''): Promise<string> {
    const res = await user.client.get(`/rules?kinds=${kinds}&q=${encodeURIComponent(name)}${extra}`)
    const entry = res.body.entries.find((e: { name: string }) => e.name === name)
    if (!entry) throw new Error(`Pravidlo ${name} nenalezeno`)
    return entry.id
  }
  const addItem = (user: TestUser, characterId: string, body: unknown) => user.client.post(`/characters/${characterId}/items`, body)
  const sheet = async (user: TestUser, id: string) => (await user.client.get(`/characters/${id}`)).body.character

  beforeAll(async () => {
    dm = await registerUser('dm')
    campaignId = await createCampaign(dm, 'Inventář')
    otherCampaignId = await createCampaign(dm, 'Jiná')
    bob = await joinAsPlayer(dm, campaignId, 'bob')
    carol = await joinAsPlayer(dm, campaignId, 'carol')
    dave = await registerUser('dave')
    bobChar = (await bob.client.post(`/campaigns/${campaignId}/characters`, { ...BASE, name: 'Bob' })).body.character.id
    carolChar = (await carol.client.post(`/campaigns/${campaignId}/characters`, { ...BASE, name: 'Carol' })).body.character.id
  })

  describe('položky z pravidel', () => {
    it('zbraň z SRD přenese kostku zranění, kategorii, dosah, vlastnosti a váhu', async () => {
      const res = await addItem(bob, bobChar, { ruleId: await ruleId(bob, 'weapon', 'Longsword') })
      expectStatus(res, 201)
      expect(res.body.item).toMatchObject({
        name: 'Longsword', kind: 'weapon', quantity: 1, weight: 3, equipped: false, attuned: false, requiresAttunement: false,
        weapon: { damageDice: '1d8', damageType: 'Slashing', category: 'martial', range: 'melee', magicBonus: 0 },
      })
      expect(res.body.item.weapon.properties).toContain('Versatile')
      expect(res.body.item.armor).toBeNull()
    })

    it('zbroj a štít z SRD: AC, limit DEX, druh', async () => {
      const mail = (await addItem(bob, bobChar, { ruleId: await ruleId(bob, 'armor', 'Chain Mail') })).body.item
      expect(mail).toMatchObject({ kind: 'armor', armor: { base: 16, dexBonus: false, maxDexBonus: null, strMinimum: 13, stealthDisadvantage: true } })
      const half = (await addItem(bob, bobChar, { ruleId: await ruleId(bob, 'armor', 'Half Plate Armor') })).body.item
      expect(half.armor).toMatchObject({ base: 15, dexBonus: true, maxDexBonus: 2 })
      const shield = (await addItem(bob, bobChar, { ruleId: await ruleId(bob, 'armor', 'Shield') })).body.item
      expect(shield).toMatchObject({ kind: 'shield', armor: { base: 2, dexBonus: false } })
    })

    it('magický item: attunement z textu a známé efekty (Ring of Protection)', async () => {
      const ring = (await addItem(bob, bobChar, { ruleId: await ruleId(bob, 'magic_item', 'Ring of Protection') })).body.item
      expect(ring).toMatchObject({ kind: 'item', requiresAttunement: true, rarity: 'rare' })
      expect(ring.effects).toEqual([
        { target: 'ac', value: 1, source: 'Ring of Protection' },
        { target: 'save.all', value: 1, source: 'Ring of Protection' },
      ])
      const bag = (await addItem(bob, bobChar, { ruleId: await ruleId(bob, 'magic_item', 'Bag of Holding') })).body.item
      expect(bag).toMatchObject({ requiresAttunement: false, effects: [] })
      expect(bag.description).toMatch(/interior space/)
    })

    it('item mimo SRD (jen fakta) jde přidat bez popisu', async () => {
      const gleaming = (await addItem(bob, bobChar, { ruleId: await ruleId(bob, 'magic_item', 'Armor of Gleaming') })).body.item
      expect(gleaming).toMatchObject({ name: 'Armor of Gleaming', description: '', rarity: 'common' })
    })

    it('hráč si při přidání může přepsat množství a vlastnosti', async () => {
      const res = await addItem(bob, bobChar, { ruleId: await ruleId(bob, 'weapon', 'Dagger'), quantity: 3, notes: 'Poznámka', weapon: { damageDice: '1d4', damageType: 'Piercing', category: 'simple', range: 'melee', properties: ['Finesse'], magicBonus: 1 } })
      expect(res.body.item).toMatchObject({ quantity: 3, notes: 'Poznámka', weapon: { magicBonus: 1 } })
    })

    it('homebrew item z této kampaně jde přidat, z cizí kampaně ne', async () => {
      const own = (await bob.client.post(`/campaigns/${campaignId}/homebrew`, { kind: 'magic_item', name: 'Bobův prsten', description: 'x', rarity: 'rare', attunement: true })).body.entry.id
      expectStatus(await addItem(bob, bobChar, { ruleId: own }), 201)
      const foreign = (await dm.client.post(`/campaigns/${otherCampaignId}/homebrew`, { kind: 'magic_item', name: 'Cizí item', description: 'x' })).body.entry.id
      expect([404, 422]).toContain((await addItem(bob, bobChar, { ruleId: foreign })).status)
      expect([404, 422]).toContain((await addItem(dm, bobChar, { ruleId: foreign })).status) // ani DM nevloží homebrew z jiné kampaně
    })

    it('z kouzla ani třídy item nevznikne', async () => {
      expect((await addItem(bob, bobChar, { ruleId: await ruleId(bob, 'spell', 'Fireball') })).status).toBe(422)
      expect((await addItem(bob, bobChar, { ruleId: 'neni-uuid' })).status).toBe(404)
    })
  })

  describe('vlastní item a validace', () => {
    it('vytvoří vlastní item včetně zbroje, zbraně a efektů', async () => {
      const armor = await addItem(bob, bobChar, { name: 'Moje zbroj', kind: 'armor', armor: { base: 14, dexBonus: true, maxDexBonus: 2, magicBonus: 1 }, weight: 20, quantity: 1 })
      expect(armor.body.item).toMatchObject({ name: 'Moje zbroj', kind: 'armor', armor: { base: 14, maxDexBonus: 2, magicBonus: 1 }, weight: 20 })
      const cloak = await addItem(bob, bobChar, { name: 'Plášť', requiresAttunement: true, effects: [{ target: 'skill.stealth', value: 2, source: 'Plášť' }, { target: 'speed', value: 10, source: '' }] })
      expect(cloak.body.item.effects).toHaveLength(2)
    })

    it('odmítá neplatná data', async () => {
      const bad = (body: Record<string, unknown>) => addItem(bob, bobChar, { name: 'x', ...body })
      expect((await addItem(bob, bobChar, { kind: 'item' })).status).toBe(422) // chybí název
      expect((await bad({ kind: 'sword' })).status).toBe(422)
      expect((await bad({ weight: -1 })).status).toBe(422)
      expect((await bad({ quantity: 0 })).status).toBe(422)
      expect((await bad({ quantity: 'tři' })).status).toBe(422)
      expect((await bad({ rarity: 'mythic' })).status).toBe(422)
      expect((await bad({ effects: [{ target: 'strength', value: 1 }] })).status).toBe(422)
      expect((await bad({ effects: [{ target: 'ac', value: 1000 }] })).status).toBe(422)
      expect((await bad({ effects: Array(13).fill({ target: 'ac', value: 1 }) })).status).toBe(422)
      expect((await bad({ armor: { base: 99 } })).status).toBe(422)
      expect((await bad({ weapon: { damageDice: 'moc' } })).status).toBe(422)
      expect((await bad({ weapon: { damageDice: '1d8', category: 'epic' } })).status).toBe(422)
    })

    it('XSS a SQL v názvu jsou jen text', async () => {
      const evil = "<img src=x onerror=alert(1)>'; DROP TABLE character_items;--"
      const res = await addItem(bob, bobChar, { name: evil, description: evil })
      expect(res.body.item.name).toBe(evil)
      expect((await sheet(bob, bobChar)).items.length).toBeGreaterThan(5)
    })
  })

  describe('oprávnění k inventáři', () => {
    it('cizí hráč 403, cizinec 404, DM smí', async () => {
      expect((await addItem(carol, bobChar, { name: 'Podvrh' })).status).toBe(403)
      expect((await addItem(dave, bobChar, { name: 'Podvrh' })).status).toBe(404)
      expect((await addItem(dm, bobChar, { name: 'Dar od DM', quantity: 2 })).status).toBe(201)
      const item = (await sheet(bob, bobChar)).items.find((i: { name: string }) => i.name === 'Dar od DM')
      expect((await carol.client.patch(`/characters/${bobChar}/items/${item.id}`, { quantity: 99 })).status).toBe(403)
      expect((await carol.client.delete(`/characters/${bobChar}/items/${item.id}`)).status).toBe(403)
      expect((await dave.client.patch(`/characters/${bobChar}/items/${item.id}`, { quantity: 99 })).status).toBe(404)
      expect((await bob.client.patch(`/characters/${bobChar}/items/${item.id}`, { quantity: 5 })).body.item.quantity).toBe(5)
    })

    it('item cizí postavy nejde upravit přes id vlastní postavy', async () => {
      const bobItem = (await sheet(bob, bobChar)).items[0]
      expect((await carol.client.patch(`/characters/${carolChar}/items/${bobItem.id}`, { quantity: 99 })).status).toBe(404)
      expect((await carol.client.delete(`/characters/${carolChar}/items/${bobItem.id}`)).status).toBe(404)
    })

    it('ostatní hráči inventář ani kouzla v seznamu nevidí', async () => {
      const preview = (await carol.client.get(`/campaigns/${campaignId}/characters`)).body.characters.find((c: { id: string }) => c.id === bobChar)
      expect(preview).not.toHaveProperty('items')
      expect(preview).not.toHaveProperty('spells')
      expect(preview).not.toHaveProperty('currency')
    })
  })

  describe('equip a attunement', () => {
    let a: TestUser
    let id: string
    const itemIds: Record<string, string> = {}
    beforeAll(async () => {
      a = await joinAsPlayer(dm, campaignId, 'equip')
      id = (await a.client.post(`/campaigns/${campaignId}/characters`, { ...BASE, name: 'Equip' })).body.character.id
      for (const [key, body] of Object.entries({
        armorA: { name: 'Zbroj A', kind: 'armor', armor: { base: 12, dexBonus: true } },
        armorB: { name: 'Zbroj B', kind: 'armor', armor: { base: 16, dexBonus: false } },
        shieldA: { name: 'Štít A', kind: 'shield', armor: { base: 2, dexBonus: false } },
        shieldB: { name: 'Štít B', kind: 'shield', armor: { base: 2, dexBonus: false } },
        plain: { name: 'Kámen', kind: 'item' },
        m1: { name: 'Magie 1', requiresAttunement: true },
        m2: { name: 'Magie 2', requiresAttunement: true },
        m3: { name: 'Magie 3', requiresAttunement: true },
        m4: { name: 'Magie 4', requiresAttunement: true },
      })) {
        itemIds[key] = (await addItem(a, id, body)).body.item.id
      }
    })
    const patch = (key: string, body: unknown) => a.client.patch(`/characters/${id}/items/${itemIds[key]}`, body)

    it('nosí se jen jedna zbroj a jeden štít: nový kus nahradí předchozí', async () => {
      await patch('armorA', { equipped: true })
      await patch('shieldA', { equipped: true })
      await patch('armorB', { equipped: true })
      await patch('shieldB', { equipped: true })
      const items = (await sheet(a, id)).items
      const equipped = items.filter((i: { equipped: boolean }) => i.equipped).map((i: { name: string }) => i.name).sort()
      expect(equipped).toEqual(['Zbroj B', 'Štít B'])
    })

    it('attunement jen u itemů, které ho vyžadují, a nejvýš 3', async () => {
      expect((await patch('plain', { attuned: true })).status).toBe(422)
      for (const k of ['m1', 'm2', 'm3']) expect((await patch(k, { attuned: true })).body.item.attuned).toBe(true)
      const fourth = await patch('m4', { attuned: true })
      expect(fourth.status).toBe(422)
      expect(fourth.body.error.message).toMatch(/nejvýš 3/)
      // už attunovaný item jde dál upravovat a po zrušení se uvolní místo
      expect((await patch('m1', { attuned: true, notes: 'ok' })).status).toBe(200)
      expect((await patch('m1', { attuned: false })).status).toBe(200)
      expect((await patch('m4', { attuned: true })).status).toBe(200)
      expect((await sheet(a, id)).items.filter((i: { attuned: boolean }) => i.attuned)).toHaveLength(3)
    })

    it('DM limit také nepřekročí a souběžné attunementy se nepředběhnou', async () => {
      expect((await dm.client.patch(`/characters/${id}/items/${itemIds.m1}`, { attuned: true })).status).toBe(422)
      await Promise.all(['m2', 'm3', 'm4'].map((k) => patch(k, { attuned: false })))
      const results = await Promise.all(['m1', 'm2', 'm3', 'm4'].map((k) => patch(k, { attuned: true })))
      expect(results.filter((r) => r.status === 200)).toHaveLength(3)
      expect((await sheet(a, id)).items.filter((i: { attuned: boolean }) => i.attuned)).toHaveLength(3)
    })

    it('smazání itemu a zrušení požadavku na attunement', async () => {
      expect((await patch('m2', { requiresAttunement: false })).body.item.attuned).toBe(false)
      expect((await a.client.delete(`/characters/${id}/items/${itemIds.plain}`)).status).toBe(204)
      expect((await patch('plain', { quantity: 2 })).status).toBe(404)
    })
  })

  describe('předávání mezi postavami', () => {
    let from: string
    let to: string
    let payer: TestUser
    let other: TestUser
    let swordId: string
    beforeAll(async () => {
      payer = await joinAsPlayer(dm, campaignId, 'darce')
      other = await joinAsPlayer(dm, campaignId, 'prijemce')
      from = (await payer.client.post(`/campaigns/${campaignId}/characters`, { ...BASE, name: 'Dárce' })).body.character.id
      to = (await other.client.post(`/campaigns/${campaignId}/characters`, { ...BASE, name: 'Příjemce' })).body.character.id
      swordId = (await addItem(payer, from, { name: 'Meč', kind: 'weapon', quantity: 5, weapon: { damageDice: '1d8', category: 'martial', range: 'melee' } })).body.item.id
      await payer.client.patch(`/characters/${from}`, { currency: { cp: 5, sp: 20, ep: 0, gp: 100, pp: 2 } })
    })
    const transfer = (user: TestUser, body: unknown) => user.client.post(`/characters/${from}/transfer`, body)

    it('část stacku se rozdělí, celý item se přesune a odequipuje', async () => {
      const part = await transfer(payer, { toCharacterId: to, itemId: swordId, quantity: 2 })
      expectStatus(part, 200)
      expect(part.body.items.find((i: { id: string }) => i.id === swordId).quantity).toBe(3)
      const received = (await sheet(other, to)).items.find((i: { name: string }) => i.name === 'Meč')
      expect(received).toMatchObject({ quantity: 2, equipped: false })

      await payer.client.patch(`/characters/${from}/items/${swordId}`, { equipped: true })
      expectStatus(await transfer(payer, { toCharacterId: to, itemId: swordId }), 200)
      expect((await sheet(payer, from)).items.find((i: { id: string }) => i.id === swordId)).toBeUndefined()
      const moved = (await sheet(other, to)).items.find((i: { id: string }) => i.id === swordId)
      expect(moved).toMatchObject({ quantity: 3, equipped: false, attuned: false })
    })

    it('peníze se předají přesně a nelze předat víc, než postava má', async () => {
      const res = await transfer(payer, { toCharacterId: to, currency: { gp: 30, sp: 5 } })
      expectStatus(res, 200)
      expect(res.body.currency).toEqual({ cp: 5, sp: 15, ep: 0, gp: 70, pp: 2 })
      expect((await sheet(other, to)).currency).toEqual({ cp: 0, sp: 5, ep: 0, gp: 30, pp: 0 })
      expect((await transfer(payer, { toCharacterId: to, currency: { gp: 71 } })).status).toBe(422)
      expect((await transfer(payer, { toCharacterId: to, currency: { gp: -1 } })).status).toBe(422)
      expect((await sheet(payer, from)).currency.gp).toBe(70)
    })

    it('neplatné předání se odmítne', async () => {
      expect((await transfer(payer, { toCharacterId: from, currency: { gp: 1 } })).status).toBe(422) // sám sobě
      expect((await transfer(payer, { toCharacterId: 'neni-uuid', currency: { gp: 1 } })).status).toBe(422)
      expect((await transfer(payer, { toCharacterId: to })).status).toBe(422) // nic k předání
      expect((await transfer(payer, { toCharacterId: to, itemId: '00000000-0000-0000-0000-000000000000' })).status).toBe(404)
      const foreign = (await dm.client.post(`/campaigns/${otherCampaignId}/characters`, { ...BASE, name: 'Jinde' })).body.character.id
      expect((await transfer(payer, { toCharacterId: foreign, currency: { gp: 1 } })).status).toBe(422) // jiná kampaň
      const rope = (await addItem(payer, from, { name: 'Lano', quantity: 2 })).body.item.id
      expect((await transfer(payer, { toCharacterId: to, itemId: rope, quantity: 3 })).status).toBe(422)
    })

    it('cizí hráč nemůže brát z cizí postavy, cizinec 404, DM smí', async () => {
      const rope = (await sheet(payer, from)).items.find((i: { name: string }) => i.name === 'Lano').id
      expect((await transfer(other, { toCharacterId: to, itemId: rope })).status).toBe(403)
      expect((await transfer(dave, { toCharacterId: to, itemId: rope })).status).toBe(404)
      expect((await transfer(dm, { toCharacterId: to, itemId: rope, quantity: 1 })).status).toBe(200)
    })

    it('souběžné předání stejného itemu projde jen jednou a peníze se nezdvojí', async () => {
      const gem = (await addItem(payer, from, { name: 'Drahokam' })).body.item.id
      const results = await Promise.all([1, 2, 3].map(() => transfer(payer, { toCharacterId: to, itemId: gem })))
      expect(results.filter((r) => r.status === 200)).toHaveLength(1)
      expect((await sheet(other, to)).items.filter((i: { name: string }) => i.name === 'Drahokam')).toHaveLength(1)

      const before = (await sheet(payer, from)).currency.gp
      const pay = await Promise.all(Array.from({ length: 5 }, () => transfer(payer, { toCharacterId: to, currency: { gp: before } })))
      expect(pay.filter((r) => r.status === 200)).toHaveLength(1)
      expect((await sheet(payer, from)).currency.gp).toBe(0)
      expect((await sheet(other, to)).currency.gp).toBe(30 + before)
    })
  })

  describe('kouzla postavy', () => {
    let id: string
    let fireball: string
    let fireBolt: string
    beforeAll(async () => {
      id = (await bob.client.post(`/campaigns/${campaignId}/characters`, { ...BASE, name: 'Mág' })).body.character.id
      fireball = await ruleId(bob, 'spell', 'Fireball')
      fireBolt = await ruleId(bob, 'spell', 'Fire Bolt')
    })
    const addSpell = (user: TestUser, body: unknown, characterId = id) => user.client.post(`/characters/${characterId}/spells`, body)

    it('přidá kouzlo a cantrip (cantrip je rovnou připravený)', async () => {
      const res = await addSpell(bob, { ruleId: fireball, classIdx: 'wizard' })
      expectStatus(res, 201)
      const spell = res.body.spells.find((s: { name: string }) => s.name === 'Fireball')
      expect(spell).toMatchObject({
        classIdx: 'wizard', prepared: false, level: 3, school: 'Evocation', castingTime: '1 action', range: '150 feet', components: 'V, S, M', concentration: false, ritual: false,
      })
      const cantrip = (await addSpell(bob, { ruleId: fireBolt, classIdx: 'wizard' })).body.spells.find((s: { name: string }) => s.name === 'Fire Bolt')
      expect(cantrip).toMatchObject({ level: 0, prepared: true })
      expect((await sheet(bob, id)).spells.map((s: { name: string }) => s.name)).toEqual(['Fire Bolt', 'Fireball']) // seřazené podle úrovně
    })

    it('koncentrační a rituální kouzla mají příznaky', async () => {
      const detect = await addSpell(bob, { ruleId: await ruleId(bob, 'spell', 'Detect Magic'), classIdx: 'wizard' })
      expect(detect.body.spells.find((s: { name: string }) => s.name === 'Detect Magic')).toMatchObject({ ritual: true, concentration: true })
    })

    it('duplicita 409, třída, kterou postava nemá, 422, a jiný druh záznamu 422', async () => {
      expect((await addSpell(bob, { ruleId: fireball, classIdx: 'wizard' })).status).toBe(409)
      expect((await addSpell(bob, { ruleId: fireball, classIdx: 'cleric' })).status).toBe(422)
      expect((await addSpell(bob, { ruleId: await ruleId(bob, 'weapon', 'Longsword'), classIdx: 'wizard' })).status).toBe(422)
      expect((await addSpell(bob, { ruleId: 'neni-uuid' })).status).toBe(404)
      // bez třídy (rasové kouzlo) to jde, stejné kouzlo ve dvou seznamech tříd je v pořádku
      expect((await addSpell(bob, { ruleId: fireball, classIdx: '' })).status).toBe(201)
    })

    it('připravení kouzla a odebrání', async () => {
      const spells = (await sheet(bob, id)).spells
      const fb = spells.find((s: { name: string; classIdx: string }) => s.name === 'Fireball' && s.classIdx === 'wizard')
      expect((await bob.client.patch(`/characters/${id}/spells/${fb.id}`, { prepared: true })).body.spells.find((s: { id: string }) => s.id === fb.id).prepared).toBe(true)
      expect((await bob.client.patch(`/characters/${id}/spells/${fb.id}`, { prepared: 'ano' })).status).toBe(422)
      expect((await bob.client.delete(`/characters/${id}/spells/${fb.id}`)).status).toBe(204)
      expect((await bob.client.delete(`/characters/${id}/spells/${fb.id}`)).status).toBe(404)
    })

    it('homebrew kouzlo této kampaně jde přidat, cizí kampaně ne', async () => {
      const own = (await bob.client.post(`/campaigns/${campaignId}/homebrew`, { kind: 'spell', name: 'Bobovo kouzlo', level: 1, description: 'x', concentration: true })).body.entry.id
      expectStatus(await addSpell(bob, { ruleId: own, classIdx: 'wizard' }), 201)
      const foreign = (await dm.client.post(`/campaigns/${otherCampaignId}/homebrew`, { kind: 'spell', name: 'Cizí kouzlo', level: 1 })).body.entry.id
      expect([404, 422]).toContain((await addSpell(bob, { ruleId: foreign })).status)
    })

    it('oprávnění: cizí hráč 403, cizinec 404, DM smí', async () => {
      expect((await addSpell(carol, { ruleId: fireball, classIdx: 'wizard' })).status).toBe(403)
      expect((await addSpell(dave, { ruleId: fireball, classIdx: 'wizard' })).status).toBe(404)
      const dmAdd = await addSpell(dm, { ruleId: await ruleId(dm, 'spell', 'Shield'), classIdx: 'wizard' })
      expect(dmAdd.status).toBe(201)
      const spell = dmAdd.body.spells.find((s: { name: string }) => s.name === 'Shield')
      expect((await carol.client.patch(`/characters/${id}/spells/${spell.id}`, { prepared: true })).status).toBe(403)
      expect((await carol.client.delete(`/characters/${id}/spells/${spell.id}`)).status).toBe(403)
    })

    it('koncentrace se nastaví a zruší přes adjust', async () => {
      const on = await bob.client.post(`/characters/${id}/adjust`, { ops: [{ op: 'concentration', set: 'Detect Magic' }] })
      expect(on.body.state.concentration).toBe('Detect Magic')
      expect((await sheet(bob, id)).state.concentration).toBe('Detect Magic')
      const off = await bob.client.post(`/characters/${id}/adjust`, { ops: [{ op: 'concentration', set: null }] })
      expect(off.body.state.concentration).toBeNull()
      expect((await bob.client.post(`/characters/${id}/adjust`, { ops: [{ op: 'concentration', set: 5 }] })).status).toBe(422)
    })
  })

  describe('nastavení kampaně: nosnost', () => {
    it('DM zapne a vypne nosnost, hráč ne, neznámá nastavení se odmítnou', async () => {
      expect((await bob.client.patch(`/campaigns/${campaignId}`, { settings: { encumbrance: true } })).status).toBe(403)
      const on = await dm.client.patch(`/campaigns/${campaignId}`, { settings: { encumbrance: true } })
      expect(on.body.campaign.settings).toEqual({ encumbrance: true })
      expect((await bob.client.get(`/campaigns/${campaignId}`)).body.campaign.settings).toEqual({ encumbrance: true })
      expect((await dm.client.patch(`/campaigns/${campaignId}`, { settings: { hack: 1 } })).status).toBe(422)
      expect((await dm.client.patch(`/campaigns/${campaignId}`, { settings: { encumbrance: 'ano' } })).status).toBe(422)
      expect((await dm.client.patch(`/campaigns/${campaignId}`, { settings: { encumbrance: false } })).body.campaign.settings).toEqual({ encumbrance: false })
    })
  })

  it('smazání postavy odstraní i její inventář a kouzla', async () => {
    const temp = (await bob.client.post(`/campaigns/${campaignId}/characters`, { ...BASE, name: 'Dočasná' })).body.character.id
    await addItem(bob, temp, { name: 'Něco' })
    await bob.client.post(`/characters/${temp}/spells`, { ruleId: await ruleId(bob, 'spell', 'Fireball'), classIdx: 'wizard' })
    expect((await bob.client.delete(`/characters/${temp}`)).status).toBe(204)
    expect((await bob.client.get(`/characters/${temp}`)).status).toBe(404)
  })
})
