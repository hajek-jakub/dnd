import { createDecipheriv, createECDH, createPublicKey, hkdfSync, randomBytes, verify } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { PUSH_MOCK_PORT } from './global-setup'
import { Client, createCampaign, expectStatus, joinAsPlayer, makePng, registerUser, uniqueName, type TestUser } from './client'

const MOCK = `http://127.0.0.1:${PUSH_MOCK_PORT}`
const CHARACTER = { abilityScores: { str: 10, dex: 14, con: 12, int: 10, wis: 10, cha: 10 }, levels: [{ classIndex: 'fighter' }] }

/** Zařízení napodobené v Node: vlastní klíč P-256 a auth, tedy nezávislá druhá implementace RFC 8291 proti PHP. */
interface Device {
  key: string
  endpoint: string
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } }
  ecdh: ReturnType<typeof createECDH>
  auth: Buffer
}

const b64u = (b: Buffer) => b.toString('base64url')

function newDevice(prefix = 'dev'): Device {
  const key = uniqueName(prefix)
  const ecdh = createECDH('prime256v1')
  ecdh.generateKeys()
  const auth = randomBytes(16)
  const endpoint = `${MOCK}/push/${key}`
  return { key, endpoint, ecdh, auth, subscription: { endpoint, keys: { p256dh: b64u(ecdh.getPublicKey()), auth: b64u(auth) } } }
}

interface Received {
  headers: Record<string, string>
  body: string
}

async function received(device: Device): Promise<Received[]> {
  const res = await fetch(`${MOCK}/__mock/log?key=${device.key}`)
  return ((await res.json()) as { requests: Received[] }).requests
}

/** Počká, až na zařízení dorazí aspoň `count` push zpráv (push se odesílá až po odpovědi API). */
async function waitFor(device: Device, count: number, timeoutMs = 6000): Promise<Received[]> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const list = await received(device)
    if (list.length >= count || Date.now() > deadline) return list
    await new Promise((r) => setTimeout(r, 100))
  }
}

/** Ověření, že NIC nedorazilo: chvíli se počká a pak se zkontroluje log. */
async function expectNothing(device: Device, ms = 1500): Promise<void> {
  await new Promise((r) => setTimeout(r, ms))
  expect(await received(device)).toHaveLength(0)
}

/** Rozšifruje tělo push zprávy tak, jak to dělá prohlížeč (RFC 8291, aes128gcm). */
function decrypt(device: Device, body: string): { title: string; body: string; url: string; tag: string; category: string } {
  const data = Buffer.from(body, 'base64')
  const salt = data.subarray(0, 16)
  const idLen = data[20]!
  const asPublic = data.subarray(21, 21 + idLen)
  const cipher = data.subarray(21 + idLen)
  const shared = device.ecdh.computeSecret(asPublic)
  const ikm = Buffer.from(hkdfSync('sha256', shared, device.auth, Buffer.concat([Buffer.from('WebPush: info\0'), device.ecdh.getPublicKey(), asPublic]), 32))
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, 'Content-Encoding: aes128gcm\0', 16))
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, 'Content-Encoding: nonce\0', 12))
  const decipher = createDecipheriv('aes-128-gcm', cek, nonce)
  decipher.setAuthTag(cipher.subarray(cipher.length - 16))
  const plain = Buffer.concat([decipher.update(cipher.subarray(0, cipher.length - 16)), decipher.final()])
  // Záznam končí oddělovačem 0x02 (případně s nulovou výplní).
  const end = plain.lastIndexOf(0x02)
  expect(end, 'poslední záznam končí 0x02').toBeGreaterThan(0)
  return JSON.parse(plain.subarray(0, end).toString('utf8'))
}

/** Ověří podpis VAPID (ES256) veřejným klíčem, který server oznámil. */
function verifyVapid(authorization: string, publicKey: string, audience: string): void {
  const m = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(authorization)
  expect(m, 'tvar hlavičky Authorization').not.toBeNull()
  const [, head, claims, sig, k] = m!
  expect(k).toBe(publicKey)
  const point = Buffer.from(publicKey, 'base64url')
  expect(point).toHaveLength(65)
  const key = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: b64u(point.subarray(1, 33)), y: b64u(point.subarray(33)) }, format: 'jwk' })
  expect(verify('sha256', Buffer.from(`${head}.${claims}`), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig!, 'base64url')), 'podpis JWT sedí').toBe(true)
  const payload = JSON.parse(Buffer.from(claims!, 'base64url').toString())
  expect(payload.aud).toBe(audience)
  expect(payload.exp).toBeGreaterThan(Date.now() / 1000)
  expect(payload.exp).toBeLessThanOrEqual(Date.now() / 1000 + 24 * 3600)
  expect(payload.sub).toMatch(/^(mailto:|https:)/)
}

