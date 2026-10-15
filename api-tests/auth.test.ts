import { describe, expect, it } from 'vitest'
import { Client, PASSWORD, REGISTRATION_KEY, createCampaign, createInvite, expectStatus, registerUser, uniqueName } from './client'

describe('registrace a přihlášení', () => {
  it('registruje jménem a heslem s registračním heslem a vrátí relaci', async () => {
    const client = new Client()
    const username = uniqueName('novy')
    const res = await client.post('/auth/register', { username, password: PASSWORD, code: REGISTRATION_KEY })
    expect(res.status).toBe(201)
    expect(res.body.user).toMatchObject({ username, displayName: username })
    expect(client.hasSession()).toBe(true)

    const me = await client.get('/auth/me')
    expect(me.body.user.username).toBe(username)
  })

  it('odpověď nikdy neobsahuje hash hesla', async () => {
    const client = new Client()
    const res = await client.post('/auth/register', { username: uniqueName('reg'), password: PASSWORD, code: REGISTRATION_KEY })
    expect(JSON.stringify(res.body)).not.toMatch(/hash|\$2y\$/i)
  })

  it('session cookie je HttpOnly a SameSite=Lax', async () => {
    const client = new Client()
    const res = await client.post('/auth/register', { username: uniqueName('cookie'), password: PASSWORD, code: REGISTRATION_KEY })
    const cookie = res.setCookie.find((c) => c.startsWith('dnd_session='))
    expect(cookie).toBeDefined()
    expect(cookie).toMatch(/HttpOnly/i)
    expect(cookie).toMatch(/SameSite=Lax/i)
  })

  it('bez platného kódu se zaregistrovat nejde', async () => {
    const res = await new Client().post('/auth/register', { username: uniqueName('x'), password: PASSWORD, code: 'spatny-kod' })
    expect(res.status).toBe(403)
  })

  it('jméno je unikátní bez ohledu na velikost písmen', async () => {
    const first = await registerUser('Karel')
    const res = await new Client().post('/auth/register', {
      username: first.username.toUpperCase(),
      password: PASSWORD,
      code: REGISTRATION_KEY,
    })
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('username_taken')
  })

  it('odmítá slabé heslo a nepovolené znaky ve jméně', async () => {
    const weak = await new Client().post('/auth/register', { username: uniqueName('a'), password: 'kratke', code: REGISTRATION_KEY })
    expect(weak.status).toBe(422)
    const bad = await new Client().post('/auth/register', { username: 'zly jmeno!', password: PASSWORD, code: REGISTRATION_KEY })
    expect(bad.status).toBe(422)
    const long = await new Client().post('/auth/register', { username: uniqueName('b'), password: 'x'.repeat(80), code: REGISTRATION_KEY })
    expect(long.status).toBe(422)
  })

  it('přihlásí se správným heslem a odmítne špatné', async () => {
    const user = await registerUser('login')
    const ok = new Client()
    const good = await ok.post('/auth/login', { username: user.username, password: PASSWORD })
    expect(good.status).toBe(200)
    expect(ok.hasSession()).toBe(true)

    const bad = new Client()
    const wrong = await bad.post('/auth/login', { username: user.username, password: 'spatneheslo' })
    expect(wrong.status).toBe(401)
    expect(bad.hasSession()).toBe(false)

    const unknown = await new Client().post('/auth/login', { username: 'neexistuje123', password: PASSWORD })
    expect(unknown.status).toBe(401)
    expect(unknown.body.error.message).toBe(wrong.body.error.message) // nesmí prozradit, že jméno neexistuje
  })

  it('přihlášení je case-insensitive na jménu, ale ne na hesle', async () => {
    const user = await registerUser('Mixed')
    const res = await new Client().post('/auth/login', { username: user.username.toLowerCase(), password: PASSWORD })
    expect(res.status).toBe(200)
    const wrongCase = await new Client().post('/auth/login', { username: user.username, password: PASSWORD.toUpperCase() })
    expect(wrongCase.status).toBe(401)
  })

  it('odhlášení zneplatní relaci i na serveru', async () => {
    const user = await registerUser('logout')
    const stolen = new Client()
    // zkopíruje cookie do druhého klienta (jako by někdo token ukradl)
    const me = await user.client.get('/auth/me')
    expect(me.body.user).not.toBeNull()
    const sessionCookie = (user.client as unknown as { cookies: Map<string, string> }).cookies.get('dnd_session')!
    ;(stolen as unknown as { cookies: Map<string, string> }).cookies.set('dnd_session', sessionCookie)

    expect((await user.client.post('/auth/logout')).status).toBe(204)
    expect((await stolen.get('/auth/me')).body.user).toBeNull()
    expect((await stolen.get('/campaigns')).status).toBe(401)
  })

  it('po 8 špatných pokusech zamkne přihlášení (rate limit)', async () => {
    const user = await registerUser('brute')
    const attacker = new Client()
    for (let i = 0; i < 8; i++) {
      const res = await attacker.post('/auth/login', { username: user.username, password: `spatne${i}xxx` })
      expect(res.status).toBe(401)
    }
    const locked = await attacker.post('/auth/login', { username: user.username, password: PASSWORD })
    expect(locked.status).toBe(429)
  })

  it('změna hesla vyžaduje staré heslo a odhlásí ostatní zařízení', async () => {
    const user = await registerUser('pw')
    const other = new Client()
    await other.post('/auth/login', { username: user.username, password: PASSWORD })
    expect((await other.get('/campaigns')).status).toBe(200)

    const wrong = await user.client.post('/auth/password', { currentPassword: 'neni-to-ono', newPassword: 'noveheslo123' })
    expect(wrong.status).toBe(403)

    const ok = await user.client.post('/auth/password', { currentPassword: PASSWORD, newPassword: 'noveheslo123' })
    expect(ok.status).toBe(204)
    expect((await user.client.get('/campaigns')).status).toBe(200)
    expect((await other.get('/campaigns')).status).toBe(401)

    const login = await new Client().post('/auth/login', { username: user.username, password: 'noveheslo123' })
    expect(login.status).toBe(200)
  })

  it('bez přihlášení nejde k datům', async () => {
    const anon = new Client()
    for (const path of ['/campaigns', '/campaigns/x', '/characters/x']) {
      expect((await anon.get(path)).status).toBe(401)
    }
    expect((await anon.post('/campaigns', { name: 'Hack' })).status).toBe(401)
    expect((await anon.get('/auth/me')).body.user).toBeNull()
  })

  it('požadavek z cizího originu (CSRF) se zamítne', async () => {
    const user = await registerUser('csrf')
    const res = await user.client.request('POST', '/campaigns', { name: 'Podvrh' }, { Origin: 'https://evil.example', Host: '127.0.0.1:8181' })
    expect(res.status).toBe(403)
    const same = await user.client.request('POST', '/campaigns', { name: 'Ok' }, { Origin: 'http://127.0.0.1:8181' })
    expect(same.status).toBe(201)
  })

  it('registrace s pozvánkou přidá hráče rovnou do kampaně', async () => {
    const dm = await registerUser('dm')
    const campaignId = await createCampaign(dm)
    const { code } = await createInvite(dm, campaignId)

    const client = new Client()
    const res = await client.post('/auth/register', { username: uniqueName('pozvany'), password: PASSWORD, code: code.toLowerCase() })
    expectStatus(res, 201)
    const campaigns = await client.get('/campaigns')
    expect(campaigns.body.campaigns).toHaveLength(1)
    expect(campaigns.body.campaigns[0]).toMatchObject({ id: campaignId, role: 'player' })
  })

  it('zrušená a vyčerpaná pozvánka se nedá použít k registraci', async () => {
    const dm = await registerUser('dm')
    const campaignId = await createCampaign(dm)

    const revoked = await createInvite(dm, campaignId)
    expectStatus(await dm.client.patch(`/campaigns/${campaignId}/invites/${revoked.id}`, { revoked: true }), 200)
    const r1 = await new Client().post('/auth/register', { username: uniqueName('r'), password: PASSWORD, code: revoked.code })
    expect(r1.status).toBe(403)

    const single = await createInvite(dm, campaignId, { maxUses: 1 })
    const first = await new Client().post('/auth/register', { username: uniqueName('s'), password: PASSWORD, code: single.code })
    expect(first.status).toBe(201)
    const second = await new Client().post('/auth/register', { username: uniqueName('t'), password: PASSWORD, code: single.code })
    expect(second.status).toBe(403)
  })

  it('neexistující endpoint a špatná metoda vrací JSON chybu', async () => {
    const c = new Client()
    expect((await c.get('/neexistuje')).status).toBe(404)
    expect((await c.request('PUT', '/auth/login', {})).status).toBe(405)
  })

  it('migrace přes web: špatný klíč se odmítne, správný projde', async () => {
    const c = new Client()
    expect((await c.request('POST', '/admin/migrate', {}, { 'X-Migrate-Key': 'spatny' })).status).toBe(403)
    expect((await c.request('POST', '/admin/migrate', {})).status).toBe(403)
    const ok = await c.request('POST', '/admin/migrate', {}, { 'X-Migrate-Key': 'test-migrate' })
    expect(ok.status).toBe(200)
    expect(ok.body.applied).toEqual([])
  })
})
