import { beforeAll, describe, expect, it } from 'vitest'
import { createCampaign, expectStatus, joinAsPlayer, registerUser, type TestUser } from './client'

const body = (name: string, extra: Record<string, unknown> = {}) => ({
  name,
  abilityScores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
  levels: [{ classIndex: 'fighter', hpRoll: null }],
  ...extra,
})

describe('NPC (postavy DM bez majitele)', () => {
  let dm: TestUser
  let bob: TestUser
  let eve: TestUser
  let campaignId: string
  let bobChar: string

  beforeAll(async () => {
    dm = await registerUser('npcdm')
    bob = await joinAsPlayer(dm, campaignId = await createCampaign(dm, 'NPC'), 'bob')
    eve = await registerUser('eve')
    bobChar = (await bob.client.post(`/campaigns/${campaignId}/characters`, body('Bob'))).body.character.id
  })

  const makeNpc = async (name: string, extra: Record<string, unknown> = {}) => {
    const res = await dm.client.post(`/campaigns/${campaignId}/characters`, body(name, { kind: 'npc', ...extra }))
    expectStatus(res, 201)
    return res.body.character
  }

  it('DM vytvoří NPC bez majitele, může jich mít víc', async () => {
    const batan = await makeNpc('Batan')
    const barman = await makeNpc('Barman')
    expect(batan).toMatchObject({ kind: 'npc', ownerId: null, name: 'Batan', access: 'full' })
    expect(barman.id).not.toBe(batan.id)
    expect((await bob.client.get(`/campaigns/${campaignId}/characters`)).body.characters.filter((c: any) => c.kind === 'npc')).toHaveLength(2)
  })

  it('hráčská postava je kind pc a hráč NPC vytvořit nesmí', async () => {
    expect((await bob.client.get(`/characters/${bobChar}`)).body.character).toMatchObject({ kind: 'pc', ownerId: bob.id })
    expectStatus(await bob.client.post(`/campaigns/${campaignId}/characters`, body('Falešné NPC', { kind: 'npc' })), 403)
    expectStatus(await dm.client.post(`/campaigns/${campaignId}/characters`, body('Špatný druh', { kind: 'boss' })), 422)
    expectStatus(await dm.client.post(`/campaigns/${campaignId}/characters`, body('NPC s majitelem', { kind: 'npc', ownerId: bob.id })), 422)
  })

  it('hráč vidí NPC jen jako veřejný náhled a nemůže ho upravit; DM ho vidí celé', async () => {
    const npc = await makeNpc('Tajný Mistr')
    const preview = (await bob.client.get(`/campaigns/${campaignId}/characters`)).body.characters.find((c: any) => c.id === npc.id)
    expect(preview).toMatchObject({ access: 'public', kind: 'npc', name: 'Tajný Mistr' })
    expect(preview.items).toBeUndefined()
    expectStatus(await bob.client.get(`/characters/${npc.id}`), 403)
    expectStatus(await bob.client.patch(`/characters/${npc.id}`, { name: 'Zmena' }), 403)
    expectStatus(await bob.client.post(`/characters/${npc.id}/adjust`, { ops: [{ op: 'hp', delta: -1, max: 10 }] }), 403)
    expectStatus(await eve.client.get(`/characters/${npc.id}`), 404)
    expectStatus(await dm.client.patch(`/characters/${npc.id}`, { name: 'Mistr' }), 200)
  })

  it('NPC nejde přiřadit majiteli', async () => {
    const npc = await makeNpc('Bez pána')
    expectStatus(await dm.client.patch(`/characters/${npc.id}`, { ownerId: bob.id }), 422)
  })

  it('hráč může NPC předat peníze i item, bez chyby kvůli chybějícímu majiteli', async () => {
    const npc = await makeNpc('Batan Dva')
    await dm.client.post(`/campaigns/${campaignId}/dm/currency`, { characterIds: [bobChar], currency: { gp: 30 } })
    const res = await bob.client.post(`/characters/${bobChar}/transfer`, { toCharacterId: npc.id, currency: { gp: 12 } })
    expectStatus(res, 200)
    expect(res.body.currency.gp).toBe(18)
    expect((await dm.client.get(`/characters/${npc.id}`)).body.character.currency.gp).toBe(12)
  })

  it('akce DM na NPC (peníze, XP, léčení) nespadnou a NPC nikdo neoznamuje', async () => {
    const npc = await makeNpc('Cíl DM')
    for (const [path, payload] of [
      ['currency', { characterIds: [npc.id], currency: { gp: 5 } }],
      ['xp', { characterIds: [npc.id], amount: 100 }],
      ['inspiration', { characterIds: [npc.id], set: true }],
      ['hp', { delta: -3, targets: [{ characterId: npc.id, max: 12 }] }],
    ] as const) {
      expectStatus(await dm.client.post(`/campaigns/${campaignId}/dm/${path}`, payload), 200)
    }
    expect((await dm.client.get(`/characters/${npc.id}`)).body.character.currency.gp).toBe(5)
  })

  it('NPC se do jazykových zpráv nepočítá', async () => {
    await makeNpc('Mluvka', { extraProficiencies: ['Language: Orc'] })
    expectStatus(await bob.client.post(`/campaigns/${campaignId}/characters`, body('Bob2', { extraProficiencies: ['Language: Orc'] })), 201)
    const res = await bob.client.post(`/campaigns/${campaignId}/messages`, { to: { language: 'Orc' }, body: 'hej' })
    expectStatus(res, 422) // žádný další hráč s tímto jazykem
  })
})

