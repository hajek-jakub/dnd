import { beforeAll, describe, expect, it } from 'vitest'
import { Client, createCampaign, expectStatus, joinAsPlayer, registerUser, type TestUser } from './client'

describe('utrácení peněz', () => {
  let dm: TestUser
  let bob: TestUser
  let carol: TestUser
  let eve: TestUser
  let campaignId: string

  const base = { abilityScores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }, levels: [{ classIndex: 'fighter' }] }
  const makeChar = async (user: TestUser, wallet: Record<string, number>) => {
    const id = (await user.client.post(`/campaigns/${campaignId}/characters`, { ...base, name: 'Postava' })).body.character.id as string
    await user.client.patch(`/characters/${id}`, { currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0, ...wallet } })
    return id
  }
  const spend = (user: TestUser, id: string, cost: Record<string, number>, note?: string) => user.client.post(`/characters/${id}/spend`, { currency: cost, ...(note ? { note } : {}) })
  const wallet = async (user: TestUser, id: string) => (await user.client.get(`/characters/${id}`)).body.character.currency

  beforeAll(async () => {
    dm = await registerUser('dm')
    campaignId = await createCampaign(dm, 'Utrácení')
    bob = await joinAsPlayer(dm, campaignId, 'bob')
    carol = await joinAsPlayer(dm, campaignId, 'carol')
    eve = await registerUser('eve')
  })

  describe('platba', () => {
    it('zaplatí přesnými mincemi a vrátí poznámku', async () => {
      const id = await makeChar(bob, { gp: 10, sp: 7 })
      const res = await spend(bob, id, { sp: 5 }, 'Pivo u barmana')
      expectStatus(res, 200)
      expect(res.body).toMatchObject({ currency: { cp: 0, sp: 2, ep: 0, gp: 10, pp: 0 }, spentCp: 50, note: 'Pivo u barmana' })
      expect(await wallet(bob, id)).toEqual(res.body.currency)
    })

    it('když chybí drobné, rozmění zlatý a vrátí drobné (5 sp ze 3 gp = 2 gp, 5 sp)', async () => {
      const id = await makeChar(bob, { gp: 3 })
      const res = await spend(bob, id, { sp: 5 })
      expect(res.body.currency).toEqual({ cp: 0, sp: 5, ep: 0, gp: 2, pp: 0 })
    })

    it('rozmění i platinu a drobné dá ve zlatých, stříbrných a měděných', async () => {
      const id = await makeChar(bob, { pp: 1 })
      const res = await spend(bob, id, { gp: 3, sp: 4, cp: 6 }) // 346 cp z 1000
      expect(res.body.currency).toEqual({ cp: 4, sp: 5, ep: 0, gp: 6, pp: 0 })
      expect(Object.values(res.body.currency as Record<string, number>).reduce((n, v, i) => n + v * [1, 10, 50, 100, 1000][i]!, 0)).toBe(654)
    })

    it('celková hodnota se vždy zachová: zbývá přesně původní součet minus cena', async () => {
      const value = { cp: 1, sp: 10, ep: 50, gp: 100, pp: 1000 } as Record<string, number>
      const total = (w: Record<string, number>) => Object.entries(w).reduce((n, [c, v]) => n + v * value[c]!, 0)
      const id = await makeChar(bob, { cp: 7, sp: 3, ep: 2, gp: 4, pp: 1 })
      let left = total(await wallet(bob, id))
      for (const cost of [{ cp: 3 }, { sp: 1, cp: 4 }, { gp: 1 }, { ep: 1 }, { sp: 6 }, { cp: 1 }]) {
        const res = await spend(bob, id, cost)
        expectStatus(res, 200)
        left -= res.body.spentCp
        expect(total(res.body.currency)).toBe(left)
        expect(Object.values(res.body.currency as Record<string, number>).every((n) => Number.isInteger(n) && n >= 0)).toBe(true)
      }
    })

    it('nedostatek peněz nezaplatí nic a řekne kolik chybí', async () => {
      const id = await makeChar(bob, { gp: 1, sp: 5 })
      const res = await spend(bob, id, { gp: 2 })
      expectStatus(res, 422)
      expect(res.body.error.message).toContain('Nemáš dost peněz')
      expect(res.body.error.message).toContain('2 gp')
      expect(await wallet(bob, id)).toEqual({ cp: 0, sp: 5, ep: 0, gp: 1, pp: 0 })
    })

    it('zaplatí do posledního měďáku', async () => {
      const id = await makeChar(bob, { gp: 1, sp: 5, cp: 5 }) // 155 cp
      const res = await spend(bob, id, { gp: 1, sp: 5, cp: 5 })
      expect(res.body.currency).toEqual({ cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 })
      expectStatus(await spend(bob, id, { cp: 1 }), 422)
    })

    it('souběžné platby se nepřeplatí: ze 100 cp projde jen jedna platba za 60', async () => {
      const id = await makeChar(bob, { gp: 1 })
      const results = await Promise.all([spend(bob, id, { sp: 6 }), spend(bob, id, { sp: 6 })])
      expect(results.map((r) => r.status).sort()).toEqual([200, 422])
      const left = await wallet(bob, id)
      expect(left.gp * 100 + left.sp * 10 + left.cp).toBe(40)
    })

    it('platba zvýší verzi postavy (kvůli konfliktům při úpravách)', async () => {
      const id = await makeChar(bob, { gp: 5 })
      const before = (await bob.client.get(`/characters/${id}`)).body.character.rev
      await spend(bob, id, { sp: 1 })
      expect((await bob.client.get(`/characters/${id}`)).body.character.rev).toBe(before + 1)
    })
  })

  describe('oprávnění', () => {
    it('platit smí majitel a DM, jiný hráč ne (403), cizinec 404, anonym 401', async () => {
      const id = await makeChar(bob, { gp: 5 })
      expectStatus(await spend(carol, id, { sp: 1 }), 403)
      expectStatus(await spend(eve, id, { sp: 1 }), 404)
      expect((await new Client().post(`/characters/${id}/spend`, { currency: { sp: 1 } })).status).toBe(401)
      expectStatus(await spend(dm, id, { sp: 1 }), 200)
      expect((await wallet(bob, id)).sp).toBeGreaterThanOrEqual(0)
      // nic z toho, co cizí odmítl, se neodečetlo
      const after = await wallet(bob, id)
      expect(after.gp * 100 + after.sp * 10 + after.cp).toBe(490)
    })
  })

  describe('validace', () => {
    it('nulová, záporná, desetinná, textová a chybějící částka se odmítne', async () => {
      const id = await makeChar(bob, { gp: 5 })
      for (const cost of [{}, { sp: 0 }, { sp: -1 }, { sp: 1.5 }, { sp: '5' }, { sp: null }, { gp: 2_000_000_000 }]) {
        expect((await spend(bob, id, cost as Record<string, number>)).status, JSON.stringify(cost)).toBe(422)
      }
      expect((await bob.client.post(`/characters/${id}/spend`, {})).status).toBe(422)
      expect((await bob.client.post(`/characters/${id}/spend`, { currency: 'moc' })).status).toBe(422)
      expect((await spend(bob, id, { sp: 1 }, 'x'.repeat(101))).status).toBe(422)
      expect(await wallet(bob, id)).toEqual({ cp: 0, sp: 0, ep: 0, gp: 5, pp: 0 })
    })
  })
})
