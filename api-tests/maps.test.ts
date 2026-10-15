import { beforeAll, describe, expect, it } from 'vitest'
import { Client, createCampaign, expectStatus, joinAsPlayer, jpegSize, makePng, registerUser, type TestUser } from './client'

describe('mapy a body na mapě', () => {
  let dm: TestUser
  let bob: TestUser
  let carol: TestUser
  let eve: TestUser
  let campaignId: string
  let mapId: string
  let hiddenMapId: string

  const upload = (user: TestUser, name: string, w = 400, h = 300, cid: string = campaignId) =>
    user.client.upload(`/campaigns/${cid}/maps`, 'image', makePng(w, h), 'mapa.png', 'image/png', { name })
  const pins = async (user: TestUser, id: string = mapId) => {
    const res = await user.client.get(`/maps/${id}/pins`)
    expectStatus(res, 200)
    return res.body.pins as any[]
  }
  const titles = async (user: TestUser) => (await pins(user)).map((p) => p.title)
  const pin = (user: TestUser, body: Record<string, unknown>, id: string = mapId) => user.client.post(`/maps/${id}/pins`, { x: 100, y: 100, title: 'Bod', ...body })

  beforeAll(async () => {
    dm = await registerUser('dm')
    campaignId = await createCampaign(dm, 'Mapy')
    bob = await joinAsPlayer(dm, campaignId, 'bob')
    carol = await joinAsPlayer(dm, campaignId, 'carol')
    eve = await registerUser('eve')
    const created = await upload(dm, 'Vesnice')
    expectStatus(created, 201)
    mapId = created.body.map.id
    expectStatus(await dm.client.patch(`/maps/${mapId}`, { visible: true }), 200)
    const hidden = await upload(dm, 'Tajná jeskyně')
    hiddenMapId = hidden.body.map.id
  })

  describe('mapy', () => {
    it('DM nahraje mapu, obrázek se přegeneruje na JPEG a zachová poměr stran', async () => {
      const big = await upload(dm, 'Velká', 6000, 3000)
      expectStatus(big, 201)
      expect(big.body.map).toMatchObject({ name: 'Velká', width: 4096, height: 2048, visible: false })
      const img = await dm.client.raw(`/maps/${big.body.map.id}/image`)
      expect(img.status).toBe(200)
      expect(img.headers.get('content-type')).toBe('image/jpeg')
      expect(jpegSize(img.bytes)).toEqual({ width: 4096, height: 2048 })
      await dm.client.delete(`/maps/${big.body.map.id}`)
    })

    it('hráč nemůže mapu nahrát, přejmenovat, zveřejnit ani smazat; cizinec ani neví, že existuje', async () => {
      expectStatus(await upload(bob, 'Hráčova'), 403)
      expectStatus(await bob.client.patch(`/maps/${mapId}`, { name: 'Změna' }), 403)
      expectStatus(await bob.client.patch(`/maps/${mapId}`, { visible: false }), 403)
      expectStatus(await bob.client.delete(`/maps/${mapId}`), 403)
      expectStatus(await upload(eve, 'Cizí'), 404)
      expectStatus(await eve.client.patch(`/maps/${mapId}`, { name: 'x' }), 404)
      expectStatus(await eve.client.delete(`/maps/${mapId}`), 404)
      expect((await dm.client.get(`/campaigns/${campaignId}/maps`)).body.maps.map((m: any) => m.name)).toContain('Vesnice')
    })

    it('hráč vidí jen zveřejněné mapy a skrytá je pro něj 404 (seznam, obrázek i body)', async () => {
      const names = async (u: TestUser) => (await u.client.get(`/campaigns/${campaignId}/maps`)).body.maps.map((m: any) => m.name)
      expect(await names(bob)).toEqual(['Vesnice'])
      expect(await names(dm)).toEqual(expect.arrayContaining(['Vesnice', 'Tajná jeskyně']))
      expect((await bob.client.raw(`/maps/${hiddenMapId}/image`)).status).toBe(404)
      expectStatus(await bob.client.get(`/maps/${hiddenMapId}/pins`), 404)
      expectStatus(await pin(bob, {}, hiddenMapId), 404)
      expect((await dm.client.raw(`/maps/${hiddenMapId}/image`)).status).toBe(200)
      // po zveřejnění ji hráč uvidí, po skrytí zase ne
      await dm.client.patch(`/maps/${hiddenMapId}`, { visible: true })
      expect((await bob.client.raw(`/maps/${hiddenMapId}/image`)).status).toBe(200)
      await dm.client.patch(`/maps/${hiddenMapId}`, { visible: false })
      expect((await bob.client.raw(`/maps/${hiddenMapId}/image`)).status).toBe(404)
    })

    it('obrázek: cizinec a anonym ne, člen ano a s ETag (304)', async () => {
      expect((await eve.client.raw(`/maps/${mapId}/image`)).status).toBe(404)
      expect((await new Client().raw(`/maps/${mapId}/image`)).status).toBe(401)
      const first = await bob.client.raw(`/maps/${mapId}/image`)
      expect(first.status).toBe(200)
      const etag = first.headers.get('etag')!
      expect((await bob.client.raw(`/maps/${mapId}/image`, { 'If-None-Match': etag })).status).toBe(304)
    })

    it('špatné nahrání: bez názvu, bez souboru, ne-obrázek, příliš velké rozlišení', async () => {
      expectStatus(await upload(dm, ''), 422)
      expectStatus(await dm.client.upload(`/campaigns/${campaignId}/maps`, 'image', new TextEncoder().encode('<?php echo 1; ?>'), 'mapa.php', 'image/png', { name: 'PHP' }), 422)
      expectStatus(await dm.client.upload(`/campaigns/${campaignId}/maps`, 'other', makePng(10, 10), 'a.png', 'image/png', { name: 'Špatné pole' }), 422)
      expectStatus(await dm.client.post(`/campaigns/${campaignId}/maps`, { name: 'JSON' }), 422)
    })

    it('smazání mapy odstraní i body a obrázek', async () => {
      const m = (await upload(dm, 'K smazání')).body.map.id
      await dm.client.patch(`/maps/${m}`, { visible: true })
      await pin(dm, {}, m)
      expectStatus(await dm.client.delete(`/maps/${m}`), 204)
      expect((await dm.client.raw(`/maps/${m}/image`)).status).toBe(404)
      expectStatus(await dm.client.get(`/maps/${m}/pins`), 404)
    })
  })

  describe('viditelnost bodů', () => {
    it('bod pro všechny vidí všichni členové, cizinec ne', async () => {
      expectStatus(await pin(dm, { title: 'Hospoda', visibility: 'all', icon: 'town' }), 201)
      for (const u of [dm, bob, carol]) expect(await titles(u)).toContain('Hospoda')
      expectStatus(await eve.client.get(`/maps/${mapId}/pins`), 404)
      expect((await new Client().get(`/maps/${mapId}/pins`)).status).toBe(401)
    })

    it('bod jen pro DM hráči nevidí, vybraným hráčům jen ti vybraní', async () => {
      const secret = await pin(dm, { title: 'Past', visibility: 'dm' })
      expectStatus(secret, 201)
      const picked = await pin(dm, { title: 'Jen pro Boba', visibility: 'selected', viewerIds: [bob.id] })
      expectStatus(picked, 201)
      expect(picked.body.pin.viewerIds).toEqual([bob.id])
      expect(await titles(dm)).toEqual(expect.arrayContaining(['Past', 'Jen pro Boba']))
      expect(await titles(bob)).toContain('Jen pro Boba')
      expect(await titles(bob)).not.toContain('Past')
      expect(await titles(carol)).not.toContain('Jen pro Boba')
      expect(await titles(carol)).not.toContain('Past')
      // hráč nedostane ani seznam, komu je bod určen
      expect((await pins(bob)).find((p) => p.title === 'Jen pro Boba').viewerIds).toBeUndefined()
      // a cizí bod nejde ani upravit ani smazat (404, ne 403, ať neprozradí existenci)
      expectStatus(await carol.client.patch(`/pins/${secret.body.pin.id}`, { title: 'x' }), 404)
      expectStatus(await carol.client.delete(`/pins/${secret.body.pin.id}`), 404)
      expectStatus(await carol.client.delete(`/pins/${picked.body.pin.id}`), 404)
    })

    it('soukromá poznámka hráče: vidí ji jen on, ani DM ne', async () => {
      const note = await pin(bob, { title: 'Bobova poznámka', description: 'tajná úvaha' })
      expectStatus(note, 201)
      expect(note.body.pin).toMatchObject({ visibility: 'owner', mine: true, canEdit: true })
      expect(await titles(bob)).toContain('Bobova poznámka')
      expect(await titles(dm)).not.toContain('Bobova poznámka')
      expect(await titles(carol)).not.toContain('Bobova poznámka')
      expectStatus(await dm.client.patch(`/pins/${note.body.pin.id}`, { title: 'DM mění' }), 404)
      expectStatus(await dm.client.delete(`/pins/${note.body.pin.id}`), 404)
      expectStatus(await carol.client.delete(`/pins/${note.body.pin.id}`), 404)
      // autor ji upraví a smaže
      const edit = await bob.client.patch(`/pins/${note.body.pin.id}`, { title: 'Upraveno', x: 50, y: 60 })
      expectStatus(edit, 200)
      expect(edit.body.pin).toMatchObject({ title: 'Upraveno', x: 50, y: 60 })
      expectStatus(await bob.client.delete(`/pins/${note.body.pin.id}`), 204)
      expect(await titles(bob)).not.toContain('Upraveno')
    })

    it('hráč nezveřejní poznámku ani nevytvoří bod pro všechny či vybrané', async () => {
      for (const visibility of ['all', 'selected', 'dm']) expectStatus(await pin(bob, { title: 'Pokus', visibility, viewerIds: [carol.id] }), 403)
      const note = await pin(bob, { title: 'Moje' })
      expectStatus(await bob.client.patch(`/pins/${note.body.pin.id}`, { visibility: 'all' }), 403)
      expect(await titles(carol)).not.toContain('Pokus')
      expect(await titles(carol)).not.toContain('Moje')
    })

    it('hráč nemůže měnit ani mazat bod DM, který vidí (403)', async () => {
      const shared = (await pin(dm, { title: 'Společný bod', visibility: 'all' })).body.pin
      expectStatus(await bob.client.patch(`/pins/${shared.id}`, { title: 'Hacknuto' }), 403)
      expectStatus(await bob.client.delete(`/pins/${shared.id}`), 403)
      expect(await titles(carol)).toContain('Společný bod')
    })

    it('DM bod přesune, změní viditelnost a vybrané hráče', async () => {
      const p = (await pin(dm, { title: 'Pohyblivý', visibility: 'dm' })).body.pin
      expect(await titles(bob)).not.toContain('Pohyblivý')
      const toBob = await dm.client.patch(`/pins/${p.id}`, { x: 10, y: 20, visibility: 'selected', viewerIds: [bob.id] })
      expect(toBob.body.pin).toMatchObject({ x: 10, y: 20, visibility: 'selected', viewerIds: [bob.id] })
      expect(await titles(bob)).toContain('Pohyblivý')
      expect(await titles(carol)).not.toContain('Pohyblivý')
      await dm.client.patch(`/pins/${p.id}`, { viewerIds: [carol.id] })
      expect(await titles(bob)).not.toContain('Pohyblivý')
      expect(await titles(carol)).toContain('Pohyblivý')
      await dm.client.patch(`/pins/${p.id}`, { visibility: 'all' })
      expect(await titles(bob)).toContain('Pohyblivý')
      expectStatus(await dm.client.delete(`/pins/${p.id}`), 204)
    })
  })

  describe('validace bodů', () => {
    it('souřadnice mimo mapu, prázdný název, neznámá ikona a špatní příjemci se odmítnou', async () => {
      expectStatus(await pin(dm, { x: -1 }), 422)
      expectStatus(await pin(dm, { x: 401 }), 422) // mapa je 400 px široká
      expectStatus(await pin(dm, { y: 301 }), 422)
      expectStatus(await pin(dm, { x: 'vlevo' }), 422)
      expectStatus(await pin(dm, { title: '' }), 422)
      expectStatus(await pin(dm, { title: 'x'.repeat(101) }), 422)
      expectStatus(await pin(dm, { description: 'x'.repeat(2001) }), 422)
      expectStatus(await pin(dm, { icon: 'hacker' }), 422)
      expectStatus(await pin(dm, { visibility: 'tajne' }), 422)
      expectStatus(await pin(dm, { visibility: 'selected' }), 422)
      expectStatus(await pin(dm, { visibility: 'selected', viewerIds: [] }), 422)
      expectStatus(await pin(dm, { visibility: 'selected', viewerIds: [eve.id] }), 422) // cizinec
      expectStatus(await pin(dm, { visibility: 'selected', viewerIds: [dm.id] }), 422) // DM není hráč
      expectStatus(await pin(dm, { visibility: 'owner' }), 422)
      expectStatus(await pin(dm, { x: 0, y: 0 }), 201)
      expectStatus(await pin(dm, { x: 400, y: 300 }), 201)
    })

    it('popis se vrací jako text beze změny (žádné HTML)', async () => {
      const res = await pin(dm, { title: '<b>Tučně</b>', description: '<img src=x onerror=alert(1)>' })
      expect(res.body.pin).toMatchObject({ title: '<b>Tučně</b>', description: '<img src=x onerror=alert(1)>' })
    })
  })

  it('smazání kampaně smaže i mapy a jejich obrázky', async () => {
    const c = await createCampaign(dm, 'K smazání')
    const m = (await upload(dm, 'Mapa', 100, 100, c)).body.map.id
    expect((await dm.client.raw(`/maps/${m}/image`)).status).toBe(200)
    expectStatus(await dm.client.delete(`/campaigns/${c}`), 204)
    expect((await dm.client.raw(`/maps/${m}/image`)).status).toBe(404)
  })
})