describe('nepřátelé (jen pro DM)', () => {
  let dm: TestUser
  let bob: TestUser
  let eve: TestUser
  let campaignId: string
  let bobChar: string

  const enemies = async () => (await dm.client.get(`/campaigns/${campaignId}/enemies`)).body.enemies as any[]

  beforeAll(async () => {
    dm = await registerUser('endm')
    campaignId = await createCampaign(dm, 'Nepřátelé')
    bob = await joinAsPlayer(dm, campaignId, 'bob')
    eve = await registerUser('eve')
    bobChar = (await bob.client.post(`/campaigns/${campaignId}/characters`, body('Bob'))).body.character.id
  })

  it('DM založí nepřítele s HP, AC a útoky', async () => {
    const res = await dm.client.post(`/campaigns/${campaignId}/enemies`, {
      name: 'Goblin',
      hpMax: 7,
      ac: 15,
      attacks: [{ name: 'Scimitar', toHit: 4, damage: '1d6+2' }],
      notes: 'Utíká při 3 HP',
    })
    expectStatus(res, 201)
    expect(res.body.enemy).toMatchObject({ name: 'Goblin', hpMax: 7, hpCurrent: 7, ac: 15, attacks: [{ name: 'Scimitar', toHit: 4, damage: '1d6+2' }], notes: 'Utíká při 3 HP' })
  })

  it('hráč o nepřátelích nic nevidí a nemůže je měnit, cizinec 404, anonym 401', async () => {
    const id = (await enemies())[0].id
    for (const [method, url, payload] of [
      ['GET', `/campaigns/${campaignId}/enemies`, undefined],
      ['POST', `/campaigns/${campaignId}/enemies`, { name: 'X', hpMax: 1 }],
      ['PATCH', `/enemies/${id}`, { name: 'Y' }],
      ['POST', `/enemies/${id}/hp`, { delta: -1 }],
      ['POST', `/enemies/${id}/duplicate`, {}],
      ['DELETE', `/enemies/${id}`, undefined],
    ] as const) {
      const res = await bob.client.request(method, url, payload)
      expect(res.status, `${method} ${url}`).toBe(403)
      expect(JSON.stringify(res.body)).not.toContain('Goblin')
      expectStatus(await eve.client.request(method, url, payload), 404)
    }
    expect(await enemies()).toHaveLength(1)
    // nepřítel není postava: v seznamu postav ani jako příjemce předání není
    const list = (await bob.client.get(`/campaigns/${campaignId}/characters`)).body.characters
    expect(JSON.stringify(list)).not.toContain('Goblin')
    expectStatus(await bob.client.post(`/characters/${bobChar}/transfer`, { toCharacterId: id, currency: { gp: 1 } }), 422)
  })

  it('zranění a léčení se ořízne na 0 až maximum, přímá úprava aktuálního HP taky', async () => {
    const id = (await enemies())[0].id
    expect((await dm.client.post(`/enemies/${id}/hp`, { delta: -3 })).body.enemy.hpCurrent).toBe(4)
    expect((await dm.client.post(`/enemies/${id}/hp`, { delta: -100 })).body.enemy.hpCurrent).toBe(0)
    expect((await dm.client.post(`/enemies/${id}/hp`, { delta: 100 })).body.enemy.hpCurrent).toBe(7)
    expectStatus(await dm.client.post(`/enemies/${id}/hp`, { delta: 0 }), 422)
    expectStatus(await dm.client.post(`/enemies/${id}/hp`, { delta: 1.5 }), 422)
    const edited = await dm.client.patch(`/enemies/${id}`, { hpCurrent: 2, name: 'Goblin Šaman' })
    expect(edited.body.enemy).toMatchObject({ hpCurrent: 2, hpMax: 7, name: 'Goblin Šaman', ac: 15 })
    // snížení maxima stáhne i aktuální HP
    expect((await dm.client.patch(`/enemies/${id}`, { hpMax: 1, hpCurrent: 5 })).body.enemy).toMatchObject({ hpMax: 1, hpCurrent: 1 })
  })

  it('validace: jméno, HP, útoky (bonus a výraz zranění)', async () => {
    const post = (b: unknown) => dm.client.post(`/campaigns/${campaignId}/enemies`, b)
    expectStatus(await post({ hpMax: 5 }), 422)
    expectStatus(await post({ name: 'A', hpMax: 0 }), 422)
    expectStatus(await post({ name: 'A', hpMax: 5, ac: 99 }), 422)
    expectStatus(await post({ name: 'A', hpMax: 5, attacks: [{ name: 'Pěst', toHit: 99, damage: '1d4' }] }), 422)
    expectStatus(await post({ name: 'A', hpMax: 5, attacks: [{ name: 'Pěst', toHit: 1, damage: 'hodně' }] }), 422)
    expectStatus(await post({ name: 'A', hpMax: 5, attacks: Array.from({ length: 13 }, () => ({ name: 'x', toHit: 0, damage: '1d4' })) }), 422)
    expectStatus(await post({ name: 'A', hpMax: 5, attacks: [{ name: 'Bez zranění', toHit: 2 }] }), 201)
  })

  it('duplikát: plné zdraví a očíslované jméno', async () => {
    const created = (await dm.client.post(`/campaigns/${campaignId}/enemies`, { name: 'Vlk', hpMax: 11, attacks: [{ name: 'Kousnutí', toHit: 4, damage: '2d4+2' }] })).body.enemy
    await dm.client.post(`/enemies/${created.id}/hp`, { delta: -8 })
    const copy1 = await dm.client.post(`/enemies/${created.id}/duplicate`, {})
    expectStatus(copy1, 201)
    expect(copy1.body.enemy).toMatchObject({ name: 'Vlk 2', hpMax: 11, hpCurrent: 11, attacks: [{ name: 'Kousnutí' }] })
    expect((await dm.client.post(`/enemies/${copy1.body.enemy.id}/duplicate`, {})).body.enemy.name).toBe('Vlk 3')
  })

  it('smazání nepřítele a zmizení spolu s kampaní', async () => {
    const id = (await dm.client.post(`/campaigns/${campaignId}/enemies`, { name: 'Na smazání', hpMax: 3 })).body.enemy.id
    expectStatus(await dm.client.delete(`/enemies/${id}`), 204)
    expect((await enemies()).map((e) => e.id)).not.toContain(id)
    const tmp = await createCampaign(dm, 'K smazání')
    await dm.client.post(`/campaigns/${tmp}/enemies`, { name: 'Zmizí', hpMax: 3 })
    expectStatus(await dm.client.delete(`/campaigns/${tmp}`), 204)
  })
})
