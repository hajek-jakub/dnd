import { beforeAll, describe, expect, it } from 'vitest'
import { Client, createCampaign, joinAsPlayer, registerUser, type TestUser } from './client'

describe('souhrn pro hlavičku a komprese odpovědí', () => {
  let dm: TestUser
  let bob: TestUser
  let campaignId: string

  beforeAll(async () => {
    dm = await registerUser('sumdm')
    campaignId = await createCampaign(dm, 'Souhrn')
    bob = await joinAsPlayer(dm, campaignId, 'bob')
  })

  it('/summary vrací přesně to, co původní tři trasy, a jen přihlášenému', async () => {
    await dm.client.post(`/campaigns/${campaignId}/messages`, { to: 'all', body: 'Ahoj' })
    await dm.client.post(`/campaigns/${campaignId}/journal`, { topic: 'Příběh', title: 'Zápis', body: 'x' })
    const summary = (await bob.client.get('/summary')).body
    expect(summary.notifications).toEqual((await bob.client.get('/notifications')).body)
    expect(summary.messages).toEqual((await bob.client.get('/messages/unread')).body)
    expect(summary.journal).toEqual((await bob.client.get('/journal/unread')).body)
    expect(summary.messages.total).toBeGreaterThanOrEqual(1)
    expect((await new Client().get('/summary')).status).toBe(401)
  })

  it('větší odpovědi se komprimují (gzip) a menší ne; bez Accept-Encoding gzip nic nekomprimuje', async () => {
    const big = await bob.client.raw('/rules/engine', { 'Accept-Encoding': 'gzip' })
    expect(big.status).toBe(200)
    expect(big.headers.get('content-encoding')).toBe('gzip')
    expect(big.headers.get('vary')).toContain('Accept-Encoding')
    expect(JSON.parse(new TextDecoder().decode(big.bytes)).classes.length).toBeGreaterThan(5)

    const plain = await bob.client.raw('/rules/engine', { 'Accept-Encoding': 'identity' })
    expect(plain.headers.get('content-encoding')).toBeNull()
    expect(JSON.parse(new TextDecoder().decode(plain.bytes))).toEqual(JSON.parse(new TextDecoder().decode(big.bytes)))

    const small = await bob.client.raw('/auth/me', { 'Accept-Encoding': 'gzip' })
    expect(small.headers.get('content-encoding')).toBeNull()
  })

  it('pravidla pro engine mají ETag a při shodě vrátí 304 bez těla', async () => {
    const first = await bob.client.raw('/rules/engine')
    const etag = first.headers.get('etag')
    expect(etag).toMatch(/^"[0-9a-f]{32}"$/)
    expect(first.headers.get('cache-control')).toContain('max-age=600')
    const again = await bob.client.raw('/rules/engine', { 'If-None-Match': etag! })
    expect(again.status).toBe(304)
    expect(again.bytes.length).toBe(0)
    expect((await bob.client.raw('/rules/engine', { 'If-None-Match': '"jiny"' })).status).toBe(200)
    // bez přihlášení se nic nevrátí ani s platným ETagem
    expect((await new Client().raw('/rules/engine', { 'If-None-Match': etag! })).status).toBe(401)
  })
})
