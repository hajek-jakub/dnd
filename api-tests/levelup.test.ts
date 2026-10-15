import { beforeAll, describe, expect, it } from 'vitest'
import { createCampaign, expectStatus, joinAsPlayer, registerUser, type TestUser } from './client'

const SCORES = { str: 10, dex: 14, con: 12, int: 16, wis: 10, cha: 8 }

describe('level up a jeho vrácení', () => {
  let dm: TestUser
  let bob: TestUser
  let carol: TestUser
  let dave: TestUser
  let campaignId: string

  beforeAll(async () => {
    dm = await registerUser('dm')
    campaignId = await createCampaign(dm, 'Level up')
    bob = await joinAsPlayer(dm, campaignId, 'bob')
    carol = await joinAsPlayer(dm, campaignId, 'carol')
    dave = await registerUser('dave')
  })

  async function character(user: TestUser, levels: number, classIndex = 'wizard', extra: Record<string, unknown> = {}) {
    const res = await user.client.post(`/campaigns/${campaignId}/characters`, {
      name: `Postava ${classIndex} ${levels}`,
      abilityScores: SCORES,
      levels: Array.from({ length: levels }, () => ({ classIndex, hpRoll: null })),
      state: { hpCurrent: 20 },
      ...extra,
    })
    expectStatus(res, 201)
    return res.body.character.id as string
  }
  const up = (user: TestUser, id: string, body: Record<string, unknown>) => user.client.post(`/characters/${id}/levelup`, body)
  const sheet = async (user: TestUser, id: string) => (await user.client.get(`/characters/${id}`)).body.character

  it('přidá level průměrem, přepočítá level a shrnutí tříd a zvedne aktuální HP', async () => {
    const id = await character(bob, 2)
    const res = await up(bob, id, { classIndex: 'wizard', hpRoll: null, hpGain: 5 })
    expectStatus(res, 201)
    expect(res.body.character).toMatchObject({ level: 3, classSummary: 'Wizard 3', rev: expect.any(Number) })
    expect(res.body.character.levels).toHaveLength(3)
    expect(res.body.character.levels[2]).toMatchObject({ classIndex: 'wizard', hpRoll: null })
    expect(res.body.character.state.hpCurrent).toBe(25)
  })

  it('uloží hozenou hodnotu a odmítne hod mimo kostku třídy', async () => {
    const id = await character(bob, 1, 'fighter')
    expect((await up(bob, id, { classIndex: 'fighter', hpRoll: 11, hpGain: 5 })).status).toBe(422) // d10
    expect((await up(bob, id, { classIndex: 'fighter', hpRoll: 0, hpGain: 5 })).status).toBe(422)
    const ok = await up(bob, id, { classIndex: 'fighter', hpRoll: 9, hpGain: 11 })
    expect(ok.body.character.levels[1].hpRoll).toBe(9)
  })

  it('multiclass: nová třída se přidá a objeví ve shrnutí', async () => {
    const id = await character(bob, 3)
    const res = await up(bob, id, { classIndex: 'cleric', hpRoll: null, hpGain: 5 })
    expectStatus(res, 201)
    expect(res.body.character).toMatchObject({ level: 4, classSummary: 'Wizard 3 / Cleric 1' })
  })

  it('odmítá neplatnou třídu a překročení levelu 20', async () => {
    const id = await character(bob, 19)
    expect((await up(bob, id, { classIndex: 'ninja', hpGain: 5 })).status).toBe(422)
    expect((await up(bob, id, { classIndex: 'wizard', hpGain: -1 })).status).toBe(422)
    expectStatus(await up(bob, id, { classIndex: 'wizard', hpGain: 5 }), 201)
    const over = await up(bob, id, { classIndex: 'wizard', hpGain: 5 })
    expect(over.status).toBe(422)
    expect(over.body.error.message).toMatch(/maximální level 20/)
  })

  it('souběžné level upy na 19. levelu: projde jen jeden', async () => {
    const id = await character(bob, 19, 'fighter')
    const results = await Promise.all([1, 2, 3].map(() => up(bob, id, { classIndex: 'fighter', hpGain: 6 })))
    expect(results.filter((r) => r.status === 201)).toHaveLength(1)
    expect((await sheet(bob, id)).level).toBe(20)
  })

  describe('subclass', () => {
    it('monk smí subclass až od 3. levelu', async () => {
      const id = await character(bob, 1, 'monk')
      expect((await up(bob, id, { classIndex: 'monk', hpGain: 5, subclass: 'open-hand' })).status).toBe(422) // to by byl 2. level
    })

    it('na 3. levelu monka se subclass uloží, jiný subclass je odmítnut', async () => {
      const id = await character(bob, 2, 'monk')
      // level 3 je první, kde monk smí subclass
      expect((await up(bob, id, { classIndex: 'monk', hpGain: 5, subclass: 'fiend' })).status).toBe(422)
      const res = await up(bob, id, { classIndex: 'monk', hpGain: 5, subclass: 'open-hand' })
      expectStatus(res, 201)
      expect(res.body.character.subclasses).toEqual({ monk: 'open-hand' })
    })
  })

  describe('zvýšení vlastností a feat', () => {
    it('ASI na 4. levelu: +2 celkem, nad 20 nejde, jinde než na ASI levelu ne', async () => {
      const id = await character(bob, 3)
      // 3. -> 4. level je ASI (wizard)
      expect((await up(bob, id, { classIndex: 'wizard', hpGain: 4, asi: { increases: { int: 1 } } })).status).toBe(422) // jen +1
      expect((await up(bob, id, { classIndex: 'wizard', hpGain: 4, asi: { increases: { int: 3 } } })).status).toBe(422)
      expect((await up(bob, id, { classIndex: 'wizard', hpGain: 4, asi: { increases: { luck: 2 } } })).status).toBe(422)
      const ok = await up(bob, id, { classIndex: 'wizard', hpGain: 4, asi: { increases: { int: 1, dex: 1 } } })
      expectStatus(ok, 201)
      expect(ok.body.character.abilityScores).toMatchObject({ int: 17, dex: 15 })
      // 5. level ASI nedává
      expect((await up(bob, id, { classIndex: 'wizard', hpGain: 4, asi: { increases: { int: 2 } } })).status).toBe(422)
    })

    it('ASI nepřesáhne 20', async () => {
      const id = await character(bob, 3, 'wizard', { abilityScores: { ...SCORES, int: 19 } })
      expect((await up(bob, id, { classIndex: 'wizard', hpGain: 4, asi: { increases: { int: 2 } } })).status).toBe(422)
      expectStatus(await up(bob, id, { classIndex: 'wizard', hpGain: 4, asi: { increases: { int: 1, wis: 1 } } }), 201)
    })

    it('feat místo ASI (ale ne obojí) a jen na ASI levelu', async () => {
      const id = await character(bob, 3)
      expect((await up(bob, id, { classIndex: 'wizard', hpGain: 4, feat: { name: 'Grappler' }, asi: { increases: { int: 2 } } })).status).toBe(422)
      expect((await up(bob, id, { classIndex: 'wizard', hpGain: 4, feat: { name: '' } })).status).toBe(422)
      const ok = await up(bob, id, { classIndex: 'wizard', hpGain: 4, feat: { name: 'Vlastní feat', description: 'Popis' } })
      expectStatus(ok, 201)
      expect(ok.body.character.levels[3].choices.feat).toMatchObject({ name: 'Vlastní feat', description: 'Popis' })
      expect(ok.body.character.abilityScores.int).toBe(16) // vlastnosti beze změny
      expect((await up(bob, id, { classIndex: 'wizard', hpGain: 4, feat: { name: 'Dalsi' } })).status).toBe(422) // 5. level feat nedává
    })

    it('fighter má ASI i na 6. levelu, rogue na 10.', async () => {
      const f = await character(bob, 5, 'fighter')
      expectStatus(await up(bob, f, { classIndex: 'fighter', hpGain: 6, asi: { increases: { str: 2 } } }), 201)
      const r = await character(bob, 9, 'rogue')
      expectStatus(await up(bob, r, { classIndex: 'rogue', hpGain: 5, asi: { increases: { dex: 2 } } }), 201)
    })

    it('multiclass: ASI se počítá podle levelu dané třídy', async () => {
      const id = await character(bob, 3, 'wizard')
      // první level clerica je jeho 1. level: ASI nedává, i když celkově je to 4. level postavy
      expect((await up(bob, id, { classIndex: 'cleric', hpGain: 5, asi: { increases: { wis: 2 } } })).status).toBe(422)
    })
  })

  describe('kouzla při level upu', () => {
    it('přidá nová a odebere stará kouzla', async () => {
      const id = await character(bob, 1, 'sorcerer')
      const rule = async (name: string) => (await bob.client.get(`/rules?kinds=spell&q=${encodeURIComponent(name)}`)).body.entries.find((e: { name: string }) => e.name === name).id
      await bob.client.post(`/characters/${id}/spells`, { ruleId: await rule('Magic Missile'), classIdx: 'sorcerer' })
      const old = (await sheet(bob, id)).spells[0].id
      const res = await up(bob, id, { classIndex: 'sorcerer', hpGain: 4, spells: { add: [{ ruleId: await rule('Shield'), classIdx: 'sorcerer' }], remove: [old] } })
      expectStatus(res, 201)
      expect(res.body.character.spells.map((s: { name: string }) => s.name)).toEqual(['Shield'])
    })

    it('odmítá cizí kouzlo a třídu, kterou postava nemá', async () => {
      const id = await character(bob, 1, 'sorcerer')
      const mm = (await bob.client.get('/rules?kinds=spell&q=Magic%20Missile')).body.entries[0].id
      expect((await up(bob, id, { classIndex: 'sorcerer', hpGain: 4, spells: { add: [{ ruleId: mm, classIdx: 'cleric' }] } })).status).toBe(422)
      expect((await up(bob, id, { classIndex: 'sorcerer', hpGain: 4, spells: { remove: ['00000000-0000-0000-0000-000000000000'] } })).status).toBe(422)
      expect((await up(bob, id, { classIndex: 'sorcerer', hpGain: 4, spells: { add: [{ ruleId: 'neni-uuid', classIdx: 'sorcerer' }] } })).status).toBe(422)
      expect((await sheet(bob, id)).level).toBe(1) // nic se nezměnilo
    })
  })

  describe('vrácení levelu', () => {
    it('vrátí vlastnosti, subclass, kouzla a HP přesně do stavu před level upem', async () => {
      const id = await character(bob, 2, 'monk')
      const rule = async (name: string) => (await bob.client.get(`/rules?kinds=spell&q=${encodeURIComponent(name)}`)).body.entries.find((e: { name: string }) => e.name === name).id
      await bob.client.post(`/characters/${id}/spells`, { ruleId: await rule('Shield'), classIdx: '' })
      const before = await sheet(bob, id)
      // 3. level monka: subclass; spells: přidání a odebrání
      const up3 = await up(bob, id, { classIndex: 'monk', hpRoll: 6, hpGain: 8, subclass: 'open-hand', spells: { add: [{ ruleId: await rule('Fireball'), classIdx: '' }], remove: [before.spells[0].id] } })
      expectStatus(up3, 201)
      expect(up3.body.character.state.hpCurrent).toBe(before.state.hpCurrent + 8)
      // 4. level monka: ASI
      expectStatus(await up(bob, id, { classIndex: 'monk', hpGain: 6, asi: { increases: { dex: 2 } } }), 201)

      // vrátit 4. level: vlastnosti zpět, subclass zůstává
      const r4 = await bob.client.post(`/characters/${id}/levelup/revert`, {})
      expectStatus(r4, 200)
      expect(r4.body.character).toMatchObject({ level: 3, classSummary: 'Monk 3', abilityScores: before.abilityScores, subclasses: { monk: 'open-hand' } })
      expect(r4.body.character.state.hpCurrent).toBe(before.state.hpCurrent + 8)

      // vrátit 3. level: i subclass, kouzla a HP
      const r3 = await bob.client.post(`/characters/${id}/levelup/revert`, {})
      expect(r3.body.character).toMatchObject({ level: 2, classSummary: 'Monk 2', subclasses: {}, abilityScores: before.abilityScores })
      expect(r3.body.character.state.hpCurrent).toBe(before.state.hpCurrent)
      expect(r3.body.character.spells.map((s: { name: string }) => s.name)).toEqual(['Shield'])
      expect(r3.body.character.levels).toHaveLength(2)
    })

    it('první level nejde vrátit', async () => {
      const id = await character(bob, 1)
      expect((await bob.client.post(`/characters/${id}/levelup/revert`, {})).status).toBe(422)
    })

    it('po vrácení jde stejný level přidat znovu', async () => {
      const id = await character(bob, 2)
      await up(bob, id, { classIndex: 'wizard', hpGain: 4 })
      await bob.client.post(`/characters/${id}/levelup/revert`, {})
      expectStatus(await up(bob, id, { classIndex: 'wizard', hpRoll: 4, hpGain: 4 }), 201)
      expect((await sheet(bob, id)).levels[2].hpRoll).toBe(4)
    })
  })

  describe('oprávnění', () => {
    it('cizí hráč 403, cizinec 404, DM smí; vrácení stejně', async () => {
      const id = await character(bob, 2)
      expect((await up(carol, id, { classIndex: 'wizard', hpGain: 4 })).status).toBe(403)
      expect((await up(dave, id, { classIndex: 'wizard', hpGain: 4 })).status).toBe(404)
      expect((await carol.client.post(`/characters/${id}/levelup/revert`, {})).status).toBe(403)
      expect((await dave.client.post(`/characters/${id}/levelup/revert`, {})).status).toBe(404)
      expectStatus(await up(dm, id, { classIndex: 'wizard', hpGain: 4 }), 201)
      expect((await dm.client.post(`/characters/${id}/levelup/revert`, {})).status).toBe(200)
      expect((await sheet(bob, id)).level).toBe(2)
    })

    it('poznámka k ručnímu doplnění se uloží do historie', async () => {
      const id = await character(bob, 2)
      const res = await up(bob, id, { classIndex: 'wizard', hpGain: 4, note: 'Homebrew featura: Ohnivý dech' })
      expect(res.body.character.levels[2].choices.note).toBe('Homebrew featura: Ohnivý dech')
    })
  })
})
