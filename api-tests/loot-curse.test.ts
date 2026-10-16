import { beforeAll, describe, expect, it } from 'vitest'
import { Client, createCampaign, expectStatus, joinAsPlayer, registerUser, type TestUser } from './client'

const body = (name: string, extra: Record<string, unknown> = {}) => ({
  name,
  abilityScores: { str: 10, dex: 14, con: 10, int: 10, wis: 10, cha: 10 },
  levels: [{ classIndex: 'fighter', hpRoll: null }],
  ...extra,
})

describe('druhy itemů, kletby a loot DM', () => {
  let dm: TestUser
  let bob: TestUser
  let carol: TestUser
  let eve: TestUser
  let campaignId: string
  let bobChar: string
  let carolChar: string

  const items = async (viewer: TestUser, charId: string) => (await viewer.client.get(`/characters/${charId}`)).body.character.items as any[]
  const give = (item: Record<string, unknown>, ids: string[]) => dm.client.post(`/campaigns/${campaignId}/dm/items`, { characterIds: ids, item })

  beforeAll(async () => {
    dm = await registerUser('lootdm')
    campaignId = await createCampaign(dm, 'Loot')
    bob = await joinAsPlayer(dm, campaignId, 'bob')
    carol = await joinAsPlayer(dm, campaignId, 'carol')
    eve = await registerUser('eve')
    bobChar = (await bob.client.post(`/campaigns/${campaignId}/characters`, body('Bob'))).body.character.id
    carolChar = (await carol.client.post(`/campaigns/${campaignId}/characters`, body('Carol'))).body.character.id
  })

  describe('druhy itemů', () => {
    it('přijme všech 10 druhů a odmítne neznámý', async () => {
      for (const kind of ['wondrous', 'weapon', 'armor', 'shield', 'staff', 'wand', 'rod', 'scroll', 'potion', 'other']) {
        const res = await bob.client.post(`/characters/${bobChar}/items`, { name: `Test ${kind}`, kind, ...(kind === 'armor' || kind === 'shield' ? { armor: { base: 11, dexBonus: true } } : {}), ...(kind === 'weapon' ? { weapon: { damageDice: '1d6', damageType: 'Slashing', category: 'simple', range: 'melee' } } : {}) })
        expectStatus(res, 201)
        expect(res.body.item.kind).toBe(kind)
      }
      expectStatus(await bob.client.post(`/characters/${bobChar}/items`, { name: 'X', kind: 'item' }), 422)
    })

  })

  describe('kletby', () => {
    let itemId: string

    it('kletbu nastaví jen DM; hráč ji nesmí nastavit ani odkrýt', async () => {
      expectStatus(await bob.client.post(`/characters/${bobChar}/items`, { name: 'Falešné prokletí', curse: 'sám sobě' }), 403)
      const res = await give({ name: 'Démonické kopí', kind: 'weapon', weapon: { damageDice: '1d6', damageType: 'Piercing', category: 'martial', range: 'melee' }, description: '**Ďábelský šepot**: slyší tě.', curse: 'Majitel slyší hlasy a při krvi dostane **nevýhodu** na Wisdom saves.' }, [bobChar])
      expectStatus(res, 200)
      itemId = (await items(dm, bobChar)).find((i) => i.name === 'Démonické kopí').id
      expectStatus(await bob.client.patch(`/characters/${bobChar}/items/${itemId}`, { curseRevealed: true }), 403)
      expectStatus(await bob.client.patch(`/characters/${bobChar}/items/${itemId}`, { curse: null }), 403)
    })

    it('DM kletbu vidí, majitel ani ostatní ne (ani náznak), a to všude, kde se item vrací', async () => {
      const dmView = (await items(dm, bobChar)).find((i) => i.id === itemId)
      expect(dmView.curse).toEqual({ text: expect.stringContaining('hlasy'), revealed: false })
      for (const viewer of [bob]) {
        const mine = (await items(viewer, bobChar)).find((i) => i.id === itemId)
        expect(mine.curse).toBeNull()
        expect(JSON.stringify(mine)).not.toContain('hlasy')
      }
      await dm.client.patch(`/characters/${bobChar}`, { visibility: 'full' })
      expect(JSON.stringify((await carol.client.get(`/characters/${bobChar}`)).body)).not.toContain('hlasy')
      expect(JSON.stringify((await carol.client.get(`/campaigns/${campaignId}/characters`)).body)).not.toContain('hlasy')
      expect(JSON.stringify((await bob.client.get(`/campaigns/${campaignId}/characters`)).body)).not.toContain('hlasy')
      // odpovědi na úpravy itemu a postavy, které dostane majitel
      const patched = await bob.client.patch(`/characters/${bobChar}/items/${itemId}`, { quantity: 1 })
      expect(patched.body.item.curse).toBeNull()
      expect(JSON.stringify((await bob.client.patch(`/characters/${bobChar}`, { notes: 'x' })).body)).not.toContain('hlasy')
    })

    it('odhalení kletby ji ukáže majiteli a pošle mu oznámení, skrytí ji zase schová', async () => {
      const res = await dm.client.patch(`/characters/${bobChar}/items/${itemId}`, { curseRevealed: true })
      expectStatus(res, 200)
      expect(res.body.item.curse).toMatchObject({ revealed: true })
      const mine = (await items(bob, bobChar)).find((i) => i.id === itemId)
      expect(mine.curse).toEqual({ text: expect.stringContaining('hlasy'), revealed: true })
      expect((await bob.client.get('/notifications')).body.notifications.map((n: any) => n.text)).toContain('DM odhalil kletbu na itemu: Démonické kopí')
      await dm.client.patch(`/characters/${bobChar}/items/${itemId}`, { curseRevealed: false })
      expect((await items(bob, bobChar)).find((i) => i.id === itemId).curse).toBeNull()
    })

    it('kletba se při předání itemu přenáší (a zůstává skrytá), smazání textu kletbu odstraní', async () => {
      await bob.client.post(`/characters/${bobChar}/transfer`, { toCharacterId: carolChar, itemId })
      const moved = (await items(dm, carolChar)).find((i) => i.name === 'Démonické kopí')
      expect(moved.curse).toMatchObject({ revealed: false })
      expect((await items(carol, carolChar)).find((i) => i.name === 'Démonické kopí').curse).toBeNull()
      const cleared = await dm.client.patch(`/characters/${carolChar}/items/${moved.id}`, { curse: null })
      expect(cleared.body.item.curse).toBeNull()
    })

    it('kletbu nepřečte ani level-up odpověď majitele', async () => {
      const kopi = await give({ name: 'Zlořečený prsten', kind: 'wondrous', curse: 'TAJNÁ-KLETBA' }, [bobChar])
      expectStatus(kopi, 200)
      const level = await bob.client.post(`/characters/${bobChar}/levelup`, { classIndex: 'fighter' })
      expect(level.status).toBe(201)
      expect(JSON.stringify(level.body)).not.toContain('TAJNÁ-KLETBA')
      // DM kletbu vidí ve všech odpovědích (skrytí je výchozí, DM musí dostat příznak všude)
      expect(JSON.stringify((await dm.client.post(`/characters/${bobChar}/levelup/revert`, {})).body)).toContain('TAJNÁ-KLETBA')
      expect(JSON.stringify((await dm.client.get(`/campaigns/${campaignId}/characters`)).body)).toContain('TAJNÁ-KLETBA')
      expect(JSON.stringify((await dm.client.patch(`/characters/${bobChar}`, { notes: 'DM' })).body)).toContain('TAJNÁ-KLETBA')
      const ringId = (await items(dm, bobChar)).find((i) => i.name === 'Zlořečený prsten').id
      expect((await dm.client.patch(`/characters/${bobChar}/items/${ringId}`, { quantity: 1 })).body.item.curse).toMatchObject({ text: 'TAJNÁ-KLETBA' })
      const added = await dm.client.post(`/characters/${bobChar}/items`, { name: 'Další prokletí', curse: 'DM-VIDÍ' })
      expect(added.body.item.curse).toEqual({ text: 'DM-VIDÍ', revealed: false })
    })
  })

  describe('loot DM: složky a rozdávání', () => {
    let dungeon: string
    let room: string
    let swordEntry: string
    let goldEntry: string
    const loot = async () => (await dm.client.get(`/campaigns/${campaignId}/loot`)).body as { folders: any[]; entries: any[] }

    it('jen DM: hráč 403, cizinec 404, anonym 401', async () => {
      for (const [method, url, payload] of [
        ['GET', `/campaigns/${campaignId}/loot`, undefined],
        ['POST', `/campaigns/${campaignId}/loot/folders`, { name: 'X' }],
        ['POST', `/campaigns/${campaignId}/loot/entries`, { kind: 'gold', currency: { gp: 1 } }],
        ['POST', `/campaigns/${campaignId}/loot/give`, { assignments: [] }],
      ] as const) {
        expect((await bob.client.request(method, url, payload)).status, `${method} ${url}`).toBe(403)
        expect((await eve.client.request(method, url, payload)).status, `${method} ${url}`).toBe(404)
        expect((await new Client().request(method, url, payload)).status, `${method} ${url}`).toBe(401)
      }
    })

    it('složky se vnořují (dungeon -> místnost), přejmenují, přesouvají a mažou i s obsahem', async () => {
      dungeon = (await dm.client.post(`/campaigns/${campaignId}/loot/folders`, { name: 'Dungeon' })).body.folder.id
      room = (await dm.client.post(`/campaigns/${campaignId}/loot/folders`, { name: 'Místnost 1', parentId: dungeon })).body.folder.id
      expect((await loot()).folders.find((f) => f.id === room)).toMatchObject({ parentId: dungeon, name: 'Místnost 1' })
      expectStatus(await dm.client.patch(`/loot/folders/${room}`, { name: 'Hrobka' }), 200)
      expectStatus(await dm.client.patch(`/loot/folders/${dungeon}`, { parentId: room }), 422) // do vlastní podsložky nejde
      expectStatus(await dm.client.post(`/campaigns/${campaignId}/loot/folders`, { name: 'X', parentId: '00000000-0000-4000-8000-000000000000' }), 422)
      expectStatus(await dm.client.post(`/campaigns/${campaignId}/loot/folders`, { name: '' }), 422)
      // hloubka je omezená
      let parent = room
      let last = 0
      for (let i = 0; i < 8; i++) {
        const r = await dm.client.post(`/campaigns/${campaignId}/loot/folders`, { name: `Hloub ${i}`, parentId: parent })
        last = r.status
        if (r.status !== 201) break
        parent = r.body.folder.id
      }
      expect(last).toBe(422)
    })

    it('položky: item (i s kletbou) a zlato ve složce, validace', async () => {
      const sword = await dm.client.post(`/campaigns/${campaignId}/loot/entries`, { folderId: room, kind: 'item', item: { name: 'Meč +1', kind: 'weapon', weapon: { damageDice: '1d8', damageType: 'Slashing', category: 'martial', range: 'melee', magicBonus: 1 }, description: '**Zářivá čepel**: svítí.', curse: 'Volá po krvi.' } })
      expectStatus(sword, 201)
      swordEntry = sword.body.entry.id
      goldEntry = (await dm.client.post(`/campaigns/${campaignId}/loot/entries`, { folderId: room, kind: 'gold', name: 'Truhla', currency: { gp: 100, sp: 5 } })).body.entry.id
      expectStatus(await dm.client.post(`/campaigns/${campaignId}/loot/entries`, { folderId: room, kind: 'gold', currency: {} }), 422)
      expectStatus(await dm.client.post(`/campaigns/${campaignId}/loot/entries`, { folderId: room, kind: 'item', item: { kind: 'weapon' } }), 422) // chybí název
      expectStatus(await dm.client.post(`/campaigns/${campaignId}/loot/entries`, { kind: 'monstrum' }), 422)
      // položka z pravidel je samostatná kopie: celé údaje (jdou upravit), bez vazby na pravidla
      const fromRule = await dm.client.post(`/campaigns/${campaignId}/loot/entries`, { folderId: room, kind: 'item', item: { ruleId: (await dm.client.get('/rules?kinds=magic_item&q=Bag of Holding')).body.entries[0].id } })
      expect(fromRule.body.entry.data).toMatchObject({ name: 'Bag of Holding', kind: 'wondrous', quantity: 1, requiresAttunement: false, curse: null })
      expect(fromRule.body.entry.data.description).toMatch(/interior space/)
      expect(fromRule.body.entry.data.ruleId).toBeUndefined()
      const all = await loot()
      expect(all.entries.filter((e) => e.folderId === room)).toHaveLength(3)
    })

    it('magická zbroj v lootu potřebuje základ a uloží se s hodnotami; rozdání ji nasadí a funguje i po smazání homebrew', async () => {
      const ruleOf = async (kinds: string, name: string) => (await dm.client.get(`/rules?kinds=${kinds}&q=${encodeURIComponent(name)}&limit=100`)).body.entries.find((e: any) => e.name === name).id
      const armorPlus = await ruleOf('magic_item', 'Armor, +1')
      const missing = await dm.client.post(`/campaigns/${campaignId}/loot/entries`, { kind: 'item', item: { ruleId: armorPlus } })
      expectStatus(missing, 422)
      expect(missing.body.error.field).toBe('baseRuleId')
      const entry = await dm.client.post(`/campaigns/${campaignId}/loot/entries`, { kind: 'item', item: { ruleId: armorPlus, baseRuleId: await ruleOf('armor', 'Chain Mail') } })
      expectStatus(entry, 201)
      expect(entry.body.entry.data).toMatchObject({ name: 'Armor, +1 (Chain Mail)', kind: 'armor', armor: { base: 16, magicBonus: 1 } })

      const hb = await dm.client.post(`/campaigns/${campaignId}/homebrew`, { kind: 'magic_item', name: 'Amulet z hrobky', description: '**Šepot**: slyší mrtvé.', visibility: 'private' })
      const amulet = await dm.client.post(`/campaigns/${campaignId}/loot/entries`, { kind: 'item', item: { ruleId: hb.body.entry.id } })
      expectStatus(amulet, 201)
      expectStatus(await dm.client.delete(`/rules/${hb.body.entry.id}`), 204)

      const knight = (await dm.client.post(`/campaigns/${campaignId}/characters`, body('Rytíř', { kind: 'npc' }))).body.character.id
      const res = await dm.client.post(`/campaigns/${campaignId}/loot/give`, { assignments: [{ entryId: entry.body.entry.id, characterIds: [knight] }, { entryId: amulet.body.entry.id, characterIds: [knight] }] })
      expectStatus(res, 200)
      const got = await items(dm, knight)
      expect(got.find((i) => i.name === 'Armor, +1 (Chain Mail)')).toMatchObject({ kind: 'armor', equipped: true, armor: { base: 16, magicBonus: 1 } })
      expect(got.find((i) => i.name === 'Amulet z hrobky')).toMatchObject({ kind: 'wondrous', description: '**Šepot**: slyší mrtvé.' })
    })

    it('přesun položky do jiné složky a úprava obsahu', async () => {
      expectStatus(await dm.client.patch(`/loot/entries/${goldEntry}`, { folderId: dungeon }), 200)
      expect((await loot()).entries.find((e) => e.id === goldEntry).folderId).toBe(dungeon)
      const edited = await dm.client.patch(`/loot/entries/${goldEntry}`, { currency: { gp: 120 }, name: 'Truhla (otevřená)' })
      expect(edited.body.entry.data).toEqual({ name: 'Truhla (otevřená)', currency: { gp: 120 } })
      expectStatus(await dm.client.patch(`/loot/entries/${goldEntry}`, { kind: 'item', item: { name: 'x' } }), 422) // druh nejde změnit
    })

    it('rozdání: item jedné postavě (s kletbou, skrytou), zlato rovným dílem, v jedné transakci', async () => {
      const bobGold = async () => (await dm.client.get(`/characters/${bobChar}`)).body.character.currency
      const before = (await bobGold()).gp
      const res = await dm.client.post(`/campaigns/${campaignId}/loot/give`, {
        assignments: [
          { entryId: swordEntry, characterIds: [bobChar] },
          { entryId: goldEntry, characterIds: [bobChar, carolChar], split: true },
        ],
      })
      expectStatus(res, 200)
      expect(res.body.given.map((g: any) => g.label)).toEqual(['Meč +1', 'Truhla (otevřená)'])
      const sword = (await items(dm, bobChar)).find((i) => i.name === 'Meč +1')
      expect(sword).toMatchObject({ kind: 'weapon', curse: { text: 'Volá po krvi.', revealed: false } })
      expect(sword.description).toContain('**Zářivá čepel**')
      expect((await items(bob, bobChar)).find((i) => i.name === 'Meč +1').curse).toBeNull()
      expect((await bobGold()).gp).toBe(before + 60)
      expect((await bob.client.get('/notifications')).body.notifications.map((n: any) => n.text)).toContain('DM ti dal: Meč +1')
      // loot zůstává pro opakované použití a ví, komu byl rozdán
      const entry = (await loot()).entries.find((e) => e.id === swordEntry)
      expect(entry.givenTo).toContain('Bob')
      expectStatus(await dm.client.patch(`/loot/entries/${swordEntry}`, { givenTo: '' }), 200)
      expect((await loot()).entries.find((e) => e.id === swordEntry).givenTo).toBe('')
    })

    it('rozdání nic nezmění, když je některá postava cizí nebo položka není z kampaně', async () => {
      const other = await createCampaign(dm, 'Jiná')
      const foreign = (await dm.client.post(`/campaigns/${other}/characters`, body('Cizinka'))).body.character.id
      const before = (await items(dm, bobChar)).length
      expectStatus(await dm.client.post(`/campaigns/${campaignId}/loot/give`, { assignments: [{ entryId: swordEntry, characterIds: [bobChar] }, { entryId: swordEntry, characterIds: [foreign] }] }), 422)
      expect((await items(dm, bobChar)).length).toBe(before)
      expectStatus(await dm.client.post(`/campaigns/${campaignId}/loot/give`, { assignments: [{ entryId: '00000000-0000-4000-8000-000000000000', characterIds: [bobChar] }] }), 422)
      expectStatus(await dm.client.post(`/campaigns/${campaignId}/loot/give`, { assignments: [{ entryId: swordEntry, characterIds: [] }] }), 422)
    })

    describe('nákup: item s cenou se platí, nalezený je zdarma', () => {
      let buyer: TestUser
      let buyerChar: string
      const wallet = async () => (await dm.client.get(`/characters/${buyerChar}`)).body.character.currency
      const notifications = async () => (await buyer.client.get('/notifications')).body.notifications.map((n: any) => n.text) as string[]

      beforeAll(async () => {
        buyer = await joinAsPlayer(dm, campaignId, 'kupec')
        buyerChar = (await buyer.client.post(`/campaigns/${campaignId}/characters`, body('Kupec'))).body.character.id
      })

      it('položka s cenou: bez peněz se nic neprodá, s penězi kupující zaplatí (s drobnými) a dostane item', async () => {
        const shop = await dm.client.post(`/campaigns/${campaignId}/loot/entries`, { kind: 'item', item: { name: 'Lano', kind: 'other' }, price: { gp: 1, sp: 5 } })
        expectStatus(shop, 201)
        expect(shop.body.entry.priceCp).toBe(150)
        const entryId = shop.body.entry.id as string
        const broke = await dm.client.post(`/campaigns/${campaignId}/loot/give`, { assignments: [{ entryId, characterIds: [buyerChar] }] })
        expectStatus(broke, 422)
        expect(broke.body.error).toMatchObject({ field: 'price', message: expect.stringContaining('Kupec') })
        expect(await items(dm, buyerChar)).toHaveLength(0)
        expect((await loot()).entries.find((e) => e.id === entryId).givenTo).toBe('')

        await dm.client.post(`/campaigns/${campaignId}/dm/currency`, { characterIds: [buyerChar], currency: { gp: 2 } })
        const ok = await dm.client.post(`/campaigns/${campaignId}/loot/give`, { assignments: [{ entryId, characterIds: [buyerChar] }] })
        expectStatus(ok, 200)
        expect(ok.body.given[0]).toMatchObject({ label: 'Lano', priceCp: 150, to: ['Kupec'] })
        expect(await wallet()).toMatchObject({ gp: 0, sp: 5, cp: 0 }) // 2 gp − 1 gp 5 sp, drobné se vrátí
        expect((await items(buyer, buyerChar)).map((i) => i.name)).toEqual(['Lano'])
        expect(await notifications()).toContain('Koupil(a) jsi: Lano za 1 gp, 5 sp')
      })

      it('nalezená položka (bez ceny) je zdarma; cenu jde změnit i zrušit; zlato cenu mít nemůže; neplatná cena 422', async () => {
        const found = await dm.client.post(`/campaigns/${campaignId}/loot/entries`, { kind: 'item', item: { name: 'Kamínek' } })
        expect(found.body.entry.priceCp).toBeNull()
        const before = await wallet()
        expectStatus(await dm.client.post(`/campaigns/${campaignId}/loot/give`, { assignments: [{ entryId: found.body.entry.id, characterIds: [buyerChar] }] }), 200)
        expect(await wallet()).toEqual(before)
        expect(await notifications()).toContain('DM ti dal: Kamínek')

        const priced = await dm.client.patch(`/loot/entries/${found.body.entry.id}`, { price: { gp: 3 } })
        expect(priced.body.entry.priceCp).toBe(300)
        const renamed = await dm.client.patch(`/loot/entries/${found.body.entry.id}`, { item: { name: 'Leštěný kamínek' } })
        expect(renamed.body.entry).toMatchObject({ priceCp: 300, data: { name: 'Leštěný kamínek' } }) // úprava itemu cenu nezmění
        expect((await dm.client.patch(`/loot/entries/${found.body.entry.id}`, { price: null })).body.entry.priceCp).toBeNull()

        expectStatus(await dm.client.post(`/campaigns/${campaignId}/loot/entries`, { kind: 'gold', currency: { gp: 1 }, price: { gp: 1 } }), 422)
        for (const price of [{ gp: -1 }, { gp: 1.5 }, 'deset']) {
          const bad = await dm.client.post(`/campaigns/${campaignId}/loot/entries`, { kind: 'item', item: { name: 'X' }, price })
          expectStatus(bad, 422)
          expect(bad.body.error.field).toBe('price')
        }
      })

      it('Dát item v Panelu DM s cenou: nákup v obchodě (bez peněz nic), hráč zaplatí a dostane oznámení', async () => {
        const tooMuch = await dm.client.post(`/campaigns/${campaignId}/dm/items`, { characterIds: [buyerChar], item: { name: 'Plátová zbroj' }, price: { gp: 1500 } })
        expectStatus(tooMuch, 422)
        expect((await items(dm, buyerChar)).some((i) => i.name === 'Plátová zbroj')).toBe(false)
        const before = await wallet()
        const res = await dm.client.post(`/campaigns/${campaignId}/dm/items`, { characterIds: [buyerChar], item: { name: 'Pochodeň' }, price: { cp: 1 } })
        expectStatus(res, 200)
        expect(res.body).toMatchObject({ given: 1, priceCp: 1 })
        const after = await wallet()
        expect(after.gp * 100 + after.sp * 10 + after.cp).toBe(before.gp * 100 + before.sp * 10 + before.cp - 1)
        expect(await notifications()).toContain('Koupil(a) jsi: Pochodeň za 1 cp')
        // hráč si sám nic „nekoupí“: Panel DM je jen pro DM
        expectStatus(await buyer.client.post(`/campaigns/${campaignId}/dm/items`, { characterIds: [buyerChar], item: { name: 'X' }, price: { cp: 1 } }), 403)
      })
    })

    it('smazání složky smaže podsložky i položky v nich', async () => {
      expectStatus(await dm.client.delete(`/loot/folders/${dungeon}`), 204)
      const after = await loot()
      expect(after.folders.find((f) => f.id === room)).toBeUndefined()
      expect(after.entries.find((e) => e.id === swordEntry)).toBeUndefined()
    })
  })
})
