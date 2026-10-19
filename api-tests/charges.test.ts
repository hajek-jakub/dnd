import { beforeAll, describe, expect, it } from 'vitest'
import { Client, createCampaign, expectStatus, joinAsPlayer, registerUser, testDbExec, type TestUser } from './client'

/**
 * Náboje itemů (Wand of Wonder 7, obnova 1d6+1 za úsvitu): z popisu SRD, ruční nastavení, utracení a dobití přes adjust,
 * meze, oprávnění, předání, loot a jednorázové doplnění u dřív získaných itemů.
 */
const BASE = { abilityScores: { str: 10, dex: 14, con: 12, int: 16, wis: 10, cha: 8 }, levels: [{ classIndex: 'wizard' }] }

describe('náboje itemů', () => {
  let dm: TestUser
  let bob: TestUser
  let carol: TestUser
  let stranger: TestUser
  let campaignId: string
  let bobChar: string
  let carolChar: string
  let wandId: string

  const rule = async (name: string) => (await dm.client.get(`/rules?kinds=magic_item&q=${encodeURIComponent(name)}&limit=50`)).body.entries.find((e: any) => e.name === name).id
  const adjust = (user: TestUser, id: string, ops: unknown[]) => user.client.post(`/characters/${id}/adjust`, { ops })
  const item = async (user: TestUser, charId: string, itemId: string) => (await user.client.get(`/characters/${charId}`)).body.character.items.find((i: any) => i.id === itemId)

  beforeAll(async () => {
    dm = await registerUser('dm')
    campaignId = await createCampaign(dm, 'Náboje')
    bob = await joinAsPlayer(dm, campaignId, 'bob')
    carol = await joinAsPlayer(dm, campaignId, 'carol')
    stranger = await registerUser('cizi')
    bobChar = (await bob.client.post(`/campaigns/${campaignId}/characters`, { ...BASE, name: 'Bob' })).body.character.id
    carolChar = (await carol.client.post(`/campaigns/${campaignId}/characters`, { ...BASE, name: 'Carol' })).body.character.id
  })

  it('item z pravidel dostane náboje z popisu, item bez nábojů je nemá', async () => {
    const wand = await bob.client.post(`/characters/${bobChar}/items`, { ruleId: await rule('Wand of Wonder') })
    expectStatus(wand, 201)
    expect(wand.body.item.charges).toEqual({ max: 7, used: 0, recharge: '1d6+1' })
    wandId = wand.body.item.id
    const eyes = (await bob.client.post(`/characters/${bobChar}/items`, { ruleId: await rule('Eyes of Charming') })).body.item
    expect(eyes.charges).toEqual({ max: 3, used: 0, recharge: 'all' })
    const staff = (await bob.client.post(`/characters/${bobChar}/items`, { ruleId: await rule('Staff of Charming') })).body.item
    expect(staff.charges).toEqual({ max: 10, used: 0, recharge: '1d8+2' })
    const bag = (await bob.client.post(`/characters/${bobChar}/items`, { ruleId: await rule('Bag of Holding') })).body.item
    expect(bag.charges).toBeNull()
  })

  it('utracení a vrácení nábojů drží meze 0 až maximum', async () => {
    const spent = await adjust(bob, bobChar, [{ op: 'charges', itemId: wandId, delta: -2 }])
    expectStatus(spent, 200)
    expect(spent.body.charges[wandId]).toEqual({ max: 7, used: 2, recharge: '1d6+1' })
    expect(spent.body.recharged).toEqual([])
    await adjust(bob, bobChar, [{ op: 'charges', itemId: wandId, delta: -20 }])
    expect((await item(bob, bobChar, wandId)).charges.used).toBe(7)
    await adjust(bob, bobChar, [{ op: 'charges', itemId: wandId, delta: 3 }])
    expect((await item(bob, bobChar, wandId)).charges.used).toBe(4)
    await adjust(bob, bobChar, [{ op: 'charges', itemId: wandId, delta: 50 }])
    expect((await item(bob, bobChar, wandId)).charges.used).toBe(0)
    expectStatus(await adjust(bob, bobChar, [{ op: 'charges', itemId: wandId, delta: 1.5 }]), 422)
    expectStatus(await adjust(bob, bobChar, [{ op: 'charges', itemId: wandId, delta: -101 }]), 422)
  })

  it('dobití hodí obnovu na serveru a vrátí nejvýš spotřebované náboje', async () => {
    await adjust(bob, bobChar, [{ op: 'charges', itemId: wandId, delta: -7 }])
    const res = await adjust(bob, bobChar, [{ op: 'recharge', itemId: wandId }])
    expectStatus(res, 200)
    const [r] = res.body.recharged
    expect(r).toMatchObject({ itemId: wandId, name: 'Wand of Wonder', expression: '1d6+1' })
    expect(r.rolled).toBeGreaterThanOrEqual(2)
    expect(r.rolled).toBeLessThanOrEqual(7)
    expect(r.gained).toBe(r.rolled)
    expect(res.body.charges[wandId].used).toBe(7 - r.gained)
    // plná hůlka: hod proběhne, ale nic nepřibude
    await adjust(bob, bobChar, [{ op: 'charges', itemId: wandId, delta: 7 }])
    const full = await adjust(bob, bobChar, [{ op: 'recharge', itemId: wandId }])
    expect(full.body.recharged[0].gained).toBe(0)
    expect(full.body.charges[wandId].used).toBe(0)
  })

  it('ruční nastavení: maximum, obnova „all“ i číslo, snížení maxima ořízne spotřebované, zrušení počítadla', async () => {
    const lamp = (await bob.client.post(`/characters/${bobChar}/items`, { name: 'Lucerna duchů', kind: 'wondrous', charges: { max: 5, recharge: 'all' } })).body.item
    expect(lamp.charges).toEqual({ max: 5, used: 0, recharge: 'all' })
    await adjust(bob, bobChar, [{ op: 'charges', itemId: lamp.id, delta: -4 }])
    const recharged = await adjust(bob, bobChar, [{ op: 'recharge', itemId: lamp.id }])
    expect(recharged.body.recharged[0]).toMatchObject({ expression: 'all', rolled: null, gained: 4 })
    await adjust(bob, bobChar, [{ op: 'charges', itemId: lamp.id, delta: -4 }])
    const lowered = await bob.client.patch(`/characters/${bobChar}/items/${lamp.id}`, { charges: { max: 2, recharge: '1' } })
    expectStatus(lowered, 200)
    expect((await item(bob, bobChar, lamp.id)).charges).toEqual({ max: 2, used: 2, recharge: '1' })
    expect((await adjust(bob, bobChar, [{ op: 'recharge', itemId: lamp.id }])).body.recharged[0]).toMatchObject({ rolled: 1, gained: 1 })
    await bob.client.patch(`/characters/${bobChar}/items/${lamp.id}`, { charges: { max: 3, recharge: null } })
    expectStatus(await adjust(bob, bobChar, [{ op: 'recharge', itemId: lamp.id }]), 422) // nedobíjí se samo
    expectStatus(await bob.client.patch(`/characters/${bobChar}/items/${lamp.id}`, { charges: null }), 200)
    expect((await item(bob, bobChar, lamp.id)).charges).toBeNull()
    expectStatus(await adjust(bob, bobChar, [{ op: 'charges', itemId: lamp.id, delta: -1 }]), 422) // item bez nábojů
    for (const charges of [{ max: 0 }, { max: 101 }, { max: '7' }, { max: 3, recharge: 'hodně' }, { max: 3, recharge: '1d6+' }, 7]) {
      const bad = await bob.client.post(`/characters/${bobChar}/items`, { name: 'Špatná', charges })
      expectStatus(bad, 422)
      expect(bad.body.error.field).toBe('charges')
    }
  })

  it('oprávnění: cizí item 404, cizí postava 403, cizinec 404, anonym 401; DM smí', async () => {
    const carolBag = (await carol.client.post(`/characters/${carolChar}/items`, { name: 'Hůl', charges: { max: 3 } })).body.item
    // item jiné postavy nejde měnit přes vlastní postavu
    expectStatus(await adjust(bob, bobChar, [{ op: 'charges', itemId: carolBag.id, delta: -1 }]), 404)
    expectStatus(await adjust(bob, bobChar, [{ op: 'recharge', itemId: carolBag.id }]), 404)
    expectStatus(await adjust(bob, carolChar, [{ op: 'charges', itemId: carolBag.id, delta: -1 }]), 403)
    expectStatus(await adjust(stranger, carolChar, [{ op: 'charges', itemId: carolBag.id, delta: -1 }]), 404)
    expectStatus(await new Client().post(`/characters/${carolChar}/adjust`, { ops: [{ op: 'charges', itemId: carolBag.id, delta: -1 }] }), 401)
    expect((await item(carol, carolChar, carolBag.id)).charges.used).toBe(0)
    expectStatus(await adjust(dm, carolChar, [{ op: 'charges', itemId: carolBag.id, delta: -1 }]), 200)
    expect((await item(carol, carolChar, carolBag.id)).charges.used).toBe(1)
  })

  it('náboje zůstanou při předání; DM a loot je dají s itemem z pravidel', async () => {
    await adjust(bob, bobChar, [{ op: 'charges', itemId: wandId, delta: -3 }])
    expectStatus(await bob.client.post(`/characters/${bobChar}/transfer`, { toCharacterId: carolChar, itemId: wandId }), 200)
    const moved = (await carol.client.get(`/characters/${carolChar}`)).body.character.items.find((i: any) => i.name === 'Wand of Wonder')
    expect(moved.charges).toEqual({ max: 7, used: 3, recharge: '1d6+1' })

    const given = await dm.client.post(`/campaigns/${campaignId}/dm/items`, { characterIds: [bobChar], item: { ruleId: await rule('Wand of Fireballs') } })
    expectStatus(given, 200)
    expect((await bob.client.get(`/characters/${bobChar}`)).body.character.items.find((i: any) => i.name === 'Wand of Fireballs').charges).toEqual({ max: 7, used: 0, recharge: '1d6+1' })

    const entry = await dm.client.post(`/campaigns/${campaignId}/loot/entries`, { kind: 'item', item: { ruleId: await rule('Ring of the Ram') } })
    expectStatus(entry, 201)
    expect(entry.body.entry.data.charges).toEqual({ max: 3, recharge: '1d3' })
    const edited = await dm.client.patch(`/loot/entries/${entry.body.entry.id}`, { item: { ...entry.body.entry.data, charges: { max: 4, recharge: '1d3' } } })
    expectStatus(edited, 200)
    expectStatus(await dm.client.post(`/campaigns/${campaignId}/loot/give`, { assignments: [{ entryId: entry.body.entry.id, characterIds: [carolChar] }] }), 200)
    const ring = (await carol.client.get(`/characters/${carolChar}`)).body.character.items.find((i: any) => i.name === 'Ring of the Ram')
    expect(ring.charges).toEqual({ max: 4, used: 0, recharge: '1d3' })
  })

  it('nasazení jednou doplní náboje itemům získaným před migrací, zrušené počítadlo už nevrací', async () => {
    const old = (await bob.client.post(`/characters/${bobChar}/items`, { ruleId: await rule('Wand of Magic Missiles') })).body.item
    const removed = (await bob.client.post(`/characters/${bobChar}/items`, { ruleId: await rule('Wand of Web') })).body.item
    // stav jako před migrací 023: náboje nevyplněné; značka opravy smazaná
    testDbExec('UPDATE character_items SET charges_max = NULL, charges_recharge = NULL WHERE id = ?', [old.id])
    testDbExec("DELETE FROM seed_state WHERE name = 'repair:charges-v1'")
    const key = { 'X-Migrate-Key': 'test-migrate' }
    const seed = await new Client().request('POST', '/admin/seed', {}, key)
    expectStatus(seed, 200)
    expect(seed.body.repairedItems).toContain('Wand of Magic Missiles (Bob, náboje 7)')
    expect((await item(bob, bobChar, old.id)).charges).toEqual({ max: 7, used: 0, recharge: '1d6+1' })
    // DM počítadlo zruší, další nasazení ho nevrátí
    await dm.client.patch(`/characters/${bobChar}/items/${removed.id}`, { charges: null })
    const again = await new Client().request('POST', '/admin/seed', {}, key)
    expect(again.body.repairedItems.some((s: string) => s.includes('náboje'))).toBe(false)
    expect((await item(bob, bobChar, removed.id)).charges).toBeNull()
  })
})
