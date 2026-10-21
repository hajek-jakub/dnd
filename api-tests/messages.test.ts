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

  describe('zprávy v jazyce (hráči mezi sebou)', () => {
    let cid: string
    let gm: TestUser
    let [p1, p2, p3, p4]: TestUser[] = []

    const character = (user: TestUser, name: string, languages: string[]) =>
      user.client.post(`/campaigns/${cid}/characters`, {
        name,
        abilityScores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
        levels: [{ classIndex: 'fighter', hpRoll: null }],
        extraProficiencies: languages.map((l) => `Language: ${l}`),
      })
    const say = (user: TestUser, language: string, body = 'šeptem') => user.client.post(`/campaigns/${cid}/messages`, { to: { language }, body })
    const read = async (user: TestUser) => (await user.client.get(`/campaigns/${cid}/messages`)).body as { messages: any[]; unread: Record<string, number>; languages: any[] }

    beforeAll(async () => {
      gm = await registerUser('gm')
      cid = await createCampaign(gm, 'Jazyky')
      ;[p1, p2, p3, p4] = [await joinAsPlayer(gm, cid, 'pa'), await joinAsPlayer(gm, cid, 'pb'), await joinAsPlayer(gm, cid, 'pc'), await joinAsPlayer(gm, cid, 'pd')]
      expectStatus(await character(p1, 'Aja', ['Orc', 'Elvish']), 201)
      expectStatus(await character(p2, 'Bob', ['Orc']), 201)
      expectStatus(await character(p3, 'Cyra', ['elvish']), 201) // malá písmena nevadí
      expectStatus(await character(p4, 'Dan', []), 201)
      expectStatus(await character(gm, 'NPC Skřet', ['Orc']), 201) // DM jazyky nesdílí
    })

    it('hráč napíše v jazyce: vidí ho jen hráči, kteří jazyk umí (ne DM, ne ostatní)', async () => {
      const res = await say(p1, 'Orc', 'Zradíme ho')
      expectStatus(res, 201)
      expect(res.body.message).toMatchObject({ thread: 'lang:orc', recipients: [{ id: p2.id }] })
      for (const u of [p1, p2]) expect((await read(u)).messages.map((m) => m.body), u.username).toContain('Zradíme ho')
      for (const u of [p3, p4, gm]) expect((await read(u)).messages.map((m) => m.body), u.username).not.toContain('Zradíme ho')
      // odpověď jde jen Aje, DM s NPC se nepočítá
      const reply = await say(p2, 'orc', 'Souhlas')
      expect(reply.body.message.recipients).toEqual([expect.objectContaining({ id: p1.id })])
      expect((await read(p1)).messages.map((m) => m.body)).toContain('Souhlas')
      expect((await read(gm)).messages.map((m) => m.body)).not.toContain('Souhlas')
    })

    it('rozlišuje jazyky (Elvish jde jen k Cyře, i když je zapsaný malými písmeny)', async () => {
      const res = await say(p1, 'Elvish', 'Elfí tajemství')
      expectStatus(res, 201)
      expect(res.body.message).toMatchObject({ thread: 'lang:elvish', recipients: [{ id: p3.id }] })
      expect((await read(p2)).messages.map((m) => m.body)).not.toContain('Elfí tajemství')
      expect((await read(p3)).messages.map((m) => m.body)).toContain('Elfí tajemství')
    })

    it('nezná-li hráč jazyk, nebo je DM, odmítne to', async () => {
      expectStatus(await say(p2, 'Elvish'), 403)
      expectStatus(await say(p4, 'Orc'), 403)
      expectStatus(await say(p1, 'Dwarvish'), 403)
      expectStatus(await say(gm, 'Orc'), 403)
    })

    it('seznam jazyků v odpovědi: moje jazyky a s kým je sdílím', async () => {
      const mine = (await read(p1)).languages
      expect(mine.map((l) => l.slug).sort()).toEqual(['elvish', 'orc'])
      expect(mine.find((l) => l.slug === 'orc')).toMatchObject({ name: 'Orc', speakers: [{ id: p2.id }] })
      expect((await read(p4)).languages).toEqual([])
      expect((await read(gm)).languages).toEqual([])
    })

    it('nepřečtené po vláknu a označení za přečtené', async () => {
      await say(p1, 'Orc', 'ještě jedna')
      const before = (await read(p2)).unread['lang:orc']
      expect(before).toBeGreaterThanOrEqual(1)
      expect((await read(p3)).unread['lang:orc']).toBeUndefined()
      const marked = await p2.client.post(`/campaigns/${cid}/messages/read`, { thread: 'lang:orc' })
      expectStatus(marked, 200)
      expect(marked.body.unread['lang:orc'] ?? 0).toBe(0)
      expectStatus(await p2.client.post(`/campaigns/${cid}/messages/read`, { thread: 'lang:' }), 422)
    })

    it('číselník: zápis s diakritikou, česky nebo malými písmeny se uloží jako jazyk z číselníku a v chatu se shoduje', async () => {
      const pe = await joinAsPlayer(gm, cid, 'pe')
      const pf = await joinAsPlayer(gm, cid, 'pf')
      const stored = await character(pe, 'Eda', ['Skřetština', 'ELVISH'])
      expectStatus(stored, 201)
      expect(stored.body.character.extraProficiencies).toEqual(['Language: Orc', 'Language: Elvish'])
      expectStatus(await character(pf, 'Fík', ['skretstina']), 201)
      expect((await character(pe, 'Eda2', ['Hluboká řeč'])).status).toBe(201)
      // oba se v Orc potkají, i když jeden psal s diakritikou a druhý bez, a hráč smí jazyk zadat i česky
      const res = await say(pe, 'Skřetština', 'Šeptem česky')
      expectStatus(res, 201)
      expect(res.body.message.thread).toBe('lang:orc')
      expect(res.body.message.recipients.map((r: any) => r.id)).toContain(pf.id)
      expect((await read(pf)).messages.map((m) => m.body)).toContain('Šeptem česky')
    })

    it('jazyk mimo číselník se při uložení odmítne a seznam ostatních proficiencies zůstane', async () => {
      const res = await p4.client.patch(`/characters/${(await p4.client.get(`/campaigns/${cid}/characters`)).body.characters.find((c: any) => c.ownerId === p4.id).id}`, { extraProficiencies: ['Language: Klingon'] })
      expectStatus(res, 422)
      expect(res.body.error.message).toContain('Klingon')
      expect(res.body.error.field).toBe('extraProficiencies')
      const ok = await p4.client.patch(`/characters/${(await p4.client.get(`/campaigns/${cid}/characters`)).body.characters.find((c: any) => c.ownerId === p4.id).id}`, { extraProficiencies: ['Simple weapons', 'Language: Thieves Cant', 'Language: hantýrka'] })
      expectStatus(ok, 200)
      expect((await p4.client.get(`/campaigns/${cid}/characters`)).body.characters.find((c: any) => c.ownerId === p4.id).extraProficiencies).toEqual(['Simple weapons', "Language: Thieves' Cant"])
    })

    it('jazyk, který nikdo další neumí, nejde použít', async () => {
      expectStatus(await character(p4, 'Dan2', ['Sylvan']), 201)
      expectStatus(await say(p4, 'Sylvan'), 422)
      expect(JSON.stringify((await read(p4)).languages)).toContain('"speakers":[]')
    })

    it('každý jazyk z číselníku v UI server přijme a uloží pod stejným názvem', async () => {
      const { LANGUAGE_CATALOG } = await import('../src/features/sheet/languages')
      const px = await joinAsPlayer(gm, cid, 'px')
      const created = await character(px, 'Všejazyk', LANGUAGE_CATALOG.map((l) => l.name))
      expectStatus(created, 201)
      expect(created.body.character.extraProficiencies).toEqual(LANGUAGE_CATALOG.map((l) => `Language: ${l.name}`))
    })
  })

  describe('připravené zprávy DM (koncepty)', () => {
    const drafts = (user: TestUser, cid: string = campaignId) => user.client.get(`/campaigns/${cid}/message-drafts`)
    const make = (user: TestUser, body: unknown, cid: string = campaignId) => user.client.post(`/campaigns/${cid}/message-drafts`, body)
    const thread = async (user: TestUser, t: string) => (await list(user)).messages.filter((m) => m.thread === t).map((m) => m.body)

    it('anonym 401, cizinec 404, hráč 403 (vidět, zakládat ani odesílat koncepty smí jen DM)', async () => {
      const anon = new Client()
      expect((await anon.get(`/campaigns/${campaignId}/message-drafts`)).status).toBe(401)
      expect((await anon.post(`/campaigns/${campaignId}/message-drafts`, { body: 'x', to: 'all' })).status).toBe(401)
      expectStatus(await drafts(eve), 404)
      expectStatus(await make(eve, { body: 'x', to: 'all' }), 404)
      expectStatus(await drafts(bob), 403)
      expectStatus(await make(bob, { body: 'x', to: 'all' }), 403)
    })

    it('DM nachystá zprávu pro jednoho, pro víc hráčů i pro všechny a koncept nikdo jiný nevidí ani v seznamu zpráv', async () => {
      const one = await make(dm, { title: 'Vize pro Boba', body: 'Vidíš černého draka.', to: [bob.id] })
      expectStatus(one, 201)
      expect(one.body.draft).toMatchObject({ title: 'Vize pro Boba', body: 'Vidíš černého draka.', toAll: false, sentAt: null, recipients: [{ id: bob.id }] })
      const two = await make(dm, { body: 'Slyšíte kroky.', to: [bob.id, carol.id] })
      expectStatus(two, 201)
      expect(two.body.draft.recipients.map((r: any) => r.id).sort()).toEqual([bob.id, carol.id].sort())
      const all = await make(dm, { body: 'Zvon odbil půlnoc.', to: 'all' })
      expectStatus(all, 201)
      expect(all.body.draft).toMatchObject({ toAll: true, recipients: [] })

      expect((await drafts(dm)).body.drafts.map((d: any) => d.body)).toEqual(expect.arrayContaining(['Vidíš černého draka.', 'Slyšíte kroky.', 'Zvon odbil půlnoc.']))
      // dokud se neodešle, není to zpráva: nikdo (ani DM) ji v seznamu zpráv nemá
      for (const u of [dm, bob, carol, dave]) expect(await bodies(u), u.username).not.toContain('Vidíš černého draka.')
    })

    it('validace: prázdný text, žádní příjemci, DM sám sobě, cizí člověk, nesmysl, příliš dlouhý text', async () => {
      expectStatus(await make(dm, { body: '', to: 'all' }), 422)
      expectStatus(await make(dm, { body: 'x' }), 422)
      expectStatus(await make(dm, { body: 'x', to: [] }), 422)
      expectStatus(await make(dm, { body: 'x', to: [dm.id] }), 422)
      expectStatus(await make(dm, { body: 'x', to: [eve.id] }), 422)
      expectStatus(await make(dm, { body: 'x', to: ['nesmysl'] }), 422)
      expectStatus(await make(dm, { body: 'x'.repeat(4001), to: 'all' }), 422)
      expectStatus(await make(dm, { body: 'x', to: 'all', title: 'n'.repeat(81) }), 422)
    })

    it('odeslání jednomu hráči: soukromé vlákno, vidí ho jen on', async () => {
      const d = (await make(dm, { body: 'Jen pro Boba: dveře jsou zamčené.', to: [bob.id] })).body.draft
      const sent = await dm.client.post(`/message-drafts/${d.id}/send`, {})
      expectStatus(sent, 201)
      expect(sent.body.message).toMatchObject({ thread: `dm:${bob.id}`, senderId: dm.id, body: 'Jen pro Boba: dveře jsou zamčené.', recipients: [{ id: bob.id }] })
      expect(sent.body.draft.sentAt).not.toBeNull()
      expect(await thread(bob, `dm:${bob.id}`)).toContain('Jen pro Boba: dveře jsou zamčené.')
      for (const u of [carol, dave]) expect(await bodies(u), u.username).not.toContain('Jen pro Boba: dveře jsou zamčené.')
    })

    it('odeslání víc hráčům: tajná zpráva jen pro ně', async () => {
      const d = (await make(dm, { body: 'Jen Bob a Carol: poklad je pod oltářem.', to: [bob.id, carol.id] })).body.draft
      const sent = await dm.client.post(`/message-drafts/${d.id}/send`, {})
      expectStatus(sent, 201)
      expect(sent.body.message.thread).toBe('secret')
      for (const u of [bob, carol, dm]) expect(await bodies(u), u.username).toContain('Jen Bob a Carol: poklad je pod oltářem.')
      expect(await bodies(dave)).not.toContain('Jen Bob a Carol: poklad je pod oltářem.')
    })

    it('odeslání všem: skupinová zpráva, koncept zůstane s časem odeslání a po úpravě je zase neodeslaný', async () => {
      const d = (await make(dm, { body: 'Všem: rozednívá se.', to: 'all' })).body.draft
      expectStatus(await dm.client.post(`/message-drafts/${d.id}/send`, {}), 201)
      for (const u of [dm, bob, carol, dave]) expect(await bodies(u), u.username).toContain('Všem: rozednívá se.')
      const stored = (await drafts(dm)).body.drafts.find((x: any) => x.id === d.id)
      expect(stored.sentAt).not.toBeNull()
      const edited = await dm.client.patch(`/message-drafts/${d.id}`, { body: 'Všem: slunce vyšlo.', to: [dave.id] })
      expectStatus(edited, 200)
      expect(edited.body.draft).toMatchObject({ body: 'Všem: slunce vyšlo.', toAll: false, sentAt: null, recipients: [{ id: dave.id }] })
      expectStatus(await dm.client.patch(`/message-drafts/${d.id}`, {}), 422)
      expectStatus(await dm.client.patch(`/message-drafts/${d.id}`, { to: [dm.id] }), 422)
    })

    it('cizí koncept: cizinec i hráč dostanou 404 na úpravu, smazání i odeslání a nic se neodešle', async () => {
      const d = (await make(dm, { body: 'Tajný plán DM.', to: 'all' })).body.draft
      for (const u of [eve, bob]) {
        expectStatus(await u.client.patch(`/message-drafts/${d.id}`, { body: 'přepsáno' }), 404)
        expectStatus(await u.client.delete(`/message-drafts/${d.id}`), 404)
        expectStatus(await u.client.post(`/message-drafts/${d.id}/send`, {}), 404)
      }
      expect(await bodies(bob)).not.toContain('Tajný plán DM.')
      expect((await drafts(dm)).body.drafts.find((x: any) => x.id === d.id).body).toBe('Tajný plán DM.')
      // DM jiné kampaně (eve) svůj koncept založí, ale ten první nevidí
      const evesCampaign = await createCampaign(eve, 'Evina')
      expect((await drafts(eve, evesCampaign)).body.drafts).toEqual([])
      expectStatus(await dm.client.delete(`/message-drafts/${d.id}`), 204)
      expectStatus(await dm.client.post(`/message-drafts/${d.id}/send`, {}), 404)
    })

    it('hráč, který mezitím z kampaně odešel, zprávu nedostane; když nezbyde nikdo, odeslání se odmítne', async () => {
      const zed = await joinAsPlayer(dm, campaignId, 'zed')
      const both = (await make(dm, { body: 'Pro Zeda a Boba.', to: [zed.id, bob.id] })).body.draft
      const onlyZed = (await make(dm, { body: 'Jen pro Zeda.', to: [zed.id] })).body.draft
      expectStatus(await dm.client.delete(`/campaigns/${campaignId}/members/${zed.id}`), 204)

      const stored = (await drafts(dm)).body.drafts
      expect(stored.find((x: any) => x.id === both.id).recipients.map((r: any) => r.id)).toEqual([bob.id])
      expect(stored.find((x: any) => x.id === onlyZed.id).recipients).toEqual([])

      const sent = await dm.client.post(`/message-drafts/${both.id}/send`, {})
      expectStatus(sent, 201)
      expect(sent.body.message).toMatchObject({ thread: `dm:${bob.id}`, recipients: [{ id: bob.id }] })
      expectStatus(await dm.client.post(`/message-drafts/${onlyZed.id}/send`, {}), 422)
      expect(await bodies(dm)).not.toContain('Jen pro Zeda.')
    })

    it('koncepty zmizí s kampaní', async () => {
      const c = await createCampaign(dm, 'Koncepty k smazání')
      expectStatus(await make(dm, { body: 'x', to: 'all' }, c), 201)
      expectStatus(await dm.client.delete(`/campaigns/${c}`), 204)
      expectStatus(await drafts(dm, c), 404)
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
