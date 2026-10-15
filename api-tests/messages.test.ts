import { beforeAll, describe, expect, it } from 'vitest'
import { Client, createCampaign, expectStatus, joinAsPlayer, registerUser, type TestUser } from './client'

describe('zprávy v kampani', () => {
  let dm: TestUser
  let bob: TestUser
  let carol: TestUser
  let dave: TestUser
  let eve: TestUser
  let campaignId: string
  let otherCampaignId: string

  const send = (user: TestUser, to: unknown, body = 'Ahoj', cid: string = campaignId) => user.client.post(`/campaigns/${cid}/messages`, { to, body })
  const list = async (user: TestUser, query = '', cid: string = campaignId) => (await user.client.get(`/campaigns/${cid}/messages${query}`)).body as { messages: any[]; unread: Record<string, number> }
  const bodies = async (user: TestUser) => (await list(user)).messages.map((m) => m.body)

  beforeAll(async () => {
    dm = await registerUser('dm')
    campaignId = await createCampaign(dm, 'Zprávy')
    otherCampaignId = await createCampaign(dm, 'Jiná')
    bob = await joinAsPlayer(dm, campaignId, 'bob')
    carol = await joinAsPlayer(dm, campaignId, 'carol')
    dave = await joinAsPlayer(dm, campaignId, 'dave')
    eve = await registerUser('eve')
  })

  describe('oprávnění', () => {
    it('anonym dostane 401, cizinec 404 (ani nepozná, že kampaň existuje)', async () => {
      const anon = new Client()
      expect((await anon.get(`/campaigns/${campaignId}/messages`)).status).toBe(401)
      expect((await anon.post(`/campaigns/${campaignId}/messages`, { to: 'all', body: 'x' })).status).toBe(401)
      expect((await anon.get('/messages/unread')).status).toBe(401)
      expectStatus(await eve.client.get(`/campaigns/${campaignId}/messages`), 404)
      expectStatus(await send(eve, 'all'), 404)
      expectStatus(await eve.client.post(`/campaigns/${campaignId}/messages/read`, { thread: 'group' }), 404)
    })

    it('zprávy jedné kampaně se neukážou v jiné', async () => {
      expectStatus(await send(dm, 'all', 'jen v první'), 201)
      expect(await bodies(dm)).toContain('jen v první')
      expect((await list(dm, '', otherCampaignId)).messages).toHaveLength(0)
    })
  })

  describe('skupinový chat', () => {
    it('napíše kdokoli z členů, vidí všichni členové a nikdo mimo', async () => {
      expectStatus(await send(bob, 'all', 'Skupina od Boba'), 201)
      for (const u of [dm, bob, carol, dave]) expect(await bodies(u), u.username).toContain('Skupina od Boba')
      const msg = (await list(carol)).messages.find((m) => m.body === 'Skupina od Boba')
      expect(msg).toMatchObject({ thread: 'group', senderId: bob.id, recipients: [] })
      expect(msg.senderName).toBeTruthy()
    })
  })

  describe('soukromě DM a hráč', () => {
    it('hráč píše DM: vidí jen oni dva, žádný jiný hráč', async () => {
      const res = await send(bob, [dm.id], 'Bobovo tajemství')
      expectStatus(res, 201)
      expect(res.body.message).toMatchObject({ thread: `dm:${bob.id}`, recipients: [{ id: dm.id }] })
      expect(await bodies(bob)).toContain('Bobovo tajemství')
      expect(await bodies(dm)).toContain('Bobovo tajemství')
      expect(await bodies(carol)).not.toContain('Bobovo tajemství')
      expect(await bodies(dave)).not.toContain('Bobovo tajemství')
    })

    it('DM odpoví hráči: vidí to hráč a DM, jiný hráč ne', async () => {
      expectStatus(await send(dm, [bob.id], 'DM Bobovi'), 201)
      expect(await bodies(bob)).toContain('DM Bobovi')
      expect(await bodies(carol)).not.toContain('DM Bobovi')
      const msg = (await list(dm)).messages.find((m) => m.body === 'DM Bobovi')
      expect(msg.thread).toBe(`dm:${bob.id}`)
    })

    it('hráč nemůže soukromě psát jinému hráči ani víc lidem naráz', async () => {
      expectStatus(await send(bob, [carol.id], 'Carol, pst'), 403)
      expectStatus(await send(bob, [carol.id, dm.id], 'Nás víc'), 403)
      expectStatus(await send(bob, [bob.id], 'Sám sobě'), 403)
      expectStatus(await send(bob, [eve.id], 'Cizinec'), 403)
      for (const u of [dm, bob, carol, dave]) {
        const all = await bodies(u)
        expect(all).not.toContain('Carol, pst')
        expect(all).not.toContain('Nás víc')
      }
    })

    it('DM nepíše sám sobě ani cizinci a nepíše členu, který není hráč', async () => {
      expectStatus(await send(dm, [dm.id]), 422)
      expectStatus(await send(dm, [eve.id]), 422)
      expectStatus(await send(dm, ['neni-uuid']), 422)
    })
  })

  describe('tajné zprávy od DM', () => {
    it('vidí je DM a vybraní příjemci (i kdo je spolu příjemce), ostatní hráči ne', async () => {
      const res = await send(dm, [bob.id, carol.id], 'Zrádce je kovář')
      expectStatus(res, 201)
      expect(res.body.message.thread).toBe('secret')
      expect(res.body.message.recipients.map((r: any) => r.id).sort()).toEqual([bob.id, carol.id].sort())
      expect(await bodies(bob)).toContain('Zrádce je kovář')
      expect(await bodies(carol)).toContain('Zrádce je kovář')
      expect(await bodies(dm)).toContain('Zrádce je kovář')
      expect(await bodies(dave)).not.toContain('Zrádce je kovář')
      const forBob = (await list(bob)).messages.find((m) => m.body === 'Zrádce je kovář')
      expect(forBob.recipients).toHaveLength(2)
    })

    it('hráč tajnou zprávu nepošle a nevidí ji ani přes dotaz po id', async () => {
      expectStatus(await send(carol, [bob.id, dm.id]), 403)
      const since = await list(dave, '?after=0')
      expect(since.messages.map((m) => m.body)).not.toContain('Zrádce je kovář')
      const first = since.messages[0]?.id ?? 0
      expect((await list(dave, `?after=${Math.max(0, first - 1)}`)).messages.map((m) => m.body)).not.toContain('Zrádce je kovář')
    })
  })

  describe('validace', () => {
    it('prázdná, příliš dlouhá zpráva a špatní příjemci se odmítnou', async () => {
      expectStatus(await send(bob, 'all', ''), 422)
      expectStatus(await send(bob, 'all', '   '), 422)
      expectStatus(await send(bob, 'all', 'x'.repeat(4001)), 422)
      expectStatus(await send(bob, 'all', 'x'.repeat(4000)), 201)
      expectStatus(await send(bob, undefined), 422)
      expectStatus(await send(bob, []), 422)
      expectStatus(await send(bob, 'vsichni'), 422)
      expectStatus(await send(bob, 42), 422)
    })

    it('text se ukládá beze změny (žádné HTML se nevykonává, jen se vrací jako text)', async () => {
      const res = await send(bob, 'all', '<script>alert(1)</script> & "uvozovky"')
      expectStatus(res, 201)
      expect(res.body.message.body).toBe('<script>alert(1)</script> & "uvozovky"')
    })
  })

  describe('průběžné dotazování a nepřečtené', () => {
    it('after vrací jen novější zprávy', async () => {
      const before = (await list(bob)).messages
      const last = before[before.length - 1].id
      expect((await list(bob, `?after=${last}`)).messages).toHaveLength(0)
      await send(carol, 'all', 'Nová od Carol')
      const fresh = (await list(bob, `?after=${last}`)).messages
      expect(fresh.map((m) => m.body)).toEqual(['Nová od Carol'])
      expect(fresh[0].id).toBeGreaterThan(last)
    })

    it('nepřečtené se počítají po vláknech, vlastní zprávy se nepočítají a přečtení je vynuluje', async () => {
      const u = await joinAsPlayer(dm, campaignId, 'ema')
      await send(dm, 'all', 'Pro všechny A')
      await send(dm, [u.id], 'Jen pro Emu')
      await send(u, 'all', 'Ema sama')
      const state = await list(u)
      expect(state.unread.group).toBeGreaterThanOrEqual(1)
      expect(state.unread[`dm:${u.id}`]).toBe(1)

      const total = (await u.client.get('/messages/unread')).body
      expect(total.total).toBeGreaterThanOrEqual(2)
      expect(total.campaigns.find((c: any) => c.campaignId === campaignId)).toBeTruthy()

      const after = await u.client.post(`/campaigns/${campaignId}/messages/read`, { thread: `dm:${u.id}` })
      expectStatus(after, 200)
      expect(after.body.unread[`dm:${u.id}`]).toBeUndefined()
      expect(after.body.unread.group).toBeGreaterThanOrEqual(1)
      expectStatus(await u.client.post(`/campaigns/${campaignId}/messages/read`, { thread: 'group' }), 200)
      expect((await u.client.get('/messages/unread')).body.total).toBe(0)

      // další zpráva zase zvedne počítadlo
      await send(dm, 'all', 'Pro všechny B')
      expect((await list(u)).unread.group).toBe(1)
    })

    it('označit jako přečtené cizí vlákno nic nepřečte a špatný název vlákna je 422', async () => {
      const u = await joinAsPlayer(dm, campaignId, 'finn')
      const v = await joinAsPlayer(dm, campaignId, 'gina')
      await send(dm, [v.id], 'Jen pro Ginu')
      // Finn zkusí označit Gininu konverzaci: nesmí to ovlivnit Ginino počítadlo ani nic ukázat
      expectStatus(await u.client.post(`/campaigns/${campaignId}/messages/read`, { thread: `dm:${v.id}` }), 200)
      expect((await list(v)).unread[`dm:${v.id}`]).toBe(1)
      expectStatus(await u.client.post(`/campaigns/${campaignId}/messages/read`, { thread: "x'; DROP TABLE messages;--" }), 422)
      expectStatus(await u.client.post(`/campaigns/${campaignId}/messages/read`, {}), 422)
    })

    it('přehled nepřečtených zahrnuje jen kampaně, kde je uživatel členem', async () => {
      const u = await registerUser('multi')
      const mine = await createCampaign(u, 'Moje')
      const lone = await createCampaign(dm, 'Jiné DM')
      await dm.client.post(`/campaigns/${lone}/messages`, { to: 'all', body: 'neviděno' })
      await u.client.post(`/campaigns/${mine}/messages`, { to: 'all', body: 'moje vlastní' })
      const o = (await u.client.get('/messages/unread')).body
      expect(o).toEqual({ total: 0, campaigns: [] })
    })
  })

  describe('omezení četnosti', () => {
    it('víc než 40 zpráv za minutu vrátí 429', async () => {
      const spammer = await joinAsPlayer(dm, campaignId, 'spam')
      let last = 0
      for (let i = 0; i < 45; i++) {
        last = (await send(spammer, 'all', `spam ${i}`)).status
        if (last === 429) break
      }
      expect(last).toBe(429)
    })
  })

  describe('smazání', () => {
    it('zprávy zmizí s kampaní', async () => {
      const c = await createCampaign(dm, 'K smazání')
      await dm.client.post(`/campaigns/${c}/messages`, { to: 'all', body: 'bye' })
      expectStatus(await dm.client.delete(`/campaigns/${c}`), 204)
      expectStatus(await dm.client.get(`/campaigns/${c}/messages`), 404)
    })
  })
})
