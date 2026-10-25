import { beforeAll, describe, expect, it } from 'vitest'
import { Client, createCampaign, expectStatus, joinAsPlayer, registerUser, type TestUser } from './client'

describe('kostky', () => {
  let dm: TestUser
  let bob: TestUser
  let carol: TestUser
  let eve: TestUser
  let campaignId: string
  let bobChar: string
  let carolChar: string

  const roll = (user: TestUser, body: Record<string, unknown>, cid: string = campaignId) => user.client.post(`/campaigns/${cid}/rolls`, body)
  const log = async (user: TestUser, query = '') => {
    const res = await user.client.get(`/campaigns/${campaignId}/rolls${query}`)
    expectStatus(res, 200)
    return res.body.rolls as any[]
  }
  const sum = (attempt: any) => attempt.terms.reduce((n: number, t: any) => n + (t.rolls ? t.sign * t.rolls.reduce((a: number, b: number) => a + b, 0) : t.sign * t.constant), 0)

  beforeAll(async () => {
    dm = await registerUser('dm')
    campaignId = await createCampaign(dm, 'Kostky')
    bob = await joinAsPlayer(dm, campaignId, 'bob')
    carol = await joinAsPlayer(dm, campaignId, 'carol')
    eve = await registerUser('eve')
    const base = { abilityScores: { str: 10, dex: 14, con: 12, int: 10, wis: 10, cha: 10 }, levels: [{ classIndex: 'fighter' }] }
    bobChar = (await bob.client.post(`/campaigns/${campaignId}/characters`, { ...base, name: 'Bob' })).body.character.id
    carolChar = (await carol.client.post(`/campaigns/${campaignId}/characters`, { ...base, name: 'Carol' })).body.character.id
  })

  describe('hod', () => {
    it('server vylosuje kostky, sečte je a výsledek sedí s jednotlivými hody', async () => {
      const res = await roll(bob, { expression: '2d6+3', label: 'Zranění' })
      expectStatus(res, 201)
      const r = res.body.roll
      expect(r).toMatchObject({ expression: '2d6+3', label: 'Zranění', mode: 'normal', crit: false, hidden: false, userId: bob.id, chosen: 0 })
      expect(r.attempts).toHaveLength(1)
      const dice = r.attempts[0].terms[0]
      expect(dice).toMatchObject({ count: 2, sides: 6, sign: 1 })
      expect(dice.rolls).toHaveLength(2)
      for (const d of dice.rolls) expect(d >= 1 && d <= 6).toBe(true)
      expect(r.total).toBe(dice.rolls[0] + dice.rolls[1] + 3)
      expect(r.total).toBe(sum(r.attempts[0]))
    })

    it('výraz se zapíše v ustáleném tvaru, mezery a velká písmena nevadí, d20 znamená 1d20', async () => {
      expect((await roll(bob, { expression: ' D20 + 7 - 1 ' })).body.roll.expression).toBe('1d20+7-1')
      expect((await roll(bob, { expression: '-1d4+10' })).body.roll.expression).toBe('-1d4+10')
      const minus = (await roll(bob, { expression: '1d20-3' })).body.roll
      expect(minus.total).toBe(minus.attempts[0].terms[0].rolls[0] - 3)
    })

    it('kostky vycházejí v rozsahu a padnou všechny strany (500× d6)', async () => {
      const seen = new Set<number>()
      const res = await roll(dm, { expression: '100d6' })
      for (let i = 0; i < 4; i++) {
        const r = (await roll(dm, { expression: '100d6' })).body.roll
        for (const d of r.attempts[0].terms[0].rolls) {
          expect(d >= 1 && d <= 6).toBe(true)
          seen.add(d)
        }
      }
      expect(res.status).toBe(201)
      expect([...seen].sort()).toEqual([1, 2, 3, 4, 5, 6])
    })

    it('výhoda a nevýhoda hodí výraz dvakrát a vezmou vyšší / nižší součet', async () => {
      const bob = await joinAsPlayer(dm, campaignId, 'advbob') // vlastní hráč, ať nenarazíme na limit hodů za minutu
      for (let i = 0; i < 12; i++) {
        const adv = (await roll(bob, { expression: '1d20+2', mode: 'advantage' })).body.roll
        expect(adv.attempts).toHaveLength(2)
        const totals = adv.attempts.map((a: any) => a.total)
        expect(adv.total).toBe(Math.max(...totals))
        expect(adv.attempts[adv.chosen].total).toBe(adv.total)
        const dis = (await roll(bob, { expression: '1d20+2', mode: 'disadvantage' })).body.roll
        expect(dis.total).toBe(Math.min(...dis.attempts.map((a: any) => a.total)))
        expect(dis.attempts[dis.chosen].total).toBe(dis.total)
      }
    })

    it('natural hodnota u jednoho k20 a nic u jiných výrazů', async () => {
      const r = (await roll(bob, { expression: '1d20+5' })).body.roll
      expect(r.natural).toBe(r.attempts[0].terms[0].rolls[0])
      expect((await roll(bob, { expression: '2d20+5' })).body.roll.natural).toBeNull()
      expect((await roll(bob, { expression: '1d8+5' })).body.roll.natural).toBeNull()
    })

    it('critExtra (Brutal Critical) přidá nezdvojené kostky jen při kritu', async () => {
      const crit = (await roll(bob, { expression: '1d12+4', crit: true, critExtra: '1d12' })).body.roll
      expect(crit.attempts[0].terms.filter((t: any) => t.sides === 12).reduce((n: number, t: any) => n + t.rolls.length, 0)).toBe(3)
      expect(crit.total).toBe(sum(crit.attempts[0]))
      const normal = (await roll(bob, { expression: '1d12+4', critExtra: '1d12' })).body.roll
      expect(normal.attempts[0].terms.filter((t: any) => t.sides === 12).reduce((n: number, t: any) => n + t.rolls.length, 0)).toBe(1)
    })

    it('critExtra jen kladné kostky (konstanta, záporný člen, příliš mnoho: 422)', async () => {
      for (const critExtra of ['5', '-1d6', '11d6', 'ahoj']) {
        expectStatus(await roll(bob, { expression: '1d12', crit: true, critExtra }), 422)
      }
    })

    it('kritický zásah zdvojnásobí kostky, ale ne konstanty', async () => {
      const r = (await roll(bob, { expression: '1d8+4', crit: true })).body.roll
      expect(r).toMatchObject({ crit: true })
      expect(r.attempts[0].terms[0].count).toBe(2)
      expect(r.attempts[0].terms[0].rolls).toHaveLength(2)
      expect(r.attempts[0].terms[1]).toMatchObject({ constant: 4 })
      expect(r.total).toBe(sum(r.attempts[0]))
    })
  })

  describe('validace', () => {
    it('neplatné výrazy se odmítnou', async () => {
      const bob = await joinAsPlayer(dm, campaignId, 'badbob')
      const bad = ['', '   ', '20', '+5', '2d6+', 'd', '1d1', '0d6', '1d0', '1d1001', '101d6', '1000d6', '1d20+', 'abc', '1d20; DROP TABLE users', '1d20*2', '(1d20)', '1d20+1d', '1d6+99999', 'x'.repeat(200), '1d20 1d6']
      for (const expression of bad) expect((await roll(bob, { expression })).status, JSON.stringify(expression)).toBe(422)
      expect((await roll(bob, {})).status).toBe(422)
      expect((await roll(bob, { expression: 5 })).status).toBe(422)
      expect((await roll(bob, { expression: '100d6+100d6+1d6' })).status).toBe(422) // víc než 200 kostek
    })

    it('neplatný režim, příznaky, popisek a postava se odmítnou', async () => {
      const bob = await joinAsPlayer(dm, campaignId, 'modebob')
      expectStatus(await roll(bob, { expression: '1d20', mode: 'super' }), 422)
      expectStatus(await roll(bob, { expression: '1d20', crit: 'ano' }), 422)
      expectStatus(await roll(bob, { expression: '1d20', hidden: 1 }), 422)
      expectStatus(await roll(bob, { expression: '1d20', label: 'x'.repeat(101) }), 422)
      expectStatus(await roll(bob, { expression: '1d20', characterId: 'neni-uuid' }), 422)
    })
  })

  describe('oprávnění a soukromí', () => {
    it('anonym 401, cizinec 404', async () => {
      const anon = new Client()
      expect((await anon.post(`/campaigns/${campaignId}/rolls`, { expression: '1d20' })).status).toBe(401)
      expect((await anon.get(`/campaigns/${campaignId}/rolls`)).status).toBe(401)
      expectStatus(await roll(eve, { expression: '1d20' }), 404)
      expectStatus(await eve.client.get(`/campaigns/${campaignId}/rolls`), 404)
    })

    it('veřejný hod vidí všichni členové, ale ne v jiné kampani', async () => {
      const r = (await roll(bob, { expression: '1d20', label: 'Veřejný hod' })).body.roll
      for (const u of [dm, bob, carol]) expect((await log(u)).map((x) => x.id)).toContain(r.id)
      const other = await createCampaign(dm, 'Jiná')
      expect((await dm.client.get(`/campaigns/${other}/rolls`)).body.rolls).toEqual([])
    })

    it('skrytý hod hráče vidí jen on a DM, skrytý hod DM jen DM', async () => {
      const mine = (await roll(bob, { expression: '1d20', label: 'Bob tajně', hidden: true })).body.roll
      const gm = (await roll(dm, { expression: '1d20', label: 'DM tajně', hidden: true })).body.roll
      expect(mine.hidden).toBe(true)
      const ids = async (u: TestUser) => (await log(u)).map((x) => x.id)
      expect(await ids(bob)).toContain(mine.id)
      expect(await ids(dm)).toContain(mine.id)
      expect(await ids(carol)).not.toContain(mine.id)
      expect(await ids(dm)).toContain(gm.id)
      expect(await ids(bob)).not.toContain(gm.id)
      expect(await ids(carol)).not.toContain(gm.id)
    })

    it('hod za postavu smí jen její majitel nebo DM', async () => {
      const own = await roll(bob, { expression: '1d20+2', label: 'Athletics', characterId: bobChar })
      expectStatus(own, 201)
      expect(own.body.roll).toMatchObject({ characterId: bobChar, characterName: 'Bob' })
      expectStatus(await roll(bob, { expression: '1d20', characterId: carolChar }), 403)
      expectStatus(await roll(dm, { expression: '1d20', characterId: carolChar }), 201)
      // postava z jiné kampaně není platný cíl
      const otherCampaign = await createCampaign(dm, 'Cizí postavy')
      const foreign = (await dm.client.post(`/campaigns/${otherCampaign}/characters`, { name: 'Jinde', abilityScores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }, levels: [{ classIndex: 'fighter' }] })).body.character.id
      expectStatus(await roll(dm, { expression: '1d20', characterId: foreign }), 422)
    })
  })

  describe('log', () => {
    it('after vrací jen novější hody a poslední 50 hodů se vrací v pořadí od nejstaršího', async () => {
      const last = (await log(bob)).at(-1).id
      expect(await log(bob, `?after=${last}`)).toEqual([])
      const next = (await roll(carol, { expression: '1d4' })).body.roll
      expect((await log(bob, `?after=${last}`)).map((x) => x.id)).toEqual([next.id])
      const all = await log(bob)
      expect(all.length).toBeLessThanOrEqual(50)
      expect(all.map((x) => x.id)).toEqual([...all.map((x) => x.id)].sort((a, b) => a - b))
    })
  })

  describe('omezení četnosti', () => {
    it('víc než 60 hodů za minutu vrátí 429', async () => {
      const roller = await joinAsPlayer(dm, campaignId, 'spam')
      let last = 0
      for (let i = 0; i < 65; i++) {
        last = (await roll(roller, { expression: '1d20' })).status
        if (last === 429) break
      }
      expect(last).toBe(429)
    }, 90_000) // 65 požadavků za sebou; při paralelním běhu ostatních souborů server odpovídá pomalu
  })
})
