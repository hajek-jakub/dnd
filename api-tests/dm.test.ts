import { beforeAll, describe, expect, it } from 'vitest'
import { Client, createCampaign, expectStatus, joinAsPlayer, registerUser, type TestUser } from './client'

const BASE = { abilityScores: { str: 10, dex: 14, con: 12, int: 10, wis: 10, cha: 10 }, levels: [{ classIndex: 'fighter' }] }

describe('DM panel a oznámení', () => {
  let dm: TestUser
  let bob: TestUser
  let carol: TestUser
  let dave: TestUser
  let campaignId: string
  let otherCampaignId: string
  let bobChar: string
  let carolChar: string
  let foreignChar: string

  const dmPost = (path: string, body: unknown, user: TestUser = dm, cid: string = campaignId) => user.client.post(`/campaigns/${cid}/dm/${path}`, body)
  const sheet = async (user: TestUser, id: string) => (await user.client.get(`/characters/${id}`)).body.character
  const notes = async (user: TestUser) => (await user.client.get('/notifications')).body as { notifications: { id: number; text: string; read: boolean; kind: string }[]; unread: number }

  beforeAll(async () => {
    dm = await registerUser('dm')
    campaignId = await createCampaign(dm, 'DM panel')
    otherCampaignId = await createCampaign(dm, 'Jiná')
    bob = await joinAsPlayer(dm, campaignId, 'bob')
    carol = await joinAsPlayer(dm, campaignId, 'carol')
    dave = await registerUser('dave')
    bobChar = (await bob.client.post(`/campaigns/${campaignId}/characters`, { ...BASE, name: 'Bob' })).body.character.id
    carolChar = (await carol.client.post(`/campaigns/${campaignId}/characters`, { ...BASE, name: 'Carol' })).body.character.id
    foreignChar = (await dm.client.post(`/campaigns/${otherCampaignId}/characters`, { ...BASE, name: 'Jinde' })).body.character.id
  })

  describe('oprávnění', () => {
    const endpoints: [string, unknown][] = [
      ['items', { item: { name: 'Dar' } }],
      ['currency', { currency: { gp: 1 } }],
      ['inspiration', { set: true }],
      ['hp', { delta: -1, targets: [] }],
      ['conditions', { name: 'Poisoned', set: true }],
      ['temp-hp', { amount: 5 }],
      ['effects', { target: 'ac', value: 1, source: 'x' }],
    ]
    it.each(endpoints)('hráč nemůže volat dm/%s (403), cizinec 404', async (path, body) => {
      const payload = { characterIds: [bobChar], ...(body as object) }
      expect((await dmPost(path, payload, bob)).status).toBe(403)
      expect((await dmPost(path, payload, dave)).status).toBe(404)
    })

    it('DM nemůže zasáhnout postavy z jiné kampaně ani neexistující', async () => {
      expect((await dmPost('inspiration', { characterIds: [foreignChar], set: true })).status).toBe(422)
      expect((await dmPost('inspiration', { characterIds: [bobChar, foreignChar], set: true })).status).toBe(422)
      expect((await dmPost('inspiration', { characterIds: ['00000000-0000-0000-0000-000000000000'], set: true })).status).toBe(422)
      expect((await dmPost('inspiration', { characterIds: [], set: true })).status).toBe(422)
      expect((await dmPost('inspiration', { characterIds: ['x'], set: true })).status).toBe(422)
      expect((await sheet(dm, bobChar)).inspiration).toBe(false) // nic se nezměnilo ani u platné postavy ve smíšeném výběru
    })

    it('DM jiné kampaně nemůže zasahovat do cizí kampaně', async () => {
      const otherDm = await registerUser('dm2')
      const otherCampaign = await createCampaign(otherDm, 'Cizí')
      expect((await dmPost('inspiration', { characterIds: [bobChar], set: true }, otherDm, campaignId)).status).toBe(404)
      expect((await dmPost('inspiration', { characterIds: [bobChar], set: true }, otherDm, otherCampaign)).status).toBe(422) // postava není v jeho kampani
    })
  })

  describe('rozdávání', () => {
    it('item z pravidel, vlastní jednorázový item a množství; hráč dostane oznámení', async () => {
      const bag = (await dm.client.get('/rules?kinds=magic_item&q=Bag%20of%20Holding')).body.entries.find((e: { name: string }) => e.name === 'Bag of Holding').id
      expectStatus(await dmPost('items', { characterIds: [bobChar, carolChar], item: { ruleId: bag } }), 200)
      expect((await sheet(bob, bobChar)).items.map((i: { name: string }) => i.name)).toContain('Bag of Holding')
      expect((await sheet(carol, carolChar)).items.map((i: { name: string }) => i.name)).toContain('Bag of Holding')

      expectStatus(await dmPost('items', { characterIds: [bobChar], item: { name: 'Zlatý klíč', quantity: 3 } }), 200)
      const key = (await sheet(bob, bobChar)).items.find((i: { name: string }) => i.name === 'Zlatý klíč')
      expect(key).toMatchObject({ quantity: 3 })

      const n = await notes(bob)
      expect(n.notifications.map((x) => x.text)).toEqual(expect.arrayContaining(['DM ti dal: Bag of Holding', 'DM ti dal: Zlatý klíč ×3']))
      expect(n.unread).toBeGreaterThanOrEqual(2)
      expect((await notes(carol)).notifications.map((x) => x.text)).toContain('DM ti dal: Bag of Holding')
    })

    it('neplatný item se odmítne a nic se nezapíše', async () => {
      const before = (await sheet(bob, bobChar)).items.length
      expect((await dmPost('items', { characterIds: [bobChar, carolChar], item: { name: '' } })).status).toBe(422)
      expect((await dmPost('items', { characterIds: [bobChar], item: { ruleId: 'neni-uuid' } })).status).toBe(404)
      expect((await dmPost('items', { characterIds: [bobChar] })).status).toBe(422)
      expect((await sheet(bob, bobChar)).items).toHaveLength(before)
    })

    it('peníze se přičtou všem vybraným a oznámí se', async () => {
      expectStatus(await dmPost('currency', { characterIds: [bobChar, carolChar], currency: { gp: 50, sp: 5 } }), 200)
      expect((await sheet(bob, bobChar)).currency).toEqual({ cp: 0, sp: 5, ep: 0, gp: 50, pp: 0 })
      await dmPost('currency', { characterIds: [bobChar], currency: { gp: 10 } })
      expect((await sheet(bob, bobChar)).currency.gp).toBe(60)
      expect((await notes(bob)).notifications.map((x) => x.text)).toContain('DM ti dal peníze: 50 gp, 5 sp')
      expect((await dmPost('currency', { characterIds: [bobChar], currency: { gp: -5 } })).status).toBe(422)
      expect((await dmPost('currency', { characterIds: [bobChar], currency: {} })).status).toBe(422)
    })

    it('peníze: rozdělit rovným dílem (mince po druzích, zbytek v mědácích), důvod v oznámení', async () => {
      const cp = async (who: typeof bob, id: string) => {
        const w = (await sheet(who, id)).currency
        return w.cp + w.sp * 10 + w.ep * 50 + w.gp * 100 + w.pp * 1000
      }
      const [b0, c0] = [await cp(bob, bobChar), await cp(carol, carolChar)]
      // 11 gp + 1 sp mezi 2: 5 gp každému, zbylý 1 gp a 1 sp (110 cp) = 55 cp každému
      const res = await dmPost('currency', { characterIds: [bobChar, carolChar], currency: { gp: 11, sp: 1 }, split: true, reason: 'odměna' })
      expectStatus(res, 200)
      expect(res.body).toMatchObject({ given: 2, mode: 'give', each: { pp: 0, gp: 5, ep: 0, sp: 5, cp: 5 }, eachCp: 555, leftoverCp: 0 })
      expect(await cp(bob, bobChar)).toBe(b0 + 555)
      expect(await cp(carol, carolChar)).toBe(c0 + 555)
      expect((await notes(bob)).notifications.map((x) => x.text)).toContain('DM ti dal tvůj díl peněz: 5 gp, 5 sp, 5 cp (odměna)')

      // 5 cp mezi 2: po 2 cp, 1 cp zůstane DM
      const odd = await dmPost('currency', { characterIds: [bobChar, carolChar], currency: { cp: 5 }, split: true })
      expect(odd.body).toMatchObject({ eachCp: 2, leftoverCp: 1 })
      expect(await cp(bob, bobChar)).toBe(b0 + 557)

      // na tolik postav moc málo: nikdo nic nedostane
      expect((await dmPost('currency', { characterIds: [bobChar, carolChar], currency: { cp: 1 }, split: true })).status).toBe(422)
      expect(await cp(bob, bobChar)).toBe(b0 + 557)
      // split s jednou postavou je celá částka
      expect((await dmPost('currency', { characterIds: [bobChar], currency: { cp: 3 }, split: true })).body.eachCp).toBe(3)
    })

    it('peníze: odebrání (celé nebo rozdělené), vše nebo nic, drobné se vrací', async () => {
      const cp = async (who: typeof bob, id: string) => {
        const w = (await sheet(who, id)).currency
        return w.cp + w.sp * 10 + w.ep * 50 + w.gp * 100 + w.pp * 1000
      }
      const [b0, c0] = [await cp(bob, bobChar), await cp(carol, carolChar)]
      // každý zaplatí celou částku, rozměnění vrátí drobné
      expectStatus(await dmPost('currency', { characterIds: [bobChar], currency: { gp: 1, cp: 1 }, mode: 'take', reason: 'pokuta' }), 200)
      expect(await cp(bob, bobChar)).toBe(b0 - 101)
      expect((await notes(bob)).notifications.map((x) => x.text)).toContain('DM ti vzal peníze: 1 gp, 1 cp (pokuta)')
      // rozdělený účet: 20 gp mezi 2 = 10 gp každý
      const split = await dmPost('currency', { characterIds: [bobChar, carolChar], currency: { gp: 20 }, mode: 'take', split: true })
      expectStatus(split, 200)
      expect(split.body).toMatchObject({ mode: 'take', eachCp: 1000 })
      expect(await cp(bob, bobChar)).toBe(b0 - 101 - 1000)
      expect(await cp(carol, carolChar)).toBe(c0 - 1000)
      // nikdo nemá 1000 pp: neodebere se nikomu nic
      const [b1, c1] = [await cp(bob, bobChar), await cp(carol, carolChar)]
      const broke = await dmPost('currency', { characterIds: [bobChar, carolChar], currency: { pp: 1000 }, mode: 'take' })
      expect(broke.status).toBe(422)
      expect(JSON.stringify(broke.body)).toContain('Nemá dost peněz')
      expect(await cp(bob, bobChar)).toBe(b1)
      expect(await cp(carol, carolChar)).toBe(c1)
      expect((await dmPost('currency', { characterIds: [bobChar], currency: { gp: 1 }, mode: 'steal' })).status).toBe(422)
    })

    it('inspirace', async () => {
      await dmPost('inspiration', { characterIds: [bobChar], set: true })
      expect((await sheet(bob, bobChar)).inspiration).toBe(true)
      await dmPost('inspiration', { characterIds: [bobChar], set: false })
      expect((await sheet(bob, bobChar)).inspiration).toBe(false)
      expect((await dmPost('inspiration', { characterIds: [bobChar], set: 'ano' })).status).toBe(422)
    })
  })

  describe('zranění, léčení a stavy', () => {
    it('skupinové zranění a léčení s ořezem a dočasnými HP', async () => {
      await bob.client.post(`/characters/${bobChar}/adjust`, { ops: [{ op: 'tempHp', set: 4 }] })
      const dmg = await dmPost('hp', { delta: -10, targets: [{ characterId: bobChar, max: 30 }, { characterId: carolChar, max: 20 }] })
      expectStatus(dmg, 200)
      expect(dmg.body.hp).toEqual({ [bobChar]: 24, [carolChar]: 10 }) // Bob: 4 temp pohlceno, 6 z HP
      expect((await sheet(bob, bobChar)).state).toMatchObject({ hpCurrent: 24, hpTemp: 0 })
      const heal = await dmPost('hp', { delta: 100, targets: [{ characterId: bobChar, max: 30 }, { characterId: carolChar, max: 20 }] })
      expect(heal.body.hp).toEqual({ [bobChar]: 30, [carolChar]: 20 })
      const kill = await dmPost('hp', { delta: -999, targets: [{ characterId: carolChar, max: 20 }] })
      expect(kill.body.hp[carolChar]).toBe(0)
      const texts = (await notes(carol)).notifications.map((x) => x.text)
      expect(texts).toEqual(expect.arrayContaining(['DM ti způsobil 10 zranění', 'DM tě vyléčil o 100 HP']))
    })

    it('validuje vstup HP', async () => {
      expect((await dmPost('hp', { delta: 0, targets: [{ characterId: bobChar, max: 30 }] })).status).toBe(422)
      expect((await dmPost('hp', { delta: -1, targets: [] })).status).toBe(422)
      expect((await dmPost('hp', { delta: -1, targets: [{ characterId: bobChar, max: 0 }] })).status).toBe(422)
      expect((await dmPost('hp', { delta: -1, targets: [{ characterId: foreignChar, max: 10 }] })).status).toBe(422)
      expect((await dmPost('hp', { delta: 'x', targets: [{ characterId: bobChar, max: 10 }] })).status).toBe(422)
    })

    it('dočasná HP se nastaví (platí nová hodnota, nesčítají se) a nulou zruší; hráč dostane oznámení', async () => {
      expectStatus(await dmPost('temp-hp', { characterIds: [bobChar, carolChar], amount: 7 }), 200)
      expect((await sheet(bob, bobChar)).state.hpTemp).toBe(7)
      expect((await sheet(carol, carolChar)).state.hpTemp).toBe(7)
      await dmPost('temp-hp', { characterIds: [bobChar], amount: 3 })
      expect((await sheet(bob, bobChar)).state.hpTemp).toBe(3)
      await dmPost('temp-hp', { characterIds: [bobChar, carolChar], amount: 0 })
      expect((await sheet(bob, bobChar)).state.hpTemp).toBe(0)
      expect((await notes(bob)).notifications.map((x) => x.text)).toEqual(expect.arrayContaining(['DM ti nastavil dočasná HP: 3', 'DM ti zrušil dočasná HP']))
      for (const amount of [-1, 1.5, '5', null, 100001]) expect((await dmPost('temp-hp', { characterIds: [bobChar], amount })).status, JSON.stringify(amount)).toBe(422)
      expect((await dmPost('temp-hp', { characterIds: [foreignChar], amount: 1 })).status).toBe(422) // postava z jiné kampaně
    })

    it('stav se nastaví a zruší, hráč dostane oznámení', async () => {
      await dmPost('conditions', { characterIds: [bobChar, carolChar], name: 'Poisoned', set: true })
      expect((await sheet(bob, bobChar)).state.conditions).toEqual(['Poisoned'])
      await dmPost('conditions', { characterIds: [bobChar], name: 'Poisoned', set: true }) // dvakrát neduplikuje
      expect((await sheet(bob, bobChar)).state.conditions).toEqual(['Poisoned'])
      await dmPost('conditions', { characterIds: [bobChar], name: 'Poisoned', set: false })
      expect((await sheet(bob, bobChar)).state.conditions).toEqual([])
      expect((await sheet(carol, carolChar)).state.conditions).toEqual(['Poisoned'])
      expect((await notes(bob)).notifications.map((x) => x.text)).toEqual(expect.arrayContaining(['DM ti nastavil stav: Poisoned', 'DM ti zrušil stav: Poisoned']))
    })
  })

  describe('bonusy a efekty', () => {
    it('DM přidá efekt s popisem a trváním, hráč ho vidí v sheetu a dostane oznámení', async () => {
      expectStatus(await dmPost('effects', { characterIds: [bobChar], target: 'ac', value: 2, source: 'Shield of Faith', duration: 'long_rest' }), 201)
      const effects = (await sheet(bob, bobChar)).effects
      expect(effects).toEqual([expect.objectContaining({ target: 'ac', value: 2, source: 'Shield of Faith', duration: 'long_rest' })])
      expect((await notes(bob)).notifications.map((x) => x.text)).toContain('DM ti přidal bonus: +2 AC (Shield of Faith)')
    })

    it('validuje cíl, hodnotu, popis a trvání', async () => {
      const add = (body: object) => dmPost('effects', { characterIds: [bobChar], target: 'ac', value: 1, source: 'x', ...body })
      expect((await add({ target: 'strength' })).status).toBe(422)
      expect((await add({ value: 0 })).status).toBe(422)
      expect((await add({ value: 1000 })).status).toBe(422)
      expect((await add({ source: '' })).status).toBe(422)
      expect((await add({ duration: 'forever' })).status).toBe(422)
      expect((await add({ target: 'skill.stealth', value: -2, duration: 'permanent' })).status).toBe(201)
    })

    it('hráč efekt přidat ani zrušit nemůže, DM ano', async () => {
      const effect = (await sheet(bob, bobChar)).effects.find((e: { source: string }) => e.source === 'Shield of Faith')
      expect((await bob.client.delete(`/effects/${effect.id}`)).status).toBe(403)
      expect((await carol.client.delete(`/effects/${effect.id}`)).status).toBe(403)
      expect((await dave.client.delete(`/effects/${effect.id}`)).status).toBe(404)
      expect((await bob.client.post(`/campaigns/${campaignId}/dm/effects`, { characterIds: [bobChar], target: 'ac', value: 99, source: 'cheat' })).status).toBe(403)
      expect((await dm.client.delete(`/effects/${effect.id}`)).status).toBe(204)
      expect((await sheet(bob, bobChar)).effects.map((e: { source: string }) => e.source)).not.toContain('Shield of Faith')
      expect((await notes(bob)).notifications.map((x) => x.text)).toContain('DM zrušil bonus: +2 AC (Shield of Faith)')
    })

    it('po long restu zmizí jen efekty "do long restu"', async () => {
      await dmPost('effects', { characterIds: [carolChar], target: 'speed', value: 10, source: 'Haste', duration: 'long_rest' })
      await dmPost('effects', { characterIds: [carolChar], target: 'ac', value: 1, source: 'Amulet', duration: 'permanent' })
      expect((await carol.client.delete(`/characters/${carolChar}/effects/long-rest`)).body.removed).toBe(1)
      expect((await sheet(carol, carolChar)).effects.map((e: { source: string }) => e.source)).toEqual(['Amulet'])
      expect((await bob.client.delete(`/characters/${carolChar}/effects/long-rest`)).status).toBe(403)
      expect((await dave.client.delete(`/characters/${carolChar}/effects/long-rest`)).status).toBe(404)
    })

    it('ostatní hráči efekty cizí postavy v seznamu nevidí', async () => {
      const preview = (await carol.client.get(`/campaigns/${campaignId}/characters`)).body.characters.find((c: { id: string }) => c.id === bobChar)
      expect(preview).not.toHaveProperty('effects')
    })
  })

  describe('oznámení', () => {
    it('vidí je jen příjemce a jde je označit jako přečtená', async () => {
      const own = await notes(carol)
      expect(own.unread).toBeGreaterThan(0)
      expect((await notes(dave)).notifications).toEqual([])
      const ids = own.notifications.map((n) => n.id)
      expect(ids).toEqual([...ids].sort((a, b) => b - a)) // nejnovější první

      // cizí uživatel nemůže označit cizí oznámení
      await bob.client.post('/notifications/read', {})
      expect((await notes(carol)).unread).toBe(own.unread)

      const half = ids[Math.floor(ids.length / 2)]!
      const partial = await carol.client.post('/notifications/read', { upToId: half })
      expect(partial.body.unread).toBeLessThan(own.unread)
      expect((await carol.client.post('/notifications/read', {})).body.unread).toBe(0)
      expect((await notes(carol)).notifications.every((n) => n.read)).toBe(true)
    })

    it('after vrací jen novější oznámení (průběžné dotazování)', async () => {
      const latest = (await notes(bob)).notifications[0]!.id
      expect((await bob.client.get(`/notifications?after=${latest}`)).body.notifications).toEqual([])
      await dmPost('inspiration', { characterIds: [bobChar], set: true })
      const fresh = (await bob.client.get(`/notifications?after=${latest}`)).body.notifications
      expect(fresh).toHaveLength(1)
      expect(fresh[0].text).toBe('DM ti dal inspiraci')
    })

    it('DM si sám nenotifikuje a anonym je odmítnut', async () => {
      const own = (await dm.client.post(`/campaigns/${campaignId}/characters`, { ...BASE, name: 'DM postava' })).body.character.id
      await dmPost('inspiration', { characterIds: [own], set: true })
      expect((await notes(dm)).notifications).toEqual([])
      expect((await new Client().get('/notifications')).status).toBe(401)
    })

    it('předání mezi hráči pošle příjemci oznámení', async () => {
      await bob.client.post(`/characters/${bobChar}/items`, { name: 'Dýka', quantity: 2 })
      const dagger = (await sheet(bob, bobChar)).items.find((i: { name: string }) => i.name === 'Dýka').id
      await bob.client.post(`/characters/${bobChar}/transfer`, { toCharacterId: carolChar, itemId: dagger, quantity: 1 })
      expect((await notes(carol)).notifications.map((x) => x.text)).toContain('Bob ti předal(a): Dýka')
    })
  })
})
