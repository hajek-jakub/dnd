import { beforeAll, describe, expect, it } from 'vitest'
import { Client, createCampaign, expectStatus, joinAsPlayer, registerUser, testDbExec, type TestUser } from './client'

describe('deník kampaně', () => {
  let dm: TestUser
  let bob: TestUser
  let carol: TestUser
  let eve: TestUser
  let campaignId: string

  const create = (user: TestUser, body: Record<string, unknown>, cid: string = campaignId) => user.client.post(`/campaigns/${cid}/journal`, { topic: 'Příběh', title: 'Zápis', body: 'Text', ...body })
  const list = async (user: TestUser, cid: string = campaignId) => {
    const res = await user.client.get(`/campaigns/${cid}/journal`)
    expectStatus(res, 200)
    return res.body as { entries: any[]; unread: number }
  }
  const titles = async (user: TestUser) => (await list(user)).entries.map((e) => e.title)
  const overview = async (user: TestUser) => (await user.client.get('/journal/unread')).body as { total: number; campaigns: { campaignId: string; unread: number }[] }

  beforeAll(async () => {
    dm = await registerUser('dm')
    campaignId = await createCampaign(dm, 'Deník')
    bob = await joinAsPlayer(dm, campaignId, 'bob')
    carol = await joinAsPlayer(dm, campaignId, 'carol')
    eve = await registerUser('eve')
  })

  describe('oprávnění', () => {
    it('anonym 401, cizinec 404', async () => {
      const anon = new Client()
      expect((await anon.get(`/campaigns/${campaignId}/journal`)).status).toBe(401)
      expect((await anon.post(`/campaigns/${campaignId}/journal`, { title: 'x' })).status).toBe(401)
      expect((await anon.get('/journal/unread')).status).toBe(401)
      expectStatus(await eve.client.get(`/campaigns/${campaignId}/journal`), 404)
      expectStatus(await create(eve, {}), 404)
      expectStatus(await eve.client.post(`/campaigns/${campaignId}/journal/read`, {}), 404)
    })

    it('zápisy jedné kampaně se neukážou v jiné', async () => {
      expectStatus(await create(dm, { title: 'Jen v první' }), 201)
      const other = await createCampaign(dm, 'Jiná')
      expect((await list(dm, other)).entries).toEqual([])
    })
  })

  describe('viditelnost zápisů', () => {
    it('zápis pro všechny vidí všichni členové, DM ho může připnout a připnuté je nahoře', async () => {
      const a = await create(dm, { title: 'Obyčejný' })
      const b = await create(dm, { title: 'Důležitý', pinned: true })
      expectStatus(a, 201)
      expect(b.body.entry).toMatchObject({ pinned: true, visibility: 'all', topic: 'Příběh', mine: true, canEdit: true, isNew: false })
      for (const u of [dm, bob, carol]) expect(await titles(u)).toEqual(expect.arrayContaining(['Obyčejný', 'Důležitý']))
      expect((await list(bob)).entries[0].title).toBe('Důležitý')
      expect((await list(bob)).entries[0]).toMatchObject({ mine: false, canEdit: false, createdByName: expect.any(String) })
    })

    it('zápis jen pro DM hráči nevidí, vybraným hráčům jen ti vybraní', async () => {
      const secret = (await create(dm, { title: 'DM přehled', visibility: 'dm' })).body.entry
      const picked = (await create(dm, { title: 'Jen pro Boba', visibility: 'selected', viewerIds: [bob.id] })).body.entry
      expect(picked.viewerIds).toEqual([bob.id])
      expect(await titles(dm)).toEqual(expect.arrayContaining(['DM přehled', 'Jen pro Boba']))
      expect(await titles(bob)).toContain('Jen pro Boba')
      expect(await titles(bob)).not.toContain('DM přehled')
      expect(await titles(carol)).not.toContain('Jen pro Boba')
      expect((await list(bob)).entries.find((e) => e.title === 'Jen pro Boba').viewerIds).toBeUndefined()
      expectStatus(await carol.client.patch(`/journal/${secret.id}`, { title: 'x' }), 404)
      expectStatus(await carol.client.delete(`/journal/${secret.id}`), 404)
      expectStatus(await carol.client.delete(`/journal/${picked.id}`), 404)
    })

    it('hráč píše do společného deníku: zápis vidí celá družina včetně DM, autor ho upraví a smaže', async () => {
      const note = await create(bob, { title: 'Bobův zápis', body: 'viděl jsem kováře' })
      expectStatus(note, 201)
      expect(note.body.entry).toMatchObject({ visibility: 'all', mine: true, canEdit: true, isNew: false })
      for (const u of [bob, carol, dm]) expect(await titles(u)).toContain('Bobův zápis')
      expect((await list(carol)).entries.find((e) => e.title === 'Bobův zápis')).toMatchObject({ mine: false, canEdit: false, createdByName: expect.any(String) })
      // cizí hráč zápis nemění, DM ano
      expectStatus(await carol.client.patch(`/journal/${note.body.entry.id}`, { title: 'Hacknuto' }), 403)
      expectStatus(await carol.client.delete(`/journal/${note.body.entry.id}`), 403)
      const edit = await bob.client.patch(`/journal/${note.body.entry.id}`, { title: 'Upraveno', body: 'nové' })
      expectStatus(edit, 200)
      expect(edit.body.entry).toMatchObject({ title: 'Upraveno', body: 'nové' })
      expectStatus(await dm.client.patch(`/journal/${note.body.entry.id}`, { topic: 'Postavy' }), 200)
      expectStatus(await bob.client.delete(`/journal/${note.body.entry.id}`), 204)
      expect(await titles(dm)).not.toContain('Upraveno')
    })

    it('starý soukromý zápisek hráče vidí jen jeho autor, ani DM ne, a autor ho smí zveřejnit', async () => {
      const note = (await create(bob, { title: 'Starý zápisek' })).body.entry
      testDbExec("UPDATE journal_entries SET visibility = 'owner' WHERE id = ?", [note.id])
      expect(await titles(bob)).toContain('Starý zápisek')
      expect(await titles(dm)).not.toContain('Starý zápisek')
      expect(await titles(carol)).not.toContain('Starý zápisek')
      expectStatus(await dm.client.patch(`/journal/${note.id}`, { title: 'DM mění' }), 404)
      expectStatus(await dm.client.delete(`/journal/${note.id}`), 404)
      expectStatus(await carol.client.patch(`/journal/${note.id}`, { title: 'x' }), 404)
      // zůstat soukromý jde, jiná omezená viditelnost ne
      expectStatus(await bob.client.patch(`/journal/${note.id}`, { visibility: 'owner', title: 'Pořád soukromý' }), 200)
      expectStatus(await bob.client.patch(`/journal/${note.id}`, { visibility: 'dm' }), 403)
      const shared = await bob.client.patch(`/journal/${note.id}`, { visibility: 'all' })
      expectStatus(shared, 200)
      expect(shared.body.entry.visibility).toBe('all')
      for (const u of [dm, carol]) expect(await titles(u)).toContain('Pořád soukromý')
      // zveřejněný zápis už soukromým nebude
      expectStatus(await bob.client.patch(`/journal/${note.id}`, { visibility: 'owner' }), 403)
    })

    it('hráč nezakládá soukromé ani omezené zápisy, nepřipíná a nemůže měnit zápis DM', async () => {
      for (const visibility of ['owner', 'selected', 'dm']) expectStatus(await create(bob, { visibility, viewerIds: [carol.id] }), 403)
      expectStatus(await create(bob, { pinned: true }), 403)
      const own = (await create(bob, { title: 'Moje' })).body.entry
      expectStatus(await bob.client.patch(`/journal/${own.id}`, { visibility: 'dm' }), 403)
      expectStatus(await bob.client.patch(`/journal/${own.id}`, { pinned: true }), 403)
      const shared = (await create(dm, { title: 'Sdílený zápis' })).body.entry
      expectStatus(await bob.client.patch(`/journal/${shared.id}`, { title: 'Hacknuto' }), 403)
      expectStatus(await bob.client.delete(`/journal/${shared.id}`), 403)
    })

    it('DM zápis upraví, změní viditelnost, vybrané hráče a téma', async () => {
      const e = (await create(dm, { title: 'Pohyblivý', visibility: 'dm' })).body.entry
      expect(await titles(bob)).not.toContain('Pohyblivý')
      const toBob = await dm.client.patch(`/journal/${e.id}`, { topic: 'Místa', visibility: 'selected', viewerIds: [bob.id] })
      expect(toBob.body.entry).toMatchObject({ topic: 'Místa', visibility: 'selected', viewerIds: [bob.id] })
      expect(await titles(bob)).toContain('Pohyblivý')
      expect(await titles(carol)).not.toContain('Pohyblivý')
      await dm.client.patch(`/journal/${e.id}`, { viewerIds: [carol.id] })
      expect(await titles(bob)).not.toContain('Pohyblivý')
      expect(await titles(carol)).toContain('Pohyblivý')
      await dm.client.patch(`/journal/${e.id}`, { visibility: 'all' })
      expect(await titles(bob)).toContain('Pohyblivý')
      expectStatus(await dm.client.delete(`/journal/${e.id}`), 204)
    })
  })

  describe('validace', () => {
    it('prázdný nadpis, příliš dlouhé texty, špatná viditelnost a špatní příjemci se odmítnou', async () => {
      expectStatus(await create(dm, { title: '' }), 422)
      expectStatus(await create(dm, { title: 'x'.repeat(121) }), 422)
      expectStatus(await create(dm, { topic: '' }), 422)
      expectStatus(await create(dm, { topic: 'x'.repeat(61) }), 422)
      expectStatus(await create(dm, { body: 'x'.repeat(20001) }), 422)
      expectStatus(await create(dm, { visibility: 'tajne' }), 422)
      expectStatus(await create(dm, { visibility: 'selected' }), 422)
      expectStatus(await create(dm, { visibility: 'selected', viewerIds: [eve.id] }), 422)
      expectStatus(await create(dm, { visibility: 'selected', viewerIds: [dm.id] }), 422)
      expectStatus(await create(dm, { visibility: 'owner' }), 422)
      expectStatus(await create(dm, { pinned: 'ano' }), 422)
      expectStatus(await create(dm, { body: 'x'.repeat(20000) }), 201)
    })

    it('text se vrací beze změny (žádné HTML)', async () => {
      const res = await create(dm, { title: '<b>Nadpis</b>', body: '<img src=x onerror=alert(1)>' })
      expect(res.body.entry).toMatchObject({ title: '<b>Nadpis</b>', body: '<img src=x onerror=alert(1)>' })
    })

    it('výchozí téma je Obecné a tělo může být prázdné', async () => {
      const res = await dm.client.post(`/campaigns/${campaignId}/journal`, { title: 'Jen nadpis' })
      expect(res.body.entry).toMatchObject({ topic: 'Obecné', body: '' })
    })
  })

  describe('nové zápisy', () => {
    it('zápisy od jiných se počítají jako nové, vlastní ne, otevření deníku je vynuluje', async () => {
      const fresh = await joinAsPlayer(dm, campaignId, 'novacek')
      // zápisy vytvořené před vstupem do kampaně nejsou nové
      expect((await list(fresh)).unread).toBe(0)
      await new Promise((r) => setTimeout(r, 1100)) // časy jsou na sekundy
      await create(dm, { title: 'Novinka A' })
      await create(dm, { title: 'Jen DM', visibility: 'dm' }) // hráč ho nevidí, nepočítá se
      const own = await create(fresh, { title: 'Vlastní' }) // vlastní zápis není nový
      expectStatus(own, 201)
      const state = await list(fresh)
      expect(state.unread).toBe(1)
      expect(state.entries.find((e) => e.title === 'Novinka A').isNew).toBe(true)
      expect(state.entries.find((e) => e.title === 'Vlastní').isNew).toBe(false)
      expect((await overview(fresh)).total).toBe(1)
      expect((await overview(fresh)).campaigns[0]).toMatchObject({ campaignId, unread: 1 })

      expectStatus(await fresh.client.post(`/campaigns/${campaignId}/journal/read`, {}), 200)
      expect((await list(fresh)).unread).toBe(0)
      expect((await overview(fresh)).total).toBe(0)

      // úprava zápisu od DM ho zase označí jako nový
      await new Promise((r) => setTimeout(r, 1100))
      const entry = (await list(dm)).entries.find((e) => e.title === 'Novinka A')
      await dm.client.patch(`/journal/${entry.id}`, { body: 'Upraveno' })
      expect((await list(fresh)).unread).toBe(1)
    })

    it('přehled nepřečtených zahrnuje jen kampaně uživatele', async () => {
      const u = await registerUser('multi')
      const mine = await createCampaign(u, 'Moje')
      await u.client.post(`/campaigns/${mine}/journal`, { title: 'x' })
      expect(await overview(u)).toEqual({ total: 0, campaigns: [] })
    })
  })

  it('zápisy zmizí s kampaní', async () => {
    const c = await createCampaign(dm, 'K smazání')
    await create(dm, { title: 'bye' }, c)
    expectStatus(await dm.client.delete(`/campaigns/${c}`), 204)
    expectStatus(await dm.client.get(`/campaigns/${c}/journal`), 404)
  })
})
