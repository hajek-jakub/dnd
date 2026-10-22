import { beforeAll, describe, expect, it } from 'vitest'
import { Client, createCampaign, expectStatus, joinAsPlayer, registerUser, type TestUser } from './client'

describe('společníci a přivolaná stvoření', () => {
  let dm: TestUser
  let bob: TestUser
  let carol: TestUser
  let eve: TestUser
  let campaignId: string
  let bobChar: string
  let carolChar: string
  let otherCampaignChar: string

  const base = { abilityScores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }, levels: [{ classIndex: 'wizard' }] }
  const owl = { name: 'Owl', hpMax: 1, ac: 11, attacks: [{ name: 'Talons', toHit: 3, damage: '1d4' }], notes: 'Familiar' }
  const add = (user: TestUser, char: string, body: Record<string, unknown> = owl) => user.client.post(`/characters/${char}/companions`, body)
  const list = async (user: TestUser, char: string) => {
    const res = await user.client.get(`/characters/${char}/companions`)
    expectStatus(res, 200)
    return res.body.companions as any[]
  }

  beforeAll(async () => {
    dm = await registerUser('dm')
    campaignId = await createCampaign(dm, 'Společníci')
    bob = await joinAsPlayer(dm, campaignId, 'bob')
    carol = await joinAsPlayer(dm, campaignId, 'carol')
    eve = await registerUser('eve')
    bobChar = (await bob.client.post(`/campaigns/${campaignId}/characters`, { ...base, name: 'Bob' })).body.character.id
    carolChar = (await carol.client.post(`/campaigns/${campaignId}/characters`, { ...base, name: 'Carol' })).body.character.id
    const other = await createCampaign(eve, 'Cizí')
    otherCampaignChar = (await eve.client.post(`/campaigns/${other}/characters`, { ...base, name: 'Eve' })).body.character.id
  })

  describe('plochá zranění', () => {
    it('útok se zraněním „1“ (sova, netopýr) se uloží, nesmysl ne', async () => {
      const own = (await bob.client.post(`/campaigns/${campaignId}/characters`, { ...base, name: 'Druhá' })).body.character.id
      const flat = await add(bob, own, { name: 'Bat', hpMax: 1, ac: 12, attacks: [{ name: 'Bite', toHit: 0, damage: '1' }] })
      expectStatus(flat, 201)
      expect(flat.body.companion.attacks[0].damage).toBe('1')
      expectStatus(await add(bob, own, { name: 'X', hpMax: 1, attacks: [{ name: 'A', toHit: 0, damage: 'hodně' }] }), 422)
    })
  })

  describe('oprávnění', () => {
    it('anonym 401, cizinec 404 na všem', async () => {
      const anon = new Client()
      const fake = '00000000-0000-4000-8000-000000000000'
      expect((await anon.get(`/characters/${bobChar}/companions`)).status).toBe(401)
      expect((await anon.post(`/characters/${bobChar}/companions`, owl)).status).toBe(401)
      expect((await anon.patch(`/companions/${fake}`, {})).status).toBe(401)
      expect((await anon.post(`/companions/${fake}/hp`, { delta: -1 })).status).toBe(401)
      expectStatus(await eve.client.get(`/characters/${bobChar}/companions`), 404)
      expectStatus(await add(eve, bobChar), 404)
      const mine = await add(bob, bobChar)
      const id = mine.body.companion.id
      expectStatus(await eve.client.patch(`/companions/${id}`, { name: 'Hack' }), 404)
      expectStatus(await eve.client.post(`/companions/${id}/hp`, { delta: -1 }), 404)
      expectStatus(await eve.client.post(`/companions/${id}/duplicate`, {}), 404)
      expectStatus(await eve.client.delete(`/companions/${id}`), 404)
      expectStatus(await bob.client.delete(`/companions/${id}`), 204)
    })

    it('majitel a DM čtou i upravují, jiný hráč nečte (403) ani nemění', async () => {
      const mine = await add(bob, bobChar)
      expectStatus(mine, 201)
      const id = mine.body.companion.id
      expectStatus(await add(dm, bobChar, { ...owl, name: 'Od DM' }), 201)
      expect((await list(bob, bobChar)).map((c) => c.name)).toEqual(['Owl', 'Od DM'])
      expect((await list(dm, bobChar)).length).toBe(2)
      expectStatus(await carol.client.get(`/characters/${bobChar}/companions`), 403)
      expectStatus(await add(carol, bobChar), 403)
      expectStatus(await carol.client.patch(`/companions/${id}`, { name: 'Hack' }), 403)
      expectStatus(await carol.client.post(`/companions/${id}/hp`, { delta: -1 }), 403)
      expectStatus(await carol.client.post(`/companions/${id}/duplicate`, {}), 403)
      expectStatus(await carol.client.delete(`/companions/${id}`), 403)
      expect((await list(bob, bobChar)).find((c) => c.id === id)?.name).toBe('Owl')
      expectStatus(await dm.client.patch(`/companions/${id}`, { notes: 'DM upravil' }), 200)
      expectStatus(await bob.client.patch(`/companions/${id}`, { notes: 'Majitel upravil' }), 200)
    })

    it('postava s visibility full: ostatní členové společníky čtou, ale pořád nemění', async () => {
      const created = await add(carol, carolChar, { ...owl, name: 'Tenebrae' })
      expectStatus(await bob.client.get(`/characters/${carolChar}/companions`), 403)
      await dm.client.patch(`/characters/${carolChar}`, { visibility: 'full' })
      expect((await list(bob, carolChar)).map((c) => c.name)).toEqual(['Tenebrae'])
      expectStatus(await bob.client.patch(`/companions/${created.body.companion.id}`, { name: 'Hack' }), 403)
      expectStatus(await bob.client.post(`/companions/${created.body.companion.id}/hp`, { delta: -1 }), 403)
      expectStatus(await add(bob, carolChar), 403)
      await dm.client.patch(`/characters/${carolChar}`, { visibility: 'public_only' })
      expectStatus(await bob.client.get(`/characters/${carolChar}/companions`), 403)
    })

    it('smazání postavy smaže i její společníky', async () => {
      const temp = (await bob.client.post(`/campaigns/${campaignId}/characters`, { ...base, name: 'Dočasná' })).body.character.id
      const id = (await add(bob, temp)).body.companion.id
      expectStatus(await bob.client.delete(`/characters/${temp}`), 204)
      expectStatus(await dm.client.post(`/companions/${id}/hp`, { delta: -1 }), 404)
    })
  })

  describe('hodnoty', () => {
    it('vrací jméno, HP, AC, útoky a poznámku', async () => {
      const res = await add(bob, bobChar, { name: 'Wolf', hpMax: 11, ac: 13, attacks: [{ name: 'Bite', toHit: 4, damage: '2d4+2' }], notes: 'Pack Tactics' })
      expectStatus(res, 201)
      expect(res.body.companion).toMatchObject({ name: 'Wolf', hpMax: 11, hpCurrent: 11, ac: 13, notes: 'Pack Tactics', attacks: [{ name: 'Bite', toHit: 4, damage: '2d4+2' }], characterId: bobChar })
      expect(res.body.companion.initiative).toBeUndefined()
    })

    it('validace: jméno, HP, útoky a výraz zranění', async () => {
      expectStatus(await add(bob, bobChar, { hpMax: 5 }), 422)
      expectStatus(await add(bob, bobChar, { name: 'X' }), 422)
      expectStatus(await add(bob, bobChar, { name: 'X', hpMax: 0 }), 422)
      expectStatus(await add(bob, bobChar, { name: 'X', hpMax: 5, attacks: [{ name: 'Bite', toHit: 4, damage: 'hodně' }] }), 422)
      expectStatus(await add(bob, bobChar, { name: 'X', hpMax: 5, attacks: Array.from({ length: 13 }, () => ({ name: 'A', toHit: 1, damage: '1d4' })) }), 422)
      expectStatus(await add(bob, bobChar, { name: 'X', hpMax: 5, ac: 99 }), 422)
    })

    it('úprava mění jen poslaná pole a HP se ořízne na nové maximum', async () => {
      const c = (await add(bob, bobChar, { name: 'Hawk', hpMax: 10, ac: 12 })).body.companion
      const res = await bob.client.patch(`/companions/${c.id}`, { hpMax: 4 })
      expectStatus(res, 200)
      expect(res.body.companion).toMatchObject({ name: 'Hawk', hpMax: 4, hpCurrent: 4, ac: 12 })
    })

    it('HP: zranění, léčení, meze 0 a maximum, nulová a nesmyslná změna je 422', async () => {
      const c = (await add(bob, bobChar, { name: 'Boar', hpMax: 10 })).body.companion
      const hp = (delta: unknown) => bob.client.post(`/companions/${c.id}/hp`, { delta })
      expect((await hp(-4)).body.companion.hpCurrent).toBe(6)
      expect((await hp(100)).body.companion.hpCurrent).toBe(10)
      expect((await hp(-100)).body.companion.hpCurrent).toBe(0)
      expectStatus(await hp(0), 422)
      expectStatus(await hp('moc'), 422)
      expectStatus(await hp(1.5), 422)
      expectStatus(await hp(1_000_000), 422)
    })

    it('duplicate: plné HP a očíslované jméno', async () => {
      const c = (await add(bob, bobChar, { name: 'Dire Wolf', hpMax: 37, attacks: [{ name: 'Bite', toHit: 5, damage: '2d6+3' }] })).body.companion
      await bob.client.post(`/companions/${c.id}/hp`, { delta: -30 })
      const a = (await bob.client.post(`/companions/${c.id}/duplicate`, {})).body.companion
      const b = (await bob.client.post(`/companions/${c.id}/duplicate`, {})).body.companion
      expect([a.name, b.name]).toEqual(['Dire Wolf 2', 'Dire Wolf 3'])
      expect(a).toMatchObject({ hpCurrent: 37, hpMax: 37, attacks: [{ name: 'Bite', toHit: 5, damage: '2d6+3' }] })
    })

    it('nejvýš 20 společníků na postavu (i při souběžném přidávání)', async () => {
      const ch = (await bob.client.post(`/campaigns/${campaignId}/characters`, { ...base, name: 'Přivolávač' })).body.character.id
      const results = await Promise.all(Array.from({ length: 24 }, (_, i) => add(bob, ch, { name: `Imp ${i}`, hpMax: 1 })))
      expect(results.filter((r) => r.status === 201).length).toBe(20)
      expect(results.filter((r) => r.status === 422).length).toBe(4)
      expect((await list(bob, ch)).length).toBe(20)
    })

    it('společník cizí postavy z jiné kampaně se přes jeho id nedá měnit', async () => {
      const foreign = (await eve.client.post(`/characters/${otherCampaignChar}/companions`, owl)).body.companion.id
      expectStatus(await bob.client.patch(`/companions/${foreign}`, { name: 'Hack' }), 404)
      expectStatus(await dm.client.post(`/companions/${foreign}/hp`, { delta: -1 }), 404)
    })
  })
})
