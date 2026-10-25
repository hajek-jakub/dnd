import { beforeAll, describe, expect, it } from 'vitest'
import { createCampaign, expectStatus, joinAsPlayer, makePng, registerUser, type TestUser } from './client'

describe('NPC na bodech mapy (místo ↔ postavy)', () => {
  let dm: TestUser
  let bob: TestUser
  let eve: TestUser
  let campaignId: string
  let mapId: string
  let hiddenMapId: string
  let innkeeper: string
  let traitor: string
  let foreignNpc: string

  const upload = (user: TestUser, name: string, cid = campaignId) => user.client.upload(`/campaigns/${cid}/maps`, 'image', makePng(400, 300), 'mapa.png', 'image/png', { name })
  const npc = async (user: TestUser, body: Record<string, unknown>, cid = campaignId) => {
    const res = await user.client.post(`/campaigns/${cid}/journal/npcs`, body)
    expectStatus(res, 201)
    return res.body.npc.id as string
  }
  const pin = (user: TestUser, body: Record<string, unknown>, id = mapId) => user.client.post(`/maps/${id}/pins`, { x: 100, y: 100, title: 'Bod', ...body })
  const pinsOf = async (user: TestUser, id = mapId) => {
    const res = await user.client.get(`/maps/${id}/pins`)
    expectStatus(res, 200)
    return res.body.pins as { id: string; title: string; npcIds: string[] }[]
  }
  const npcsOf = async (user: TestUser) => {
    const res = await user.client.get(`/campaigns/${campaignId}/journal/npcs`)
    expectStatus(res, 200)
    return res.body.npcs as { id: string; name: string; places: { pinId: string; mapId: string; mapName: string; title: string; icon: string }[] }[]
  }
  const placesOf = async (user: TestUser, npcId: string) => (await npcsOf(user)).find((n) => n.id === npcId)?.places.map((p) => `${p.mapName}: ${p.title}`)

  beforeAll(async () => {
    dm = await registerUser('mapnpcdm')
    campaignId = await createCampaign(dm, 'Místa a postavy')
    bob = await joinAsPlayer(dm, campaignId, 'mapnpcbob')
    eve = await registerUser('mapnpceve')
    const map = await upload(dm, 'Vesnice')
    expectStatus(map, 201)
    mapId = map.body.map.id
    expectStatus(await dm.client.patch(`/maps/${mapId}`, { visible: true }), 200)
    hiddenMapId = (await upload(dm, 'Tajná jeskyně')).body.map.id
    innkeeper = await npc(dm, { name: 'Hostinský', race: 'Human', description: 'Ví všechno.' })
    traitor = await npc(dm, { name: 'Zrádce', visibility: 'dm' })
    const other = await createCampaign(eve, 'Cizí')
    foreignNpc = await npc(eve, { name: 'Cizinec' }, other)
  })

  it('DM přiřadí bodu NPC; hráč u bodu skryté NPC nevidí a NPC ukáže místo jen tam, kde bod vidí', async () => {
    const tavern = await pin(dm, { title: 'Hospoda', npcIds: [innkeeper, traitor] })
    expectStatus(tavern, 201)
    expect(tavern.body.pin.npcIds.sort()).toEqual([innkeeper, traitor].sort())
    expect((await pinsOf(bob)).find((p) => p.title === 'Hospoda')?.npcIds).toEqual([innkeeper])

    expectStatus(await pin(dm, { title: 'Tajný sklep', visibility: 'dm', npcIds: [innkeeper] }), 201)
    expectStatus(await pin(dm, { title: 'Doupě', npcIds: [innkeeper] }, hiddenMapId), 201)

    expect(await placesOf(bob, innkeeper)).toEqual(['Vesnice: Hospoda'])
    expect(await placesOf(dm, innkeeper)).toEqual(['Tajná jeskyně: Doupě', 'Vesnice: Hospoda', 'Vesnice: Tajný sklep'])
    expect(await placesOf(dm, traitor)).toEqual(['Vesnice: Hospoda'])
    expect((await npcsOf(bob)).some((n) => n.id === traitor)).toBe(false)
  })

  it('hráč přiřadí ke svému bodu viditelné NPC, ale ne skryté ani z cizí kampaně (422); cizinec se k mapě nedostane (404)', async () => {
    const mine = await pin(bob, { title: 'Tržiště', npcIds: [innkeeper] })
    expectStatus(mine, 201)
    expect(mine.body.pin.npcIds).toEqual([innkeeper])
    expectStatus(await pin(bob, { title: 'Past', npcIds: [traitor] }), 422)
    expectStatus(await pin(bob, { title: 'Past', npcIds: [foreignNpc] }), 422)
    expectStatus(await pin(dm, { title: 'Past', npcIds: ['nope'] }), 422)
    expectStatus(await pin(eve, { title: 'Past', npcIds: [foreignNpc] }), 404)
    expectStatus(await eve.client.patch(`/pins/${mine.body.pin.id}`, { npcIds: [] }), 404)
    // cizí bod hráč nezmění
    const dmPin = (await pinsOf(bob)).find((p) => p.title === 'Hospoda')!
    expectStatus(await bob.client.patch(`/pins/${dmPin.id}`, { npcIds: [] }), 403)
  })

  it('hráč při úpravě svého bodu nesmaže skryté NPC, které k němu přidal DM', async () => {
    const created = await pin(bob, { title: 'Studna', npcIds: [innkeeper] })
    const id = created.body.pin.id as string
    expectStatus(await dm.client.patch(`/pins/${id}`, { npcIds: [innkeeper, traitor] }), 200)
    const cleared = await bob.client.patch(`/pins/${id}`, { npcIds: [] })
    expectStatus(cleared, 200)
    expect(cleared.body.pin.npcIds).toEqual([])
    expect((await pinsOf(dm)).find((p) => p.id === id)?.npcIds).toEqual([traitor])
    // úprava bez npcIds propojení nemění
    expectStatus(await dm.client.patch(`/pins/${id}`, { title: 'Stará studna' }), 200)
    expect((await pinsOf(dm)).find((p) => p.id === id)?.npcIds).toEqual([traitor])
  })

  it('místo jde nastavit i u NPC (pinIds): jen body, které uživatel vidí; skryté body DM hráč nezmění', async () => {
    const all = async (u: TestUser) => {
      const res = await u.client.get(`/campaigns/${campaignId}/pins`)
      expectStatus(res, 200)
      return res.body.pins as { pinId: string; title: string; mapName: string }[]
    }
    const dmPins = await all(dm)
    const bobPins = await all(bob)
    const id = (list: typeof dmPins, title: string) => list.find((p) => p.title === title)!.pinId
    expect(bobPins.map((p) => p.title)).toContain('Hospoda')
    expect(bobPins.map((p) => p.title)).not.toContain('Tajný sklep') // bod jen pro DM
    expect(bobPins.map((p) => p.title)).not.toContain('Doupě') // skrytá mapa
    expect(dmPins.map((p) => p.title)).toEqual(expect.arrayContaining(['Hospoda', 'Tajný sklep', 'Doupě']))
    expectStatus(await eve.client.get(`/campaigns/${campaignId}/pins`), 404)

    // nové NPC rovnou s místem; bod, který hráč nevidí, nejde (nic se nezaloží)
    expectStatus(await bob.client.post(`/campaigns/${campaignId}/journal/npcs`, { name: 'Špeh', pinIds: [id(dmPins, 'Tajný sklep')] }), 422)
    expect((await npcsOf(dm)).some((n) => n.name === 'Špeh')).toBe(false)
    const created = await bob.client.post(`/campaigns/${campaignId}/journal/npcs`, { name: 'Pekař', pinIds: [id(bobPins, 'Hospoda')] })
    expectStatus(created, 201)
    expect(created.body.npc.places.map((p: any) => p.title)).toEqual(['Hospoda'])
    const smith = (await bob.client.post(`/campaigns/${campaignId}/journal/npcs`, { name: 'Kovář' })).body.npc.id as string
    // hráč nepřiřadí bod, který nevidí
    expectStatus(await bob.client.patch(`/journal-npcs/${smith}`, { pinIds: [id(dmPins, 'Tajný sklep')] }), 422)
    expectStatus(await bob.client.patch(`/journal-npcs/${smith}`, { pinIds: ['x'] }), 422)
    const set = await bob.client.patch(`/journal-npcs/${smith}`, { pinIds: [id(bobPins, 'Hospoda')] })
    expectStatus(set, 200)
    expect(set.body.npc.places.map((p: any) => p.title)).toEqual(['Hospoda'])
    expect((await pinsOf(dm)).find((p) => p.title === 'Hospoda')?.npcIds).toContain(smith)

    // DM přidá skrytý bod; hráč při úpravě míst ho neodebere
    expectStatus(await dm.client.patch(`/journal-npcs/${smith}`, { pinIds: [id(dmPins, 'Hospoda'), id(dmPins, 'Tajný sklep')] }), 200)
    expect(await placesOf(bob, smith)).toEqual(['Vesnice: Hospoda'])
    expectStatus(await bob.client.patch(`/journal-npcs/${smith}`, { pinIds: [] }), 200)
    expect(await placesOf(bob, smith)).toEqual([])
    expect(await placesOf(dm, smith)).toEqual(['Vesnice: Tajný sklep'])
    // cizí NPC hráč nemění
    expectStatus(await bob.client.patch(`/journal-npcs/${innkeeper}`, { pinIds: [] }), 403)
  })

  it('postavy hráčů jsou v přehledu NPC samy a smazat je nejde', async () => {
    const scores = { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }
    const hero = (await bob.client.post(`/campaigns/${campaignId}/characters`, { name: 'Bobův hrdina', race: 'Elf', abilityScores: scores, levels: [{ classIndex: 'fighter' }] })).body.character.id as string
    const entry = (await npcsOf(dm)).find((n: any) => n.characterId === hero) as any
    expect(entry).toMatchObject({ name: 'Bobův hrdina', race: 'Elf', characterKind: 'pc' })
    // jen jednou, i po dalším načtení
    expect((await npcsOf(bob)).filter((n: any) => n.characterId === hero)).toHaveLength(1)
    // hráč je autor, popis smí upravit
    expectStatus(await bob.client.patch(`/journal-npcs/${entry.id}`, { description: 'Hledá bratra.' }), 200)
    expectStatus(await dm.client.delete(`/journal-npcs/${entry.id}`), 422)
  })

  it('smazání NPC ho z bodů odebere, smazání bodu odebere místo u NPC', async () => {
    const guard = await npc(dm, { name: 'Strážný' })
    const gate = await pin(dm, { title: 'Brána', npcIds: [guard, innkeeper] })
    expect(await placesOf(bob, guard)).toEqual(['Vesnice: Brána'])
    expectStatus(await dm.client.delete(`/journal-npcs/${guard}`), 204)
    expect((await pinsOf(dm)).find((p) => p.id === gate.body.pin.id)?.npcIds).toEqual([innkeeper])
    expectStatus(await dm.client.delete(`/pins/${gate.body.pin.id}`), 204)
    expect(await placesOf(dm, innkeeper)).not.toContain('Vesnice: Brána')
  })
})
