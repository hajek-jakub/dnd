import { beforeAll, describe, expect, it } from 'vitest'
import { createCampaign, expectStatus, joinAsPlayer, makePng, registerUser, type TestUser } from './client'

describe('zápisy deníku na bodech mapy (místo ↔ zápisy)', () => {
  let dm: TestUser
  let bob: TestUser
  let ann: TestUser
  let eve: TestUser
  let campaignId: string
  let mapId: string
  let hiddenMapId: string
  let legend: string
  let secret: string
  let foreignEntry: string

  const upload = (user: TestUser, name: string) => user.client.upload(`/campaigns/${campaignId}/maps`, 'image', makePng(400, 300), 'mapa.png', 'image/png', { name })
  const entry = async (user: TestUser, body: Record<string, unknown>, cid = campaignId) => {
    const res = await user.client.post(`/campaigns/${cid}/journal`, { topic: 'Příběh', ...body })
    expectStatus(res, 201)
    return res.body.entry as { id: string; places: { pinId: string; title: string; mapName: string }[] }
  }
  const pin = (user: TestUser, body: Record<string, unknown>, id = mapId) => user.client.post(`/maps/${id}/pins`, { x: 100, y: 100, title: 'Bod', ...body })
  const pinsOf = async (user: TestUser, id = mapId) => {
    const res = await user.client.get(`/maps/${id}/pins`)
    expectStatus(res, 200)
    return res.body.pins as { id: string; title: string; entryIds: string[] }[]
  }
  const entriesOf = async (user: TestUser) => {
    const res = await user.client.get(`/campaigns/${campaignId}/journal`)
    expectStatus(res, 200)
    return res.body.entries as { id: string; title: string; places: { pinId: string; title: string; mapName: string }[] }[]
  }
  const placesOf = async (user: TestUser, entryId: string) => (await entriesOf(user)).find((e) => e.id === entryId)?.places.map((p) => `${p.mapName}: ${p.title}`)

  beforeAll(async () => {
    dm = await registerUser('mapentdm')
    campaignId = await createCampaign(dm, 'Místa a zápisy')
    bob = await joinAsPlayer(dm, campaignId, 'mapentbob')
    ann = await joinAsPlayer(dm, campaignId, 'mapentann')
    eve = await registerUser('mapenteve')
    const map = await upload(dm, 'Poušť')
    expectStatus(map, 201)
    mapId = map.body.map.id
    expectStatus(await dm.client.patch(`/maps/${mapId}`, { visible: true }), 200)
    hiddenMapId = (await upload(dm, 'Tajná mapa')).body.map.id
    legend = (await entry(bob, { title: 'Legenda o Kupice', body: '# Kupika' })).id
    secret = (await entry(dm, { title: 'Tajemství DM', visibility: 'dm' })).id
    const other = await createCampaign(eve, 'Cizí')
    foreignEntry = (await entry(eve, { title: 'Cizí zápis' }, other)).id
  })

  it('bod nese zápisy; hráč u bodu skrytý zápis nevidí a zápis ukáže místo jen tam, kde bod vidí', async () => {
    const city = await pin(dm, { title: 'Kupika', entryIds: [legend, secret] })
    expectStatus(city, 201)
    expect(city.body.pin.entryIds.sort()).toEqual([legend, secret].sort())
    expect((await pinsOf(bob)).find((p) => p.title === 'Kupika')?.entryIds).toEqual([legend])

    expectStatus(await pin(dm, { title: 'Tajný vchod', visibility: 'dm', entryIds: [legend] }), 201)
    expectStatus(await pin(dm, { title: 'Jeskyně', entryIds: [legend] }, hiddenMapId), 201)

    expect(await placesOf(bob, legend)).toEqual(['Poušť: Kupika'])
    expect((await placesOf(dm, legend))?.sort()).toEqual(['Poušť: Kupika', 'Poušť: Tajný vchod', 'Tajná mapa: Jeskyně'])
    expect((await entriesOf(bob)).some((e) => e.id === secret)).toBe(false)
  })

  it('hráč přiřadí jen zápis, který vidí, z téže kampaně; jinak 422 a nic nevznikne', async () => {
    for (const ids of [[secret], [foreignEntry], ['not-a-uuid'], 'x']) {
      const res = await pin(bob, { title: 'Pokus', entryIds: ids })
      expectStatus(res, 422)
      expect(res.body.error.field).toBe('entryIds')
    }
    expect((await pinsOf(dm)).some((p) => p.title === 'Pokus')).toBe(false)
  })

  it('úprava bodu hráčem nesmaže propojení se zápisem, který nevidí', async () => {
    const note = await pin(bob, { title: 'Oáza', entryIds: [legend] })
    expectStatus(note, 201)
    const id = note.body.pin.id as string
    expectStatus(await dm.client.patch(`/pins/${id}`, { entryIds: [legend, secret] }), 200)
    const res = await bob.client.patch(`/pins/${id}`, { entryIds: [] })
    expectStatus(res, 200)
    expect(res.body.pin.entryIds).toEqual([])
    expect((await pinsOf(dm)).find((p) => p.id === id)?.entryIds).toEqual([secret])
  })

  it('místo jde nastavit i u zápisu; cizí hráč bez práv na zápis ho nezmění', async () => {
    const city = (await pinsOf(bob)).find((p) => p.title === 'Kupika')!
    const created = await entry(ann, { title: 'Pád Kupiky', pinIds: [city.id] })
    expect(created.places.map((p) => p.title)).toEqual(['Kupika'])
    expect((await pinsOf(bob)).find((p) => p.id === city.id)?.entryIds).toContain(created.id)

    expectStatus(await bob.client.patch(`/journal/${created.id}`, { pinIds: [] }), 403)
    const hiddenPin = (await pinsOf(dm)).find((p) => p.title === 'Tajný vchod')!
    const bad = await ann.client.patch(`/journal/${created.id}`, { pinIds: [hiddenPin.id] })
    expectStatus(bad, 422)
    expect(bad.body.error.field).toBe('pinIds')
  })

  it('úprava zápisu hráčem nesmaže body, které nevidí; smazání zápisu propojení uklidí', async () => {
    const hiddenPin = (await pinsOf(dm)).find((p) => p.title === 'Tajný vchod')!
    expect(hiddenPin.entryIds).toContain(legend)
    const res = await bob.client.patch(`/journal/${legend}`, { pinIds: [] })
    expectStatus(res, 200)
    expect(res.body.entry.places).toEqual([])
    expect((await placesOf(dm, legend))?.sort()).toEqual(['Poušť: Tajný vchod', 'Tajná mapa: Jeskyně'])

    expectStatus(await bob.client.delete(`/journal/${legend}`), 204)
    expect((await pinsOf(dm)).find((p) => p.id === hiddenPin.id)?.entryIds).toEqual([])
  })

  it('cizinec bod ani mapu neuvidí (404)', async () => {
    const city = (await pinsOf(dm)).find((p) => p.title === 'Kupika')!
    expectStatus(await eve.client.patch(`/pins/${city.id}`, { entryIds: [foreignEntry] }), 404)
    expectStatus(await eve.client.get(`/maps/${mapId}/pins`), 404)
  })
})
