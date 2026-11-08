import { beforeAll, describe, expect, it } from 'vitest'
import { Client, createCampaign, expectStatus, joinAsPlayer, registerUser, type TestUser } from './client'

const BASE = {
  abilityScores: { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 10 },
  levels: [{ classIndex: 'fighter', hpRoll: null }],
}
const TRIP = { id: 'f-trip', name: 'Trip Attack', source: 'Battle Master: manévr', description: '**Trip**: +1d8 a STR save, jinak Prone.' }

describe('vlastní featury a zbraň oběma rukama', () => {
  let dm: TestUser
  let bob: TestUser
  let carol: TestUser
  let dave: TestUser
  let campaignId: string
  let id: string

  beforeAll(async () => {
    dm = await registerUser('cfdm')
    campaignId = await createCampaign(dm, 'Featury')
    bob = await joinAsPlayer(dm, campaignId, 'cfbob')
    carol = await joinAsPlayer(dm, campaignId, 'cfcarol')
    dave = await registerUser('cfdave')
    id = (await bob.client.post(`/campaigns/${campaignId}/characters`, { ...BASE, name: 'Filip' })).body.character.id
  })

  it('nová postava nemá žádné, majitel je přidá, upraví a smaže', async () => {
    expect((await bob.client.get(`/characters/${id}`)).body.character.customFeatures).toEqual([])
    const res = await bob.client.patch(`/characters/${id}`, { customFeatures: [TRIP, { id: 'f-riposte', name: 'Riposte' }] })
    expectStatus(res, 200)
    expect(res.body.character.customFeatures).toEqual([TRIP, { id: 'f-riposte', name: 'Riposte', source: '', description: '' }])
    const edited = await bob.client.patch(`/characters/${id}`, { customFeatures: [{ ...TRIP, name: 'Trip Attack (upraveno)' }] })
    expect(edited.body.character.customFeatures).toEqual([{ ...TRIP, name: 'Trip Attack (upraveno)' }])
  })

  it('DM je upraví také, ostatní hráč ne (403) a v náhledu je nevidí, cizinec 404, anonym 401', async () => {
    expectStatus(await dm.client.patch(`/characters/${id}`, { customFeatures: [TRIP] }), 200)
    expectStatus(await carol.client.patch(`/characters/${id}`, { customFeatures: [] }), 403)
    expectStatus(await carol.client.get(`/characters/${id}`), 403)
    const preview = (await carol.client.get(`/campaigns/${campaignId}/characters`)).body.characters.find((c: { id: string }) => c.id === id)
    expect(preview.access).toBe('public')
    expect(preview).not.toHaveProperty('customFeatures')
    expectStatus(await dave.client.patch(`/characters/${id}`, { customFeatures: [] }), 404)
    expectStatus(await dave.client.get(`/characters/${id}`), 404)
    expectStatus(await new Client().patch(`/characters/${id}`, { customFeatures: [] }), 401)
    expect((await bob.client.get(`/characters/${id}`)).body.character.customFeatures).toEqual([TRIP])
  })

  it('odmítá neplatný tvar: bez názvu, dlouhý text, špatné nebo zdvojené id, víc než 60', async () => {
    const bad = [
      [{ id: 'a', name: '' }],
      [{ id: 'a', name: 'x'.repeat(101) }],
      [{ id: 'a', name: 'X', description: 'x'.repeat(4001) }],
      [{ id: 'a b', name: 'X' }],
      [{ name: 'X' }],
      [
        { id: 'a', name: 'X' },
        { id: 'a', name: 'Y' },
      ],
      Array.from({ length: 61 }, (_, i) => ({ id: `f${i}`, name: 'X' })),
      'nesmysl',
    ]
    for (const customFeatures of bad) {
      const res = await bob.client.patch(`/characters/${id}`, { customFeatures })
      expectStatus(res, 422)
      expect(res.body.error.field).toBe('customFeatures')
    }
    expect((await bob.client.get(`/characters/${id}`)).body.character.customFeatures).toEqual([TRIP])
  })

  it('Longsword z pravidel nese kostku oběma rukama, vlastní zbraň ji může zadat nebo vynechat', async () => {
    const rule = (await bob.client.get('/rules?kinds=weapon&q=Longsword')).body.entries.find((e: { name: string }) => e.name === 'Longsword')
    const fromRule = await bob.client.post(`/characters/${id}/items`, { ruleId: rule.id })
    expectStatus(fromRule, 201)
    expect(fromRule.body.item.weapon).toMatchObject({ damageDice: '1d8', versatileDice: '1d10' })

    const weapon = { damageDice: '1d6', damageType: 'Piercing', category: 'simple', range: 'melee', properties: ['Versatile'] }
    const custom = await bob.client.post(`/characters/${id}/items`, { name: 'Harpuna', kind: 'weapon', weapon: { ...weapon, versatileDice: '1D10' } })
    expectStatus(custom, 201)
    expect(custom.body.item.weapon.versatileDice).toBe('1d10')
    const omitted = await bob.client.post(`/characters/${id}/items`, { name: 'Kopí', kind: 'weapon', weapon })
    expect(omitted.body.item.weapon).not.toHaveProperty('versatileDice')
    expectStatus(await bob.client.post(`/characters/${id}/items`, { name: 'Zlé', kind: 'weapon', weapon: { ...weapon, versatileDice: 'hodně' } }), 422)
  })
})