async function subscribe(user: TestUser, device: Device, categories?: string[]) {
  const res = await user.client.post('/push/subscription', { ...device.subscription, ...(categories ? { categories } : {}) })
  expectStatus(res, 201)
  return res.body.subscription as { categories: string[] }
}

describe('push notifikace', () => {
  let dm: TestUser
  let bob: TestUser
  let carol: TestUser
  let eve: TestUser
  let campaignId: string
  let publicKey: string

  const say = (user: TestUser, to: unknown, body: string) => user.client.post(`/campaigns/${campaignId}/messages`, { to, body })

  beforeAll(async () => {
    dm = await registerUser('dm')
    campaignId = await createCampaign(dm, 'Push kampaň')
    bob = await joinAsPlayer(dm, campaignId, 'bob')
    carol = await joinAsPlayer(dm, campaignId, 'carol')
    eve = await registerUser('eve')
    const config = await dm.client.get('/push/config')
    expectStatus(config, 200)
    publicKey = config.body.publicKey
  })

  describe('odběry a oprávnění', () => {
    it('anonym má 401 na všech trasách', async () => {
      const anon = new Client()
      expect((await anon.get('/push/config')).status).toBe(401)
      expect((await anon.get('/push/subscription?endpoint=x')).status).toBe(401)
      expect((await anon.post('/push/subscription', {})).status).toBe(401)
      expect((await anon.patch('/push/subscription', {})).status).toBe(401)
      expect((await anon.delete('/push/subscription?endpoint=x')).status).toBe(401)
      expect((await anon.post('/push/test', {})).status).toBe(401)
    })

    it('server vrací veřejný klíč VAPID (stabilní) a seznam kategorií', async () => {
      const res = await bob.client.get('/push/config')
      expect(res.body.available).toBe(true)
      expect(res.body.publicKey).toBe(publicKey)
      expect(Buffer.from(publicKey, 'base64url')).toHaveLength(65)
      expect(res.body.categories).toEqual(['messages', 'dm', 'maps', 'journal'])
    })

    it('diagnostika serveru ověří, že umí šifrovat a podepisovat push', async () => {
      const res = await new Client().request('POST', '/admin/diagnostics', {}, { 'X-Migrate-Key': 'test-migrate' })
      expect(res.body.push).toEqual({ supported: true, error: null })
    })

    it('adresu odběru přijme jen z push služeb (server by jinak volal libovolné adresy)', async () => {
      const device = newDevice()
      for (const endpoint of ['https://evil.example/push/abc', 'http://fcm.googleapis.com/fcm/send/x', 'https://fcm.googleapis.com.evil.example/x', 'https://127.0.0.1/x', 'http://127.0.0.1:9999/push/x', 'https://user:pw@fcm.googleapis.com/x', 'https://metadata.google.internal/x', 'javascript:alert(1)', '', 42]) {
        const res = await bob.client.post('/push/subscription', { ...device.subscription, endpoint })
        expect(res.status, String(endpoint)).toBe(422)
      }
      // skutečné push služby projdou kontrolou adresy (klíče jsou platné, nic se nevolá)
      for (const endpoint of ['https://fcm.googleapis.com/fcm/send/abc', 'https://updates.push.services.mozilla.com/wpush/v2/abc', 'https://web.push.apple.com/abc', 'https://wns2-par02p.notify.windows.com/w/?token=abc']) {
        const res = await bob.client.post('/push/subscription', { ...device.subscription, endpoint })
        expect(res.status, endpoint).toBe(201)
        expect((await bob.client.delete(`/push/subscription?endpoint=${encodeURIComponent(endpoint)}`)).status).toBe(204)
      }
    })

    it('neplatné klíče a kategorie jsou 422', async () => {
      const device = newDevice()
      const bad = (keys: unknown) => bob.client.post('/push/subscription', { endpoint: device.endpoint, keys })
      expect((await bad(undefined)).status).toBe(422)
      expect((await bad({ p256dh: 'AAAA', auth: device.subscription.keys.auth })).status).toBe(422)
      // bod mimo křivku P-256
      expect((await bad({ p256dh: b64u(Buffer.concat([Buffer.from([4]), randomBytes(64)])), auth: device.subscription.keys.auth })).status).toBe(422)
      expect((await bad({ p256dh: device.subscription.keys.p256dh, auth: b64u(randomBytes(8)) })).status).toBe(422)
      expect((await bob.client.post('/push/subscription', { ...device.subscription, categories: ['dice'] })).status).toBe(422)
      expect((await bob.client.post('/push/subscription', { ...device.subscription, categories: 'messages' })).status).toBe(422)
    })

    it('odběr jde založit, přečíst, změnit a zrušit; výchozí jsou všechny kategorie', async () => {
      const device = newDevice()
      const q = `/push/subscription?endpoint=${encodeURIComponent(device.endpoint)}`
      expect((await bob.client.get(q)).body.subscription).toBeNull()
      expect((await subscribe(bob, device)).categories).toEqual(['messages', 'dm', 'maps', 'journal'])
      expect((await bob.client.get(q)).body.subscription.categories).toHaveLength(4)
      const patched = await bob.client.patch('/push/subscription', { endpoint: device.endpoint, categories: ['maps', 'messages', 'messages'] })
      expectStatus(patched, 200)
      expect(patched.body.subscription.categories).toEqual(['messages', 'maps'])
      expect((await bob.client.patch('/push/subscription', { endpoint: device.endpoint, categories: [] })).body.subscription.categories).toEqual([])
      // opakované přihlášení bez kategorií volbu nepřepíše
      await subscribe(bob, device)
      expect((await bob.client.get(q)).body.subscription.categories).toEqual([])
      expect((await bob.client.delete(q)).status).toBe(204)
      expect((await bob.client.get(q)).body.subscription).toBeNull()
    })

    it('cizí odběr se chová jako neexistující (nejde přečíst, změnit ani smazat) a zařízení převezme poslední přihlášený', async () => {
      const device = newDevice()
      await subscribe(bob, device, ['maps'])
      const q = `/push/subscription?endpoint=${encodeURIComponent(device.endpoint)}`
      expect((await carol.client.get(q)).body.subscription).toBeNull()
      expect((await carol.client.patch('/push/subscription', { endpoint: device.endpoint, categories: ['dm'] })).status).toBe(404)
      expect((await carol.client.delete(q)).status).toBe(204)
      expect((await bob.client.get(q)).body.subscription.categories).toEqual(['maps'])

      // sdílený telefon: carol se přihlásí a zařízení převezme, bob už nic nedostane; volbu bobovi nezdědí
      expect((await subscribe(carol, device)).categories).toHaveLength(4)
      expect((await bob.client.get(q)).body.subscription).toBeNull()
      expect((await carol.client.get(q)).body.subscription).not.toBeNull()
      await carol.client.delete(q)
    })

    it('zkušební push: bez zařízení 422, jinak dorazí a je správně šifrovaný', async () => {
      expect((await eve.client.post('/push/test', {})).status).toBe(422)
      const device = newDevice()
      await subscribe(eve, device, [])
      const res = await eve.client.post('/push/test', {})
      expectStatus(res, 200)
      expect(res.body).toEqual({ sent: 1, failed: 0 })
      const [msg] = await waitFor(device, 1)
      const payload = decrypt(device, msg!.body)
      expect(payload.body).toContain('fungují')
      expect(msg!.headers['content-encoding']).toBe('aes128gcm')
      verifyVapid(msg!.headers.authorization!, publicKey, MOCK)
      await eve.client.delete(`/push/subscription?endpoint=${encodeURIComponent(device.endpoint)}`)
    })

    it('zrušené zařízení (410) server z odběrů smaže', async () => {
      const device = newDevice('gone')
      await subscribe(eve, device)
      const res = await eve.client.post('/push/test', {})
      expect(res.body).toEqual({ sent: 0, failed: 1 })
      expect((await eve.client.get(`/push/subscription?endpoint=${encodeURIComponent(device.endpoint)}`)).body.subscription).toBeNull()
    })
  })

  describe('co se posílá', () => {
    let bobDevice: Device
    let carolDevice: Device

    beforeAll(async () => {
      bobDevice = newDevice('bob')
      carolDevice = newDevice('carol')
      await subscribe(bob, bobDevice)
      await subscribe(carol, carolDevice, ['maps'])
    })

    it('zpráva do skupiny: dostane ji každý, kdo má zapnuté zprávy, odesílatel ne; obsah je šifrovaný a podepsaný', async () => {
      expectStatus(await say(dm, 'all', 'Sejdeme se v krčmě'), 201)
      const [msg] = await waitFor(bobDevice, 1)
      expect(msg).toBeDefined()
      const payload = decrypt(bobDevice, msg!.body)
      expect(payload.title).toBe('Push kampaň')
      expect(payload.body).toBe(`${(await dm.client.get('/auth/me')).body.user.displayName}: Sejdeme se v krčmě`)
      expect(payload.url).toBe(`campaigns/${campaignId}/messages`)
      expect(payload.category).toBe('messages')
      expect(payload.tag).toBe(`msg-${campaignId}-group`)
      expect(msg!.headers.ttl).toBe('86400')
      verifyVapid(msg!.headers.authorization!, publicKey, MOCK)
      // carol má jen mapy
      expect(await received(carolDevice)).toHaveLength(0)
    })

    it('soukromá zpráva dojde jen adresátovi; tajná zpráva a zpráva v jazyce neprozradí text', async () => {
      const before = (await received(bobDevice)).length
      expectStatus(await say(dm, [carol.id], 'Jen pro Carol'), 201)
      expectStatus(await say(dm, [bob.id, carol.id], 'Tajná věc o drakovi'), 201)
      const list = await waitFor(bobDevice, before + 1)
      expect(list).toHaveLength(before + 1)
      const payload = decrypt(bobDevice, list.at(-1)!.body)
      expect(payload.tag).toBe(`msg-${campaignId}-secret`)
      expect(payload.body).toMatch(/^Nová tajná zpráva od /)
      expect(JSON.stringify(payload)).not.toContain('drakovi')
      expect(JSON.stringify(payload)).not.toContain('Carol')
    })

    it('hráč píše DM: DM bez odběru nic nedostane, ostatní hráči taky ne', async () => {
      const before = (await received(bobDevice)).length
      expectStatus(await say(carol, [dm.id], 'Pro DM'), 201)
      await new Promise((r) => setTimeout(r, 800))
      expect(await received(bobDevice)).toHaveLength(before)
    })

    it('změny od DM (item, peníze) přijdou jako push v kategorii dm; carol ji vypnutou nemá', async () => {
      const char = (await bob.client.post(`/campaigns/${campaignId}/characters`, { ...CHARACTER, name: 'Bob' })).body.character.id
      const before = (await received(bobDevice)).length
      expectStatus(await dm.client.post(`/campaigns/${campaignId}/dm/currency`, { characterIds: [char], currency: { gp: 5 } }), 200)
      const list = await waitFor(bobDevice, before + 1)
      const payload = decrypt(bobDevice, list.at(-1)!.body)
      expect(payload.category).toBe('dm')
      expect(payload.body).toContain('5')
      expect(payload.url).toBe(`characters/${char}`)
      expect(await received(carolDevice)).toHaveLength(0)
    })

    it('zveřejnění mapy dostanou hráči s kategorií maps, skrytí a další úprava ne', async () => {
      const map = (await dm.client.upload(`/campaigns/${campaignId}/maps`, 'image', makePng(50, 50), 'm.png', 'image/png', { name: 'Jeskyně' })).body.map.id
      // nová mapa je skrytá, nikdo se nic nedozví
      const beforeBob = (await received(bobDevice)).length
      await new Promise((r) => setTimeout(r, 600))
      expect(await received(carolDevice)).toHaveLength(0)
      expect(await received(bobDevice)).toHaveLength(beforeBob)

      expectStatus(await dm.client.patch(`/maps/${map}`, { visible: true }), 200)
      const [msg] = await waitFor(carolDevice, 1)
      const payload = decrypt(carolDevice, msg!.body)
      expect(payload.body).toBe('DM zveřejnil mapu: Jeskyně')
      expect(payload.url).toBe(`campaigns/${campaignId}/maps/${map}`)
      expect(payload.category).toBe('maps')

      // přejmenování ani opětovné nastavení viditelnosti push nevyvolá
      expectStatus(await dm.client.patch(`/maps/${map}`, { name: 'Jeskyně 2', visible: true }), 200)
      await new Promise((r) => setTimeout(r, 800))
      expect(await received(carolDevice)).toHaveLength(1)
    })

    it('nový zápis DM v deníku dostanou jen ti, kdo ho vidí; soukromé a DM zápisy push nemají', async () => {
      const dev = newDevice('journal')
      await subscribe(bob, dev, ['journal'])
      expectStatus(await dm.client.post(`/campaigns/${campaignId}/journal`, { title: 'Jen pro DM', visibility: 'dm' }), 201)
      expectStatus(await bob.client.post(`/campaigns/${campaignId}/journal`, { title: 'Moje poznámka' }), 201)
      expectStatus(await dm.client.post(`/campaigns/${campaignId}/journal`, { title: 'Jen pro Carol', visibility: 'selected', viewerIds: [carol.id] }), 201)
      await expectNothing(dev)
      expectStatus(await dm.client.post(`/campaigns/${campaignId}/journal`, { title: 'Pro všechny' }), 201)
      const [msg] = await waitFor(dev, 1)
      expect(decrypt(dev, msg!.body).body).toBe('Nový zápis v deníku: Pro všechny')
      await bob.client.delete(`/push/subscription?endpoint=${encodeURIComponent(dev.endpoint)}`)
    })

    it('hody kostkou push nikdy neposílají', async () => {
      const before = (await received(bobDevice)).length
      expectStatus(await dm.client.post(`/campaigns/${campaignId}/rolls`, { expression: '1d20' }), 201)
      expectStatus(await carol.client.post(`/campaigns/${campaignId}/rolls`, { expression: '2d6+1' }), 201)
      await new Promise((r) => setTimeout(r, 800))
      expect(await received(bobDevice)).toHaveLength(before)
    })

    it('cizinec z jiné kampaně a uživatel mimo kampaň žádný push nedostane', async () => {
      const dev = newDevice('eve')
      await subscribe(eve, dev)
      await say(dm, 'all', 'Ahoj všem')
      await expectNothing(dev)
      await eve.client.delete(`/push/subscription?endpoint=${encodeURIComponent(dev.endpoint)}`)
    })
  })

  describe('otevřená aplikace', () => {
    it('kdo má aplikaci otevřenou (dotazuje /summary), push nedostane; po zavření zase ano', async () => {
      const dev = newDevice('open')
      await subscribe(carol, dev, ['messages'])
      expectStatus(await carol.client.get('/summary'), 200)
      expectStatus(await say(dm, 'all', 'Teď jsi online'), 201)
      await expectNothing(dev, 1200)

      // push_presence_seconds je v testech 3 s
      await new Promise((r) => setTimeout(r, 3200))
      expectStatus(await say(dm, 'all', 'Teď jsi pryč'), 201)
      const list = await waitFor(dev, 1)
      expect(list).toHaveLength(1)
      expect(decrypt(dev, list[0]!.body).body).toContain('Teď jsi pryč')
      await carol.client.delete(`/push/subscription?endpoint=${encodeURIComponent(dev.endpoint)}`)
    }, 20_000)

    it('stejná notifikace (štítek) se v jedné odpovědi nezdvojí: DM dá item dvěma postavám téhož hráče jednou', async () => {
      const dev = newDevice('dup')
      const player = await joinAsPlayer(dm, campaignId, 'dup')
      await subscribe(player, dev, ['dm'])
      const a = (await player.client.post(`/campaigns/${campaignId}/characters`, { ...CHARACTER, name: 'A' })).body.character.id
      const b = (await player.client.post(`/campaigns/${campaignId}/characters`, { ...CHARACTER, name: 'B' })).body.character.id
      expectStatus(await dm.client.post(`/campaigns/${campaignId}/dm/currency`, { characterIds: [a, b], currency: { gp: 1 } }), 200)
      await waitFor(dev, 1)
      await new Promise((r) => setTimeout(r, 800))
      // dvě oznámení pro různé postavy mají stejný štítek kampaně, takže zařízení dostane jen jedno (poslední)
      expect(await received(dev)).toHaveLength(1)
    })
  })

  describe('selhání nesmí uškodit', () => {
    it('chyba push služby (500) nezpůsobí chybu požadavku, kvůli kterému push vznikl', async () => {
      const dev = newDevice('fail')
      await subscribe(carol, dev, ['messages'])
      await new Promise((r) => setTimeout(r, 3200))
      const res = await say(dm, 'all', 'Služba padá')
      expectStatus(res, 201)
      expect(res.body.message.body).toBe('Služba padá')
      expect((await waitFor(dev, 1)).length).toBeGreaterThan(0)
      // odběr zůstane (500 není „zařízení zrušeno“)
      expect((await carol.client.get(`/push/subscription?endpoint=${encodeURIComponent(dev.endpoint)}`)).body.subscription).not.toBeNull()
    }, 20_000)
  })
})
