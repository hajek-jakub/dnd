import { beforeAll, describe, expect, it } from 'vitest'
import { Client, createCampaign, expectStatus, joinAsPlayer, registerUser, testDbExec, type TestUser } from './client'

const THUMB = '\u{1F44D}'
const HEART = '\u{2764}\u{FE0F}'

describe('chat: reakce, odpovědi, úprava a smazání zpráv', () => {
  let dm: TestUser
  let bob: TestUser
  let carol: TestUser
  let dave: TestUser
  let eve: TestUser
  let campaignId: string

  const send = (user: TestUser, to: unknown, body = 'Ahoj', extra: Record<string, unknown> = {}) => user.client.post(`/campaigns/${campaignId}/messages`, { to, body, ...extra })
  const list = async (user: TestUser, query = '') => (await user.client.get(`/campaigns/${campaignId}/messages${query}`)).body as { messages: any[]; unread: Record<string, number>; marks?: any[] }
  const find = async (user: TestUser, id: number) => (await list(user)).messages.find((m) => m.id === id)
  const msg = async (user: TestUser, to: unknown, body = 'Ahoj', extra: Record<string, unknown> = {}) => {
    const res = await send(user, to, body, extra)
    expectStatus(res, 201)
    return res.body.message as any
  }
  const react = (user: TestUser, id: number | string, emoji: string) => user.client.post(`/messages/${id}/reactions`, { emoji })

  beforeAll(async () => {
    dm = await registerUser('dm')
    campaignId = await createCampaign(dm, 'Chat')
    bob = await joinAsPlayer(dm, campaignId, 'bob')
    carol = await joinAsPlayer(dm, campaignId, 'carol')
    dave = await joinAsPlayer(dm, campaignId, 'dave')
    eve = await registerUser('eve')
  })

  describe('reakce', () => {
    it('člen kampaně reaguje na skupinovou zprávu, jedna reakce na člověka (jiné emoji ji nahradí, stejné zruší), vidí to všichni', async () => {
      const m = await msg(bob, 'all', 'Reaguj na mě')
      expect(m).toMatchObject({ reactions: [], replyTo: null, editedAt: null, deletedAt: null })
      const r1 = await react(carol, m.id, THUMB)
      expectStatus(r1, 200)
      expect(r1.body.reactions).toEqual([{ emoji: THUMB, users: [{ id: carol.id, name: expect.any(String) }] }])
      await react(dm, m.id, THUMB)
      let seen = (await find(bob, m.id)).reactions
      expect(seen).toHaveLength(1)
      expect(seen[0].users.map((u: any) => u.id).sort()).toEqual([carol.id, dm.id].sort())
      // jiné emoji předchozí reakci nahradí
      await react(dm, m.id, HEART)
      seen = (await find(bob, m.id)).reactions
      expect(seen.map((r: any) => [r.emoji, r.users.map((u: any) => u.id)])).toEqual([
        [THUMB, [carol.id]],
        [HEART, [dm.id]],
      ])
      // znovu totéž emoji = zrušení
      const r2 = await react(carol, m.id, THUMB)
      expect(r2.body.reactions.map((r: any) => r.emoji)).toEqual([HEART])
      await react(dm, m.id, HEART)
      expect((await find(bob, m.id)).reactions).toEqual([])
    })

    it('libovolné jedno emoji (vlastní jako na Messengeru), text ani víc emoji ne; na neexistující a cizí zprávy ne', async () => {
      const m = await msg(bob, 'all')
      for (const emoji of ['\u{1F4A9}', '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}', '\u{1F1E8}\u{1F1FF}', '\u{1F44D}\u{1F3FD}', '1\uFE0F\u20E3', '\u{1F409}']) {
        const res = await react(bob, m.id, emoji)
        expectStatus(res, 200)
        expect(res.body.reactions).toEqual([{ emoji, users: [expect.objectContaining({ id: bob.id })] }])
      }
      for (const bad of ['x', '<b>', THUMB + THUMB, 'a' + THUMB, '', '1', '#', '\u200D', 'abcdefghijklmnopq', 12]) expectStatus(await react(bob, m.id, bad as string), 422)
      expectStatus(await bob.client.post(`/messages/${m.id}/reactions`, {}), 422)
      expect((await find(bob, m.id)).reactions).toHaveLength(1)
      expectStatus(await react(bob, 999999999, THUMB), 404)
      expectStatus(await react(bob, 'abc', THUMB), 404)
      expectStatus(await react(eve, m.id, THUMB), 404)
      expect((await new Client().post(`/messages/${m.id}/reactions`, { emoji: THUMB })).status).toBe(401)
    })

    it('na soukromou zprávu reaguje jen ten, kdo ji vidí', async () => {
      const m = await msg(bob, [dm.id], 'Soukromě pro DM')
      expectStatus(await react(carol, m.id, THUMB), 404)
      expectStatus(await react(dave, m.id, THUMB), 404)
      expectStatus(await react(eve, m.id, THUMB), 404)
      expectStatus(await react(dm, m.id, THUMB), 200)
      expect((await find(bob, m.id)).reactions).toHaveLength(1)
      expect(await find(carol, m.id)).toBeUndefined()
    })

    it('průběžné dotazování vrací aktuální stav změněných zpráv (marks), a jen těch, které se mění', async () => {
      const m = await msg(bob, 'all', 'Sledovaná')
      const plain = await msg(bob, 'all', 'Beze změny')
      const start = (await list(carol)).messages.at(-1).id
      await react(dm, m.id, THUMB)
      const polled = await list(carol, `?after=${start}&from=${m.id}`)
      expect(polled.messages).toEqual([])
      const mark = polled.marks!.find((x) => x.id === m.id)
      expect(mark).toMatchObject({ editedAt: null, deletedAt: null, reactions: [{ emoji: THUMB }] })
      expect(polled.marks!.some((x) => x.id === plain.id)).toBe(false)
      // bez from klient žádné marks nedostane
      expect((await list(carol, `?after=${start}`)).marks).toBeUndefined()
      // po zrušení reakce zpráva v marks chybí (klient jí smaže reakce)
      await react(dm, m.id, THUMB)
      expect((await list(carol, `?after=${start}&from=${m.id}`)).marks!.some((x) => x.id === m.id)).toBe(false)
      // upravená zpráva v marks zůstane s novým textem
      await bob.client.patch(`/messages/${m.id}`, { body: 'Sledovaná (nová verze)' })
      const edited = (await list(carol, `?after=${start}&from=${m.id}`)).marks!.find((x) => x.id === m.id)
      expect(edited).toMatchObject({ body: 'Sledovaná (nová verze)', editedAt: expect.any(String) })
    })

    it('marks neprozradí zprávy, které uživatel nevidí', async () => {
      const m = await msg(bob, [dm.id], 'Soukromá s reakcí')
      await react(dm, m.id, HEART)
      const polled = await list(carol, `?after=${m.id}&from=${m.id}`)
      expect(polled.marks!.some((x) => x.id === m.id)).toBe(false)
      expect((await list(bob, `?after=${m.id}&from=${m.id}`)).marks!.some((x) => x.id === m.id)).toBe(true)
    })
  })

  describe('odpovědi', () => {
    it('odpověď nese údaje původní zprávy a jde jen na zprávu ve stejném vlákně', async () => {
      const original = await msg(bob, 'all', 'Co  dnes\nhrajeme?')
      const reply = await msg(carol, 'all', 'Myslím že dungeon', { replyToId: original.id })
      expect(reply.replyTo).toMatchObject({ id: original.id, senderName: expect.any(String), snippet: 'Co dnes hrajeme?', deleted: false, hidden: false })
      expect((await find(dave, reply.id)).replyTo).toMatchObject({ id: original.id, snippet: 'Co dnes hrajeme?' })
      // jiné vlákno
      const priv = await msg(bob, [dm.id], 'Soukromě')
      expectStatus(await send(bob, 'all', 'x', { replyToId: priv.id }), 422)
      expectStatus(await send(bob, [dm.id], 'x', { replyToId: original.id }), 422)
    })

    it('na neexistující, neviditelnou, cizí a smazanou zprávu a na špatný tvar odpovědět nejde', async () => {
      const priv = await msg(bob, [dm.id], 'Jen Bob a DM')
      expectStatus(await send(carol, [dm.id], 'x', { replyToId: priv.id }), 422) // carol zprávu nevidí
      expectStatus(await send(bob, 'all', 'x', { replyToId: 987654321 }), 422)
      for (const bad of ['1', 0, -5, 1.5, [], {}, true]) expectStatus(await send(bob, 'all', 'x', { replyToId: bad }), 422)
      const other = await createCampaign(dm, 'Jiná chat')
      const foreign = (await dm.client.post(`/campaigns/${other}/messages`, { to: 'all', body: 'jiná kampaň' })).body.message
      expectStatus(await send(bob, 'all', 'x', { replyToId: foreign.id }), 422)
      const gone = await msg(bob, 'all', 'Zmizí')
      expectStatus(await bob.client.delete(`/messages/${gone.id}`), 200)
      expectStatus(await send(carol, 'all', 'x', { replyToId: gone.id }), 422)
      expectStatus(await send(carol, 'all', 'x', { replyToId: null }), 201)
    })

    it('odpověď neprozradí text původní zprávy tomu, kdo ji nevidí (tajné zprávy)', async () => {
      const first = await msg(dm, [bob.id, carol.id], 'Tajemství pro Boba a Carol')
      expect(first.thread).toBe('secret')
      const reply = await msg(dm, [carol.id, dave.id], 'Navazuji', { replyToId: first.id })
      expect((await find(carol, reply.id)).replyTo).toMatchObject({ hidden: false, snippet: 'Tajemství pro Boba a Carol' })
      const daves = (await find(dave, reply.id)).replyTo
      expect(daves).toMatchObject({ id: first.id, hidden: true, snippet: '', senderName: '' })
      expect(JSON.stringify(await find(dave, reply.id))).not.toContain('Tajemství')
    })

    it('odpověď po úpravě a smazání původní zprávy ukazuje aktuální stav', async () => {
      const original = await msg(bob, 'all', 'Původní')
      const reply = await msg(carol, 'all', 'Odpověď', { replyToId: original.id })
      await bob.client.patch(`/messages/${original.id}`, { body: 'Opravená' })
      expect((await find(dave, reply.id)).replyTo.snippet).toBe('Opravená')
      await bob.client.delete(`/messages/${original.id}`)
      expect((await find(dave, reply.id)).replyTo).toMatchObject({ deleted: true, snippet: '' })
    })
  })

  describe('úprava', () => {
    it('autor upraví svou zprávu, ostatní (i DM) ne; text zůstane beze změny', async () => {
      const m = await msg(bob, 'all', 'Překlep')
      const res = await bob.client.patch(`/messages/${m.id}`, { body: '<b>Oprava</b> bez překlepu' })
      expectStatus(res, 200)
      expect(res.body.message).toMatchObject({ id: m.id, body: '<b>Oprava</b> bez překlepu', editedAt: expect.any(String), deletedAt: null })
      expect((await find(carol, m.id)).editedAt).toBeTruthy()
      for (const u of [carol, dm]) expectStatus(await u.client.patch(`/messages/${m.id}`, { body: 'Hacknuto' }), 403)
      expect((await find(carol, m.id)).body).toBe('<b>Oprava</b> bez překlepu')
    })

    it('stejný text nemění čas úpravy, neviditelné zprávy jsou 404, špatné vstupy 422', async () => {
      const m = await msg(bob, 'all', 'Beze změny')
      expectStatus(await bob.client.patch(`/messages/${m.id}`, { body: 'Beze změny' }), 200)
      expect((await find(bob, m.id)).editedAt).toBeNull()
      const priv = await msg(bob, [dm.id], 'Soukromá')
      expectStatus(await carol.client.patch(`/messages/${priv.id}`, { body: 'x' }), 404)
      expectStatus(await eve.client.patch(`/messages/${m.id}`, { body: 'x' }), 404)
      expect((await new Client().patch(`/messages/${m.id}`, { body: 'x' })).status).toBe(401)
      expectStatus(await bob.client.patch(`/messages/${m.id}`, { body: '' }), 422)
      expectStatus(await bob.client.patch(`/messages/${m.id}`, { body: '   ' }), 422)
      expectStatus(await bob.client.patch(`/messages/${m.id}`, { body: 'x'.repeat(4001) }), 422)
      expectStatus(await bob.client.patch(`/messages/${m.id}`, {}), 422)
      expectStatus(await bob.client.patch('/messages/abc', { body: 'x' }), 404)
    })
  })

  describe('smazání', () => {
    it('autor zprávu smaže: text i reakce zmizí, zpráva zůstane jako smazaná, upravit ani reagovat už nejde', async () => {
      const m = await msg(bob, 'all', 'Tajný text, co zmizí')
      await react(carol, m.id, THUMB)
      const res = await bob.client.delete(`/messages/${m.id}`)
      expectStatus(res, 200)
      expect(res.body.message).toMatchObject({ id: m.id, body: '', reactions: [], deletedAt: expect.any(String) })
      expect(JSON.stringify(await find(dave, m.id))).not.toContain('Tajný text')
      expectStatus(await bob.client.patch(`/messages/${m.id}`, { body: 'oživení' }), 422)
      expectStatus(await react(carol, m.id, THUMB), 422)
      expectStatus(await bob.client.delete(`/messages/${m.id}`), 200) // opakované smazání nevadí
    })

    it('cizí zprávu smaže jen DM (moderace), hráč ne; neviditelnou zprávu nikdo cizí', async () => {
      const m = await msg(bob, 'all', 'Nevhodná zpráva')
      expectStatus(await carol.client.delete(`/messages/${m.id}`), 403)
      expect((await find(bob, m.id)).deletedAt).toBeNull()
      expectStatus(await dm.client.delete(`/messages/${m.id}`), 200)
      expect((await find(bob, m.id)).deletedAt).toBeTruthy()
      const priv = await msg(bob, [dm.id], 'Soukromá')
      expectStatus(await carol.client.delete(`/messages/${priv.id}`), 404)
      expectStatus(await eve.client.delete(`/messages/${m.id}`), 404)
      expect((await new Client().delete(`/messages/${m.id}`)).status).toBe(401)
      expectStatus(await bob.client.delete('/messages/abc'), 404)
    })

    it('DM nesmaže ani neupraví zprávu, kterou nevidí (starší zpráva v jazyce, která mu nebyla adresovaná)', async () => {
      testDbExec("INSERT INTO messages (campaign_id, sender_id, thread, body, created_at) VALUES (?, ?, 'lang:orc', 'Gruumsh', UTC_TIMESTAMP())", [campaignId, bob.id])
      const hidden = (await list(bob)).messages.find((m) => m.body === 'Gruumsh')
      expect(hidden).toBeTruthy()
      expect(await find(dm, hidden.id)).toBeUndefined()
      expectStatus(await dm.client.delete(`/messages/${hidden.id}`), 404)
      expectStatus(await react(dm, hidden.id, THUMB), 404)
      expectStatus(await bob.client.delete(`/messages/${hidden.id}`), 200)
    })

    it('smazaná zpráva se nepočítá mezi nepřečtené', async () => {
      await carol.client.post(`/campaigns/${campaignId}/messages/read`, { thread: 'group' })
      const before = (await list(carol)).unread.group ?? 0
      const m = await msg(bob, 'all', 'Přečíst nestihneš')
      expect((await list(carol)).unread.group).toBe(before + 1)
      expect(((await carol.client.get('/messages/unread')).body as { total: number }).total).toBeGreaterThanOrEqual(1)
      await bob.client.delete(`/messages/${m.id}`)
      expect((await list(carol)).unread.group ?? 0).toBe(before)
    })
  })
})
