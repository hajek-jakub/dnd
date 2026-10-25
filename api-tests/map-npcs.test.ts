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
