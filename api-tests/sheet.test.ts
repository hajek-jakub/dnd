import { beforeAll, describe, expect, it } from 'vitest'
import { createCampaign, expectStatus, jpegSize, joinAsPlayer, makePng, registerUser, type TestUser } from './client'

const BASE = {
  abilityScores: { str: 10, dex: 16, con: 14, int: 8, wis: 15, cha: 14 },
  levels: [{ classIndex: 'monk', hpRoll: null }],
}
const monk5warlock1 = [...Array(5).fill({ classIndex: 'monk', hpRoll: null }), { classIndex: 'warlock', hpRoll: null }]

describe('character sheet', () => {
  let dm: TestUser
  let bob: TestUser
  let carol: TestUser
  let dave: TestUser
  let campaignId: string

  beforeAll(async () => {
    dm = await registerUser('dm')
    campaignId = await createCampaign(dm, 'Sheet kampaň')
    bob = await joinAsPlayer(dm, campaignId, 'bob')
    carol = await joinAsPlayer(dm, campaignId, 'carol')
    dave = await registerUser('dave')
  })

  const create = (user: TestUser, body: Record<string, unknown> = {}) => user.client.post(`/campaigns/${campaignId}/characters`, { ...BASE, name: 'Hajoš', ...body })

  describe('vytvoření a validace', () => {
    it('vytvoří postavu s odvozeným levelem a shrnutím tříd', async () => {
      const res = await create(bob, { levels: monk5warlock1, subclasses: { monk: 'open-hand', warlock: 'fiend' }, race: 'Human', skillProficiencies: { stealth: 2, perception: 1 } })
      expectStatus(res, 201)
      const c = res.body.character
      expect(c).toMatchObject({ name: 'Hajoš', level: 6, classSummary: 'Monk 5 / Warlock 1', access: 'full', rev: 0, xp: 0, inspiration: false, baseSpeed: 30 })
      expect(c.levels).toHaveLength(6)
      expect(c.levels[0]).toEqual({ classIndex: 'monk', hpRoll: null, choices: {} })
      expect(c.subclasses).toEqual({ monk: 'open-hand', warlock: 'fiend' })
      expect(c.skillProficiencies).toEqual({ stealth: 2, perception: 1 })
      expect(c.abilityScores).toEqual(BASE.abilityScores)
      expect(c.state).toMatchObject({ hpCurrent: null, hpTemp: 0, pactSlotsUsed: 0, conditions: [] })
    })

    it('první level bere vždy plnou kostku (hpRoll se ignoruje), další level přijme hozenou hodnotu', async () => {
      const res = await create(bob, { levels: [{ classIndex: 'fighter', hpRoll: 3 }, { classIndex: 'fighter', hpRoll: 7 }] })
      expect(res.body.character.levels.map((l: { hpRoll: number | null }) => l.hpRoll)).toEqual([null, 7])
    })

    it('odmítá neplatné vlastnosti, třídy a levely', async () => {
      expect((await create(bob, { abilityScores: { ...BASE.abilityScores, str: 0 } })).status).toBe(422)
      expect((await create(bob, { abilityScores: { ...BASE.abilityScores, str: 31 } })).status).toBe(422)
      expect((await create(bob, { abilityScores: { str: 10 } })).status).toBe(422)
      expect((await create(bob, { levels: [] })).status).toBe(422)
      expect((await create(bob, { levels: Array(21).fill({ classIndex: 'fighter' }) })).status).toBe(422)
      expect((await create(bob, { levels: [{ classIndex: 'ninja' }] })).status).toBe(422)
      expect((await create(bob, { levels: [{ classIndex: 'fighter' }, { classIndex: 'fighter', hpRoll: 99 }] })).status).toBe(422)
      expect((await create(bob, { skillProficiencies: { flying: 1 } })).status).toBe(422)
      expect((await create(bob, { skillProficiencies: { stealth: 3 } })).status).toBe(422)
      expect((await create(bob, { baseSpeed: 500 })).status).toBe(422)
    })

    it('subclass se dá vybrat jen k vlastní třídě a od správného levelu', async () => {
      expect((await create(bob, { levels: Array(2).fill({ classIndex: 'monk' }), subclasses: { monk: 'open-hand' } })).status).toBe(422) // až od 3. levelu
      expect((await create(bob, { levels: Array(3).fill({ classIndex: 'monk' }), subclasses: { monk: 'open-hand' } })).status).toBe(201)
      expect((await create(bob, { levels: Array(3).fill({ classIndex: 'monk' }), subclasses: { monk: 'fiend' } })).status).toBe(422) // cizí třída
      expect((await create(bob, { levels: Array(3).fill({ classIndex: 'monk' }), subclasses: { wizard: 'evocation' } })).status).toBe(422) // třídu nemá
      expect((await create(bob, { levels: [{ classIndex: 'warlock' }], subclasses: { warlock: 'fiend' } })).status).toBe(201) // warlock hned od 1.
    })
  })

  describe('úpravy sheetu', () => {
    let id: string
    beforeAll(async () => {
      id = (await create(bob, { name: 'Upravitelná', levels: monk5warlock1 })).body.character.id
    })

    it('vlastník upravuje základní údaje, vlastnosti, dovednosti, přepisy a osobnost', async () => {
      const res = await bob.client.patch(`/characters/${id}`, {
        name: 'Hajoš II', race: 'Elf', background: 'Hermit', alignment: 'CG', description: 'Vysoký.', baseSpeed: 35,
        abilityScores: { str: 12, dex: 18, con: 14, int: 8, wis: 15, cha: 14 },
        skillProficiencies: { stealth: 2 }, extraSaveProficiencies: ['wis'], extraProficiencies: ['Light Armor'],
        overrides: { ac: 17, 'save.wis': 5 },
        personality: { traits: 'Klidný', ideals: 'Řád', bonds: 'Klášter', flaws: 'Pyšný' },
        xp: 1500, inspiration: true, currency: { cp: 1, sp: 2, ep: 0, gp: 30, pp: 1 },
      })
      expectStatus(res, 200)
      expect(res.body.character).toMatchObject({
        name: 'Hajoš II', race: 'Elf', background: 'Hermit', baseSpeed: 35, xp: 1500, inspiration: true,
        skillProficiencies: { stealth: 2 }, extraSaveProficiencies: ['wis'], extraProficiencies: ['Light Armor'],
        overrides: { ac: 17, 'save.wis': 5 }, currency: { cp: 1, sp: 2, ep: 0, gp: 30, pp: 1 },
        personality: { traits: 'Klidný', ideals: 'Řád', bonds: 'Klášter', flaws: 'Pyšný' },
      })
      expect(res.body.character.abilityScores.dex).toBe(18)
      expect(res.body.character.rev).toBeGreaterThan(0)
      // odstranění přepisu = návrat k výpočtu
      const reset = await bob.client.patch(`/characters/${id}`, { overrides: { 'save.wis': 5 } })
      expect(reset.body.character.overrides).toEqual({ 'save.wis': 5 })
      expect((await bob.client.patch(`/characters/${id}`, { overrides: {} })).body.character.overrides).toEqual({})
    })

    it('validuje přepisy, peníze a texty', async () => {
      expect((await bob.client.patch(`/characters/${id}`, { overrides: { 'a b': 1 } })).status).toBe(422)
      expect((await bob.client.patch(`/characters/${id}`, { overrides: { ac: 'abc' } })).status).toBe(422)
      expect((await bob.client.patch(`/characters/${id}`, { currency: { gp: -1 } })).status).toBe(422)
      expect((await bob.client.patch(`/characters/${id}`, { name: '' })).status).toBe(422)
      expect((await bob.client.patch(`/characters/${id}`, { inspiration: 'ano' })).status).toBe(422)
      expect((await bob.client.patch(`/characters/${id}`, { extraSaveProficiencies: ['luck'] })).status).toBe(422)
    })

    it('souběžná úprava: špatná revize vrátí 409 a aktuální sheet', async () => {
      const current = (await bob.client.get(`/characters/${id}`)).body.character
      const ok = await bob.client.patch(`/characters/${id}`, { rev: current.rev, description: 'první' })
      expectStatus(ok, 200)
      const stale = await dm.client.patch(`/characters/${id}`, { rev: current.rev, description: 'druhý' })
      expect(stale.status).toBe(409)
      expect(stale.body.error.code).toBe('conflict')
      expect(stale.body.current.description).toBe('první')
      expect((await dm.client.patch(`/characters/${id}`, { rev: stale.body.current.rev, description: 'druhý' })).status).toBe(200)
    })

    it('stav (HP, sloty, zdroje, stavy) se uloží a vlastní zdroje přežijí', async () => {
      const res = await bob.client.patch(`/characters/${id}`, {
        customResources: [{ key: 'custom.bolts', name: 'Šipky', max: 12, recharge: 'long' }],
        state: { hpCurrent: 20, hpTemp: 3, deathSuccesses: 1, deathFailures: 2, hitDiceUsed: { d8: 2 }, slotsUsed: { '1': 1 }, pactSlotsUsed: 1, resources: { 'monk.ki': 2, 'custom.bolts': 5 }, conditions: ['Poisoned'] },
      })
      expectStatus(res, 200)
      expect(res.body.character.state).toEqual({
        hpCurrent: 20, hpTemp: 3, deathSuccesses: 1, deathFailures: 2, hitDiceUsed: { d8: 2 }, slotsUsed: { '1': 1 }, pactSlotsUsed: 1,
        resources: { 'monk.ki': 2, 'custom.bolts': 5 }, conditions: ['Poisoned'],
      })
      expect(res.body.character.customResources).toEqual([{ key: 'custom.bolts', name: 'Šipky', max: 12, recharge: 'long' }])
      // úprava jen jména nesmí smazat stav ani vlastní zdroje
      const rename = await bob.client.patch(`/characters/${id}`, { name: 'Stále stejný stav' })
      expect(rename.body.character.state.resources).toEqual({ 'monk.ki': 2, 'custom.bolts': 5 })
      expect(rename.body.character.customResources).toHaveLength(1)
    })

    it('odmítá neplatný stav a vlastní zdroje', async () => {
      const bad = (state: unknown) => bob.client.patch(`/characters/${id}`, { state })
      expect((await bad({ hpCurrent: -1 })).status).toBe(422)
      expect((await bad({ deathFailures: 4 })).status).toBe(422)
      expect((await bad({ slotsUsed: { '10': 1 } })).status).toBe(422)
      expect((await bad({ hitDiceUsed: { d7: 1 } })).status).toBe(422)
      expect((await bad({ resources: { 'a b': 1 } })).status).toBe(422)
      expect((await bad({ conditions: [''] })).status).toBe(422)
      const res = (r: unknown) => bob.client.patch(`/characters/${id}`, { customResources: r })
      expect((await res([{ key: 'monk.ki', name: 'x', max: 1, recharge: 'long' }])).status).toBe(422) // klíč musí začínat custom.
      expect((await res([{ key: 'custom.a', name: 'x', max: -1, recharge: 'long' }])).status).toBe(422)
      expect((await res([{ key: 'custom.a', name: 'x', max: 1, recharge: 'hourly' }])).status).toBe(422)
    })

    it('hráč nemůže měnit cizí sheet; viditelnost a majitele může měnit jen DM', async () => {
      expect((await carol.client.patch(`/characters/${id}`, { name: 'Hack' })).status).toBe(403)
      expect((await dave.client.patch(`/characters/${id}`, { name: 'Hack' })).status).toBe(404)
      expect((await bob.client.patch(`/characters/${id}`, { visibility: 'full' })).status).toBe(403)
      expect((await bob.client.patch(`/characters/${id}`, { ownerId: carol.id })).status).toBe(403)
      expect((await dm.client.patch(`/characters/${id}`, { name: 'DM přejmenoval' })).status).toBe(200)
      expect((await bob.client.get(`/characters/${id}`)).body.character.name).toBe('DM přejmenoval')
    })

    it('ostatní hráči v seznamu nevidí žádná pole sheetu (vlastnosti, HP, zdroje, peníze)', async () => {
      const list = (await carol.client.get(`/campaigns/${campaignId}/characters`)).body.characters
      const preview = list.find((c: { id: string }) => c.id === id)
      expect(preview.access).toBe('public')
      for (const secret of ['abilityScores', 'state', 'overrides', 'currency', 'personality', 'notes', 'levels', 'customResources', 'description', 'xp']) {
        expect(preview, secret).not.toHaveProperty(secret)
      }
      expect((await carol.client.get(`/characters/${id}`)).status).toBe(403)
    })
  })

  describe('rychlé úpravy stavu (adjust)', () => {
    let id: string
    beforeAll(async () => {
      id = (await create(bob, { name: 'Adjust', levels: monk5warlock1 })).body.character.id
    })
    const adjust = (user: TestUser, ops: unknown[]) => user.client.post(`/characters/${id}/adjust`, { ops })

    it('HP: změny o delta, ořez na 0 a maximum, první změna startuje z maxima', async () => {
      expect((await adjust(bob, [{ op: 'hp', delta: -5, max: 45 }])).body.state.hpCurrent).toBe(40)
      expect((await adjust(bob, [{ op: 'hp', delta: -100, max: 45 }])).body.state.hpCurrent).toBe(0)
      expect((await adjust(bob, [{ op: 'hp', delta: 7, max: 45 }])).body.state.hpCurrent).toBe(7)
      expect((await adjust(bob, [{ op: 'hp', delta: 500, max: 45 }])).body.state.hpCurrent).toBe(45)
    })

    it('poškození nejdřív spotřebuje dočasná HP', async () => {
      await adjust(bob, [{ op: 'tempHp', set: 5 }])
      const res = await adjust(bob, [{ op: 'hp', delta: -8, max: 45 }])
      expect(res.body.state).toMatchObject({ hpCurrent: 42, hpTemp: 0 })
      await adjust(bob, [{ op: 'hp', delta: 50, max: 45 }])
    })

    it('souběžné kliknutí se nepřepíše: 10 paralelních -1 dá přesně -10', async () => {
      await adjust(dm, [{ op: 'hp', delta: 100, max: 45 }])
      await Promise.all(Array.from({ length: 10 }, (_, i) => adjust(i % 2 ? dm : bob, [{ op: 'hp', delta: -1, max: 45 }])))
      expect((await bob.client.get(`/characters/${id}`)).body.character.state.hpCurrent).toBe(35)
    })

    it('sloty, pact sloty, zdroje, hit dice, death saves, inspirace, XP a stavy', async () => {
      let res = await adjust(bob, [
        { op: 'slot', level: 1, delta: 1, max: 4 },
        { op: 'slot', level: 1, delta: 5, max: 4 },
        { op: 'pact', delta: 1, max: 1 },
        { op: 'resource', key: 'monk.ki', delta: -2, max: 5 },
        { op: 'hitDie', die: 'd8', delta: 2, max: 6 },
        { op: 'deathSave', kind: 'failure', delta: 1 },
        { op: 'deathSave', kind: 'success', delta: 3 },
        { op: 'inspiration', set: true },
        { op: 'xp', delta: 300 },
        { op: 'condition', name: 'Poisoned', set: true },
        { op: 'condition', name: 'Prone', set: true },
        { op: 'condition', name: 'Prone', set: false },
      ])
      expect(res.body.state).toMatchObject({ slotsUsed: { '1': 4 }, pactSlotsUsed: 1, resources: { 'monk.ki': 3 }, hitDiceUsed: { d8: 2 }, deathFailures: 1, deathSuccesses: 3, conditions: ['Poisoned'] })
      expect(res.body).toMatchObject({ xp: 300, inspiration: true })
      res = await adjust(bob, [{ op: 'slot', level: 1, delta: -9, max: 4 }, { op: 'resource', key: 'monk.ki', delta: 99, max: 5 }, { op: 'xp', delta: -1000 }])
      expect(res.body.state.slotsUsed['1']).toBe(0)
      expect(res.body.state.resources['monk.ki']).toBe(5)
      expect(res.body.xp).toBe(0)
    })

    it('neplatné operace se odmítnou a nic se nezmění', async () => {
      const before = (await bob.client.get(`/characters/${id}`)).body.character.state
      expect((await adjust(bob, [])).status).toBe(422)
      expect((await adjust(bob, [{ op: 'hack' }])).status).toBe(422)
      expect((await adjust(bob, [{ op: 'hp', delta: -1, max: 45 }, { op: 'slot', level: 12, delta: 1, max: 1 }])).status).toBe(422)
      expect((await adjust(bob, [{ op: 'hp', delta: 'x', max: 45 }])).status).toBe(422)
      expect((await adjust(bob, [{ op: 'resource', key: 'a b', delta: 1, max: 1 }])).status).toBe(422)
      expect((await adjust(bob, Array(21).fill({ op: 'inspiration', set: true }))).status).toBe(422)
      expect((await bob.client.get(`/characters/${id}`)).body.character.state).toEqual(before)
    })

    it('cizí hráč 403, cizinec 404, DM smí', async () => {
      expect((await adjust(carol, [{ op: 'hp', delta: -1, max: 45 }])).status).toBe(403)
      expect((await adjust(dave, [{ op: 'hp', delta: -1, max: 45 }])).status).toBe(404)
      expect((await adjust(dm, [{ op: 'hp', delta: -1, max: 45 }])).status).toBe(200)
    })
  })

  describe('fotka postavy', () => {
    let id: string
    beforeAll(async () => {
      id = (await create(bob, { name: 'Fotogenická' })).body.character.id
    })
    const upload = (user: TestUser, bytes: Uint8Array, type = 'image/png', name = 'foto.png') => user.client.upload(`/characters/${id}/photo`, 'photo', bytes, name, type)

    it('nahraje nečtvercový obrázek, ořízne ho na čtverec 512 px a ostatní členové ho vidí', async () => {
      const res = await upload(bob, makePng(300, 200))
      expectStatus(res, 200)
      expect(res.body.photoVersion).toMatch(/^[0-9a-f]{10}$/)

      const mine = await bob.client.raw(`/characters/${id}/photo`)
      expect(mine.status).toBe(200)
      expect(mine.headers.get('content-type')).toBe('image/jpeg')
      expect(jpegSize(mine.bytes)).toEqual({ width: 512, height: 512 })

      expect((await carol.client.raw(`/characters/${id}/photo`)).status).toBe(200) // veřejný náhled
      expect((await dave.client.raw(`/characters/${id}/photo`)).status).toBe(404) // cizinec

      const list = (await carol.client.get(`/campaigns/${campaignId}/characters`)).body.characters
      expect(list.find((c: { id: string }) => c.id === id).photoVersion).toBe(res.body.photoVersion)
    })

    it('podporuje cache přes ETag', async () => {
      const first = await bob.client.raw(`/characters/${id}/photo`)
      const etag = first.headers.get('etag')!
      expect(etag).toBeTruthy()
      expect((await bob.client.raw(`/characters/${id}/photo`, { 'If-None-Match': etag })).status).toBe(304)
    })

    it('nahrazení fotky změní verzi', async () => {
      const before = (await bob.client.get(`/characters/${id}`)).body.character.photoVersion
      const res = await upload(bob, makePng(64, 64, [10, 200, 10]))
      expect(res.body.photoVersion).not.toBe(before)
    })

    it('odmítá soubory, které nejsou obrázek, i podvržený typ', async () => {
      const text = await upload(bob, new TextEncoder().encode('<?php echo 1; ?>'), 'image/png', 'evil.php')
      expect(text.status).toBe(422)
      const html = await upload(bob, new TextEncoder().encode('<script>alert(1)</script>'), 'image/jpeg', 'x.jpg')
      expect(html.status).toBe(422)
      const empty = await bob.client.request('POST', `/characters/${id}/photo`, {})
      expect(empty.status).toBe(422)
    })

    it('cizí hráč fotku nezmění, cizinec nic nezjistí; DM smí', async () => {
      expect((await upload(carol, makePng(10, 10))).status).toBe(403)
      expect((await upload(dave, makePng(10, 10))).status).toBe(404)
      expect((await carol.client.delete(`/characters/${id}/photo`)).status).toBe(403)
      expect((await upload(dm, makePng(40, 20))).status).toBe(200)
    })

    it('smazání fotky', async () => {
      expect((await bob.client.delete(`/characters/${id}/photo`)).status).toBe(204)
      expect((await bob.client.raw(`/characters/${id}/photo`)).status).toBe(404)
      expect((await bob.client.get(`/characters/${id}`)).body.character.photoVersion).toBeNull()
    })
  })

  describe('data pro engine a featury tříd', () => {
    it('engine vrací třídy a tabulky levelů', async () => {
      const res = await bob.client.get('/rules/engine')
      expectStatus(res, 200)
      expect(res.body.classes).toHaveLength(12)
      expect(res.body.levels.length).toBeGreaterThanOrEqual(290)
      const monk = res.body.classes.find((c: { idx: string }) => c.idx === 'monk')
      expect(monk.data.hit_die).toBe(8)
      const monk5 = res.body.levels.find((l: { idx: string }) => l.idx === 'monk-5')
      expect(monk5.data.class_specific.ki_points).toBe(5)
      expect((await new (await import('./client')).Client().get('/rules/engine')).status).toBe(401)
    })

    it('featury Monk 5 / Open Hand obsahují Extra Attack, Stunning Strike a Open Hand Technique s popisem', async () => {
      const res = await bob.client.get('/rules/class-features?class=monk&level=5&subclass=open-hand')
      expectStatus(res, 200)
      const names = res.body.features.map((f: { name: string }) => f.name)
      expect(names).toEqual(expect.arrayContaining(['Ki', 'Extra Attack', 'Stunning Strike', 'Open Hand Technique']))
      const stun = res.body.features.find((f: { name: string }) => f.name === 'Stunning Strike')
      expect(stun.description).toMatch(/stun/i)
      expect(stun).toMatchObject({ level: 5, source: 'class', className: 'Monk' })
      expect(res.body.features.find((f: { name: string }) => f.name === 'Open Hand Technique')).toMatchObject({ level: 3, source: 'subclass' })
      expect(names).not.toContain('Wholeness of Body') // až od 6. levelu
    })

    it('neplatná třída', async () => {
      expect((await bob.client.get('/rules/class-features?class=ninja&level=3')).status).toBe(404)
      expect((await bob.client.get('/rules/class-features?class=x%27%20OR%201&level=3')).status).toBe(422)
    })
  })
})
