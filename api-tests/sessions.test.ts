import { beforeAll, describe, expect, it } from 'vitest'
import { Client, createCampaign, expectStatus, joinAsPlayer, registerUser, testDbExec, type TestUser } from './client'

const local = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Prague' })
/** Místní (pražské) datum posunuté o `offset` dní. */
const day = (offset: number) => local.format(new Date(Date.now() + offset * 86_400_000))
const KEY = { 'X-Migrate-Key': 'test-migrate' }

describe('plánování session (kalendář)', () => {
  let dm: TestUser
  let bob: TestUser
  let carol: TestUser
  let eve: TestUser
  let campaignId: string

  const calendar = async (user: TestUser, cid: string = campaignId) => {
    const res = await user.client.get(`/campaigns/${cid}/calendar`)
    expectStatus(res, 200)
    return res.body as { today: string; sessions: { id: string; date: string; time: string | null; note: string }[]; members: { userId: string; name: string; role: string }[]; availability: Record<string, string[]> }
  }
  const mark = (user: TestUser, days: unknown, available = true, cid: string = campaignId) => user.client.post(`/campaigns/${cid}/availability`, { days, available })
  const notes = async (user: TestUser) => ((await user.client.get('/notifications')).body.notifications as { kind: string; text: string }[]).filter((n) => n.kind === 'session').map((n) => n.text)

  beforeAll(async () => {
    dm = await registerUser('dm')
    campaignId = await createCampaign(dm, 'Session kampaň')
    bob = await joinAsPlayer(dm, campaignId, 'bob')
    carol = await joinAsPlayer(dm, campaignId, 'carol')
    eve = await registerUser('eve')
  })

  describe('oprávnění', () => {
    it('anonym 401, cizinec 404 na všem', async () => {
      const anon = new Client()
      const fake = '00000000-0000-4000-8000-000000000000'
      expect((await anon.get(`/campaigns/${campaignId}/calendar`)).status).toBe(401)
      expect((await anon.post(`/campaigns/${campaignId}/availability`, {})).status).toBe(401)
      expect((await anon.post(`/campaigns/${campaignId}/sessions`, {})).status).toBe(401)
      expect((await anon.patch(`/sessions/${fake}`, {})).status).toBe(401)
      expect((await anon.delete(`/sessions/${fake}`)).status).toBe(401)
      expectStatus(await eve.client.get(`/campaigns/${campaignId}/calendar`), 404)
      expectStatus(await mark(eve, [day(5)]), 404)
      expectStatus(await eve.client.post(`/campaigns/${campaignId}/sessions`, { date: day(5) }), 404)
    })

    it('hráč termín zadat, změnit ani zrušit nesmí (403), cizinec 404', async () => {
      expectStatus(await bob.client.post(`/campaigns/${campaignId}/sessions`, { date: day(9) }), 403)
      const id = (await dm.client.post(`/campaigns/${campaignId}/sessions`, { date: day(60) })).body.session.id
      expectStatus(await bob.client.patch(`/sessions/${id}`, { note: 'přepsáno' }), 403)
      expectStatus(await bob.client.delete(`/sessions/${id}`), 403)
      expectStatus(await eve.client.patch(`/sessions/${id}`, { note: 'x' }), 404)
      expectStatus(await eve.client.delete(`/sessions/${id}`), 404)
      expect((await calendar(bob)).sessions.find((s) => s.id === id)?.note).toBe('')
      expectStatus(await dm.client.delete(`/sessions/${id}`), 200)
    })

    it('DM jiné kampaně cizí session nezmění (404)', async () => {
      const other = await registerUser('dm2')
      await createCampaign(other, 'Jiná')
      const id = (await dm.client.post(`/campaigns/${campaignId}/sessions`, { date: day(61) })).body.session.id
      expectStatus(await other.client.patch(`/sessions/${id}`, { note: 'x' }), 404)
      expectStatus(await other.client.delete(`/sessions/${id}`), 404)
      expectStatus(await dm.client.delete(`/sessions/${id}`), 200)
    })
  })

  describe('dostupnost', () => {
    it('každý označí jen sám sebe, vidí to všichni členové, jde odznačit', async () => {
      const res = await mark(bob, [day(10), day(11), day(10)])
      expectStatus(res, 200)
      expect(res.body.days).toEqual([day(10), day(11)])
      expectStatus(await mark(dm, [day(11)]), 200)
      // cizí userId v těle nic nezmění
      expectStatus(await bob.client.post(`/campaigns/${campaignId}/availability`, { days: [day(12)], available: true, userId: carol.id }), 200)

      for (const viewer of [dm, bob, carol]) {
        const cal = await calendar(viewer)
        expect(cal.availability[bob.id]).toEqual([day(10), day(11), day(12)])
        expect(cal.availability[dm.id]).toEqual([day(11)])
        expect(cal.availability[carol.id]).toEqual([])
        expect(cal.members.map((m) => m.role)).toEqual(['dm', 'player', 'player'])
      }
      expectStatus(await mark(bob, [day(11), day(12)], false), 200)
      expect((await calendar(carol)).availability[bob.id]).toEqual([day(10)])
    })

    it('dostupnost jedné kampaně se neukáže v jiné a cizinec ji nevidí', async () => {
      const other = await createCampaign(dm, 'Druhá')
      expect((await calendar(dm, other)).availability[dm.id]).toEqual([])
      expect((await calendar(dm)).availability[dm.id]).toEqual([day(11)])
    })

    it('validace: minulost, příliš daleko, špatné datum, prázdné a příliš mnoho dní', async () => {
      for (const days of [[day(-1)], [day(500)], ['2026-02-30'], ['zítra'], [5], [], 'x', null]) {
        expect((await mark(bob, days)).status, JSON.stringify(days)).toBe(422)
      }
      const many = Array.from({ length: 101 }, (_, i) => day(i + 1))
      expect((await mark(bob, many)).status).toBe(422)
      expect((await bob.client.post(`/campaigns/${campaignId}/availability`, { days: [day(3)] })).status).toBe(422) // chybí available
      expect((await bob.client.post(`/campaigns/${campaignId}/availability`, { days: [day(3)], available: 'ano' })).status).toBe(422)
    })
  })

  describe('termíny session', () => {
    it('DM zadá termín, hráči dostanou oznámení a DM ne, termín je vidět všem', async () => {
      const res = await dm.client.post(`/campaigns/${campaignId}/sessions`, { date: day(20), time: '18:30', note: 'U Boba doma' })
      expectStatus(res, 201)
      expect(res.body.session).toMatchObject({ date: day(20), time: '18:30', note: 'U Boba doma' })
      for (const u of [bob, carol]) {
        expect((await calendar(u)).sessions.some((s) => s.date === day(20))).toBe(true)
        expect((await notes(u)).some((t) => t.startsWith('Další session:') && t.includes('18:30') && t.includes('U Boba doma'))).toBe(true)
      }
      expect(await notes(dm)).toEqual([])
    })

    it('validace: minulost, špatné datum a čas, duplicita, dlouhá poznámka', async () => {
      const post = (body: unknown) => dm.client.post(`/campaigns/${campaignId}/sessions`, body)
      expect((await post({ date: day(-1) })).status).toBe(422)
      expect((await post({ date: '31.10.2026' })).status).toBe(422)
      expect((await post({})).status).toBe(422)
      expect((await post({ date: day(21), time: '25:00' })).status).toBe(422)
      expect((await post({ date: day(21), time: '9:00' })).status).toBe(422)
      expect((await post({ date: day(21), note: 'x'.repeat(201) })).status).toBe(422)
      expect((await post({ date: day(20) })).status).toBe(422) // v ten den už session je
    })

    it('přesun a zrušení: hráči se to dozvědí, přesunutá session má novou připomínku', async () => {
      const id = (await dm.client.post(`/campaigns/${campaignId}/sessions`, { date: day(30) })).body.session.id
      const moved = await dm.client.patch(`/sessions/${id}`, { date: day(31), time: '19:00' })
      expectStatus(moved, 200)
      expect(moved.body.session).toMatchObject({ date: day(31), time: '19:00' })
      expect((await notes(bob)).some((t) => t.startsWith('Session se přesouvá:') && t.includes('19:00'))).toBe(true)
      expect((await dm.client.patch(`/sessions/${id}`, { date: day(20) })).status).toBe(422) // obsazený den
      expect((await dm.client.patch(`/sessions/${id}`, { date: day(-3) })).status).toBe(422)
      expect((await dm.client.patch(`/sessions/${id}`, { time: 'večer' })).status).toBe(422)
      // změna poznámky nikoho neruší
      const before = (await notes(bob)).length
      expectStatus(await dm.client.patch(`/sessions/${id}`, { note: 'jen poznámka' }), 200)
      expect((await notes(bob)).length).toBe(before)
      expectStatus(await dm.client.patch(`/sessions/${id}`, { time: null }), 200)
      expect((await calendar(bob)).sessions.find((s) => s.id === id)).toMatchObject({ time: null, note: 'jen poznámka' })

      expectStatus(await dm.client.delete(`/sessions/${id}`), 200)
      expect((await calendar(bob)).sessions.some((s) => s.id === id)).toBe(false)
      expect((await notes(carol)).some((t) => t.includes('se ruší'))).toBe(true)
      expectStatus(await dm.client.delete(`/sessions/${id}`), 404)
    })
  })

  describe('připomínka den předem', () => {
    const remind = async () => {
      const res = await dm.client.request('POST', '/admin/reminders', {}, KEY)
      expectStatus(res, 200)
      return res.body.sent as number
    }

    it('trasa chráněná klíčem: bez klíče nic neudělá', async () => {
      expect([401, 403, 404]).toContain((await dm.client.post('/admin/reminders', {})).status)
      expect([401, 403, 404]).toContain((await new Client().post('/admin/reminders', {})).status)
    })

    it('adresa pro cron hostingu: bez klíče a se špatným klíčem 404, se správným 200, HEAD nic nedělá', async () => {
      const anon = new Client()
      expect((await anon.get('/cron/reminders')).status).toBe(404)
      expect((await anon.get('/cron/reminders?key=spatny')).status).toBe(404)
      const ok = await anon.get('/cron/reminders?key=test-migrate')
      expectStatus(ok, 200)
      expect(ok.body.sent).toEqual(expect.any(Number))
      expectStatus(await anon.request('HEAD', '/cron/reminders'), 200)
    })

    it('session dnes se připomene právě jednou všem členům včetně DM; budoucí ne', async () => {
      const owner = await registerUser('dm3')
      const cid = await createCampaign(owner, 'Připomínky')
      const p1 = await joinAsPlayer(owner, cid, 'p1')
      const far = (await owner.client.post(`/campaigns/${cid}/sessions`, { date: day(14) })).body.session.id
      const todayId = (await owner.client.post(`/campaigns/${cid}/sessions`, { date: day(0), time: '20:00' })).body.session.id
      // nově zadaná session v okně připomínky se nepřipomíná (oznámení stačí), takže značku pro zkoušku vynulujeme
      testDbExec('UPDATE game_sessions SET reminded_at = NULL WHERE id = ?', [todayId])
      expect(await remind()).toBeGreaterThanOrEqual(1)
      const mine = (u: TestUser) => notes(u).then((t) => t.filter((x) => x.startsWith('Dnes hrajeme')))
      expect(await mine(p1)).toHaveLength(1)
      expect(await mine(owner)).toHaveLength(1)
      expect((await mine(p1))[0]).toContain('20:00')
      await remind()
      await owner.client.get('/summary') // lazy spouštěč z /summary také nic neduplikuje
      expect(await mine(p1)).toHaveLength(1)
      expect((await notes(p1)).filter((t) => t.includes(day(14).slice(0, 4)) && t.startsWith('Zítra'))).toEqual([])
      expectStatus(await owner.client.delete(`/sessions/${far}`), 200)
    })

    it('spouští ji i /summary (aplikace je otevřená), souběžné volání pošle jen jednu', async () => {
      const owner = await registerUser('dm4')
      const cid = await createCampaign(owner, 'Souběh')
      const p1 = await joinAsPlayer(owner, cid, 'p2')
      const id = (await owner.client.post(`/campaigns/${cid}/sessions`, { date: day(0) })).body.session.id
      testDbExec('UPDATE game_sessions SET reminded_at = NULL WHERE id = ?', [id])
      await Promise.all([p1.client.get('/summary'), p1.client.get('/summary'), owner.client.get('/summary'), dm.client.request('POST', '/admin/reminders', {}, KEY)])
      expect((await notes(p1)).filter((t) => t.startsWith('Dnes hrajeme'))).toHaveLength(1)
    })

    it('session v minulosti se nepřipomíná', async () => {
      const owner = await registerUser('dm5')
      const cid = await createCampaign(owner, 'Minulost')
      const p1 = await joinAsPlayer(owner, cid, 'p3')
      const id = (await owner.client.post(`/campaigns/${cid}/sessions`, { date: day(2) })).body.session.id
      testDbExec('UPDATE game_sessions SET session_date = ?, reminded_at = NULL WHERE id = ?', [day(-2), id])
      await remind()
      expect((await notes(p1)).filter((t) => /hrajeme/.test(t))).toEqual([])
    })
  })

  it('v kalendáři zůstanou poslední odehrané session a smazání kampaně smaže vše', async () => {
    const owner = await registerUser('dm6')
    const cid = await createCampaign(owner, 'Historie')
    for (const [i, date] of [-10, -5, -3, -1].entries()) {
      const id = (await owner.client.post(`/campaigns/${cid}/sessions`, { date: day(i + 1) })).body.session.id
      testDbExec('UPDATE game_sessions SET session_date = ? WHERE id = ?', [day(date!), id])
    }
    expect((await calendar(owner, cid)).sessions.map((s) => s.date)).toEqual([day(-5), day(-3), day(-1)])
    expectStatus(await owner.client.delete(`/campaigns/${cid}`), 204)
  })
})
