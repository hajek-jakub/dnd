import { beforeAll, describe, expect, it } from 'vitest'
import { Client, createCampaign, expectStatus, joinAsPlayer, registerUser, type TestUser } from './client'

describe('přehled NPC v deníku', () => {
  let dm: TestUser
  let bob: TestUser
  let carol: TestUser
  let eve: TestUser
  let campaignId: string

  const scores = { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }
  const addNpc = (user: TestUser, body: Record<string, unknown>, cid: string = campaignId) => user.client.post(`/campaigns/${cid}/journal/npcs`, body)
  const npcs = async (user: TestUser, cid: string = campaignId) => {
    const res = await user.client.get(`/campaigns/${cid}/journal/npcs`)
    expectStatus(res, 200)
    return res.body.npcs as any[]
  }
  const names = async (user: TestUser) => (await npcs(user)).map((n) => n.name)
  const entry = (user: TestUser, body: Record<string, unknown> = {}) => user.client.post(`/campaigns/${campaignId}/journal`, { title: 'Zápis', ...body })
  const entryOf = async (user: TestUser, id: string) => ((await user.client.get(`/campaigns/${campaignId}/journal`)).body.entries as any[]).find((e) => e.id === id)
  const character = async (user: TestUser, body: Record<string, unknown>) => {
    const res = await user.client.post(`/campaigns/${campaignId}/characters`, { abilityScores: scores, levels: [{ classIndex: 'fighter' }], ...body })
    expectStatus(res, 201)
    return res.body.character.id as string
  }

  beforeAll(async () => {
    dm = await registerUser('npcdm')
    campaignId = await createCampaign(dm, 'NPC deník')
    bob = await joinAsPlayer(dm, campaignId, 'bob')
    carol = await joinAsPlayer(dm, campaignId, 'carol')
    eve = await registerUser('eve')
  })

  it('anonym 401, cizinec 404 na všech trasách', async () => {
    const created = (await addNpc(bob, { name: 'Gorim' })).body.npc
    const anon = new Client()
    expect((await anon.get(`/campaigns/${campaignId}/journal/npcs`)).status).toBe(401)
    expect((await anon.post(`/campaigns/${campaignId}/journal/npcs`, { name: 'x' })).status).toBe(401)
    expect((await anon.patch(`/journal-npcs/${created.id}`, { name: 'x' })).status).toBe(401)
    expect((await anon.delete(`/journal-npcs/${created.id}`)).status).toBe(401)
    expectStatus(await eve.client.get(`/campaigns/${campaignId}/journal/npcs`), 404)
    expectStatus(await addNpc(eve, { name: 'Cizí' }), 404)
    expectStatus(await eve.client.patch(`/journal-npcs/${created.id}`, { name: 'x' }), 404)
    expectStatus(await eve.client.delete(`/journal-npcs/${created.id}`), 404)
  })

  describe('NPC a oprávnění', () => {
    it('NPC přidá každý člen, vidí ho celá družina a seznam je abecední', async () => {
      const a = await addNpc(bob, { name: 'Zelda', race: 'Elf', description: 'Léčitelka z **vesnice**' })
      expectStatus(a, 201)
      expect(a.body.npc).toMatchObject({ name: 'Zelda', race: 'Elf', description: 'Léčitelka z **vesnice**', visibility: 'all', characterId: null, mine: true, canEdit: true })
      expectStatus(await addNpc(dm, { name: 'Alrik', race: 'Člověk' }), 201)
      expectStatus(await addNpc(carol, { name: 'Marta' }), 201)
      for (const u of [dm, bob, carol]) {
        const list = await names(u)
        expect(list).toEqual(expect.arrayContaining(['Alrik', 'Marta', 'Zelda']))
        expect(list.indexOf('Alrik')).toBeLessThan(list.indexOf('Marta'))
        expect(list.indexOf('Marta')).toBeLessThan(list.indexOf('Zelda'))
      }
      expect((await npcs(carol)).find((n) => n.name === 'Zelda')).toMatchObject({ mine: false, canEdit: false })
      expect((await npcs(dm)).find((n) => n.name === 'Zelda')).toMatchObject({ canEdit: true, createdByName: expect.any(String) })
    })

    it('upravit a smazat smí autor a DM, cizí hráč ne', async () => {
      const n = (await addNpc(bob, { name: 'Kovář Brom' })).body.npc
      expectStatus(await carol.client.patch(`/journal-npcs/${n.id}`, { name: 'Hacknuto' }), 403)
      expectStatus(await carol.client.delete(`/journal-npcs/${n.id}`), 403)
      const edit = await bob.client.patch(`/journal-npcs/${n.id}`, { race: 'Trpaslík', description: 'Kuje meče' })
      expectStatus(edit, 200)
      expect(edit.body.npc).toMatchObject({ name: 'Kovář Brom', race: 'Trpaslík', description: 'Kuje meče' })
      expectStatus(await dm.client.patch(`/journal-npcs/${n.id}`, { name: 'Brom' }), 200)
      expectStatus(await bob.client.delete(`/journal-npcs/${n.id}`), 204)
      expect(await names(dm)).not.toContain('Brom')
      const own = (await addNpc(carol, { name: 'Carolino' })).body.npc
      expectStatus(await dm.client.delete(`/journal-npcs/${own.id}`), 204)
    })

    it('viditelnost nastavuje jen DM; skrytého NPC hráč nevidí ani nezmění', async () => {
      expectStatus(await addNpc(bob, { name: 'Tajný', visibility: 'dm' }), 403)
      expectStatus(await addNpc(dm, { name: 'x', visibility: 'owner' }), 422)
      const hidden = (await addNpc(dm, { name: 'Zrádce Varis', race: 'Půlelf', visibility: 'dm' })).body.npc
      expect(await names(dm)).toContain('Zrádce Varis')
      for (const u of [bob, carol]) expect(await names(u)).not.toContain('Zrádce Varis')
      expectStatus(await bob.client.patch(`/journal-npcs/${hidden.id}`, { name: 'x' }), 404)
      expectStatus(await bob.client.delete(`/journal-npcs/${hidden.id}`), 404)
      // hráč nemůže NPC ani odkrýt
      const mine = (await addNpc(bob, { name: 'Bobovo NPC' })).body.npc
      expectStatus(await bob.client.patch(`/journal-npcs/${mine.id}`, { visibility: 'dm' }), 403)
      // DM ho odkryje a družina ho uvidí
      expectStatus(await dm.client.patch(`/journal-npcs/${hidden.id}`, { visibility: 'all' }), 200)
      expect(await names(bob)).toContain('Zrádce Varis')
      expectStatus(await dm.client.patch(`/journal-npcs/${hidden.id}`, { visibility: 'dm' }), 200)
      expect(await names(bob)).not.toContain('Zrádce Varis')
    })

    it('validace jména, rasy, popisu a text se vrací beze změny', async () => {
      expectStatus(await addNpc(bob, {}), 422)
      expectStatus(await addNpc(bob, { name: '  ' }), 422)
      expectStatus(await addNpc(bob, { name: 'x'.repeat(101) }), 422)
      expectStatus(await addNpc(bob, { name: 'Ok', race: 'x'.repeat(101) }), 422)
      expectStatus(await addNpc(bob, { name: 'Ok', description: 'x'.repeat(5001) }), 422)
      expectStatus(await addNpc(bob, { name: 'x'.repeat(100), description: 'x'.repeat(5000) }), 201)
      const html = await addNpc(bob, { name: '<b>Jméno</b>', race: '<i>rasa</i>', description: '<img src=x onerror=alert(1)>' })
      expect(html.body.npc).toMatchObject({ name: '<b>Jméno</b>', race: '<i>rasa</i>', description: '<img src=x onerror=alert(1)>' })
      const n = html.body.npc
      expectStatus(await bob.client.patch(`/journal-npcs/${n.id}`, { name: '' }), 422)
      expectStatus(await bob.client.patch(`/journal-npcs/${n.id}`, { description: 5 }), 422)
    })

    it('NPC jedné kampaně se neukáže v jiné a zmizí s kampaní', async () => {
      const other = await createCampaign(dm, 'Jiná')
      expect(await npcs(dm, other)).toEqual([])
      expectStatus(await addNpc(dm, { name: 'Jen tady' }, other), 201)
      expectStatus(await dm.client.delete(`/campaigns/${other}`), 204)
      expectStatus(await dm.client.get(`/campaigns/${other}/journal/npcs`), 404)
    })
  })

  describe('postavy a NPC z kampaně', () => {
    it('postavu a NPC postavu jde přidat do přehledu, jméno a rasa jdou podle postavy', async () => {
      const pc = await character(bob, { name: 'Hajoš', race: 'Human' })
      const npcChar = (await dm.client.post(`/campaigns/${campaignId}/characters`, { kind: 'npc', name: 'Hostinský Tom', race: 'Halfling', abilityScores: scores, levels: [{ classIndex: 'fighter' }] })).body.character.id
      const res = await addNpc(carol, { characterIds: [pc, npcChar] })
      expectStatus(res, 201)
      expect(res.body.npcs).toHaveLength(2)
      const byName = Object.fromEntries(res.body.npcs.map((n: any) => [n.name, n]))
      expect(byName['Hajoš']).toMatchObject({ race: 'Human', characterId: pc, characterKind: 'pc' })
      expect(byName['Hostinský Tom']).toMatchObject({ race: 'Halfling', characterId: npcChar, characterKind: 'npc' })

      // jméno a rasu přebírá postava
      expectStatus(await bob.client.patch(`/characters/${pc}`, { name: 'Hajoš Mnich', race: 'Dwarf' }), 200)
      expect((await npcs(carol)).find((n) => n.characterId === pc)).toMatchObject({ name: 'Hajoš Mnich', race: 'Dwarf' })
      const id = byName['Hajoš'].id
      expectStatus(await carol.client.patch(`/journal-npcs/${id}`, { name: 'Jinak' }), 422)
      expectStatus(await carol.client.patch(`/journal-npcs/${id}`, { race: 'Elf' }), 422)
      const desc = await carol.client.patch(`/journal-npcs/${id}`, { description: 'Mnich z Mirabilis' })
      expectStatus(desc, 200)
      expect(desc.body.npc).toMatchObject({ name: 'Hajoš Mnich', description: 'Mnich z Mirabilis' })

      // jednou stačí
      expectStatus(await addNpc(bob, { characterIds: [pc] }), 422)

      // smazaná postava: záznam zůstane s posledním jménem a jde pak upravit
      expectStatus(await bob.client.delete(`/characters/${pc}`), 204)
      const left = (await npcs(dm)).find((n) => n.id === id)
      expect(left).toMatchObject({ name: 'Hajoš Mnich', characterId: null, characterKind: null })
      expectStatus(await carol.client.patch(`/journal-npcs/${id}`, { name: 'Hajoš (bývalý)' }), 200)
    })

    it('postava z jiné kampaně, neplatné a prázdné seznamy se odmítnou', async () => {
      const other = await createCampaign(dm, 'Jiná s postavou')
      const foreign = (await dm.client.post(`/campaigns/${other}/characters`, { kind: 'npc', name: 'Cizí', abilityScores: scores, levels: [{ classIndex: 'fighter' }] })).body.character.id
      expectStatus(await addNpc(dm, { characterIds: [foreign] }), 422)
      expectStatus(await addNpc(dm, { characterIds: [] }), 422)
      expectStatus(await addNpc(dm, { characterIds: ['nic'] }), 422)
      expectStatus(await addNpc(dm, { characterIds: '5' }), 422)
      expectStatus(await addNpc(dm, { characterIds: [foreign, foreign] }), 422)
    })

    it('hromadné přidání je všechno nebo nic', async () => {
      const a = await character(bob, { name: 'Hromadná A' })
      const before = (await npcs(dm)).length
      expectStatus(await addNpc(dm, { characterIds: [a, '00000000-0000-4000-8000-000000000000'] }), 422)
      expect((await npcs(dm)).length).toBe(before)
      expectStatus(await addNpc(dm, { characterIds: [a] }), 201)
      expect((await npcs(dm)).length).toBe(before + 1)
    })
  })

  describe('propojení se zápisy deníku', () => {
    it('zápis se dá založit i upravit s NPC a NPC vidí všichni, kdo vidí zápis', async () => {
      const gorim = (await addNpc(bob, { name: 'Gorim Link' })).body.npc
      const marta = (await addNpc(carol, { name: 'Marta Link' })).body.npc
      const created = await entry(bob, { npcIds: [gorim.id, marta.id, gorim.id] })
      expectStatus(created, 201)
      expect([...created.body.entry.npcIds].sort()).toEqual([gorim.id, marta.id].sort())
      expect([...(await entryOf(carol, created.body.entry.id)).npcIds].sort()).toEqual([gorim.id, marta.id].sort())

      const upd = await bob.client.patch(`/journal/${created.body.entry.id}`, { npcIds: [marta.id] })
      expectStatus(upd, 200)
      expect(upd.body.entry.npcIds).toEqual([marta.id])
      // bez npcIds se propojení nemění
      expectStatus(await bob.client.patch(`/journal/${created.body.entry.id}`, { title: 'Nový nadpis' }), 200)
      expect((await entryOf(bob, created.body.entry.id)).npcIds).toEqual([marta.id])
      expectStatus(await bob.client.patch(`/journal/${created.body.entry.id}`, { npcIds: [] }), 200)
      expect((await entryOf(bob, created.body.entry.id)).npcIds).toEqual([])
      // cizí hráč cizí zápis nepřiřadí
      expectStatus(await carol.client.patch(`/journal/${created.body.entry.id}`, { npcIds: [gorim.id] }), 403)
    })

    it('smazané NPC zmizí ze zápisu a smazaný zápis neodstraní NPC', async () => {
      const n = (await addNpc(dm, { name: 'Na smazání' })).body.npc
      const e = (await entry(dm, { npcIds: [n.id] })).body.entry
      expectStatus(await dm.client.delete(`/journal-npcs/${n.id}`), 204)
      expect((await entryOf(dm, e.id)).npcIds).toEqual([])
      const n2 = (await addNpc(dm, { name: 'Zůstane' })).body.npc
      const e2 = (await entry(dm, { npcIds: [n2.id] })).body.entry
      expectStatus(await dm.client.delete(`/journal/${e2.id}`), 204)
      expect(await names(dm)).toContain('Zůstane')
    })

    it('neplatná nebo cizí NPC se odmítnou', async () => {
      const other = await createCampaign(dm, 'Jiná s NPC')
      const foreign = (await addNpc(dm, { name: 'Z jiné kampaně' }, other)).body.npc
      expectStatus(await entry(dm, { npcIds: [foreign.id] }), 422)
      expectStatus(await entry(dm, { npcIds: ['00000000-0000-4000-8000-000000000000'] }), 422)
      expectStatus(await entry(dm, { npcIds: ['x'] }), 422)
      expectStatus(await entry(dm, { npcIds: 'x' }), 422)
      expectStatus(await entry(dm, { npcIds: Array.from({ length: 31 }, () => '00000000-0000-4000-8000-000000000000') }), 422)
    })

    it('skryté NPC hráč nepřiřadí, nevidí ho u zápisu a jeho úprava propojení neruší', async () => {
      const hidden = (await addNpc(dm, { name: 'Skrytý spiklenec', visibility: 'dm' })).body.npc
      const open = (await addNpc(dm, { name: 'Veřejný' })).body.npc
      expectStatus(await entry(bob, { npcIds: [hidden.id] }), 422)

      const e = (await entry(bob, { title: 'Bobův zápis o spiklenci', npcIds: [open.id] })).body.entry
      // DM k zápisu přiřadí i skryté NPC
      const byDm = await dm.client.patch(`/journal/${e.id}`, { npcIds: [open.id, hidden.id] })
      expectStatus(byDm, 200)
      expect([...byDm.body.entry.npcIds].sort()).toEqual([open.id, hidden.id].sort())
      // hráč skryté NPC nevidí, ani jeho id
      expect((await entryOf(bob, e.id)).npcIds).toEqual([open.id])
      expect((await entryOf(carol, e.id)).npcIds).toEqual([open.id])
      // hráč zápis upraví a NPC odebere: skryté propojení DM zůstane
      expectStatus(await bob.client.patch(`/journal/${e.id}`, { npcIds: [] }), 200)
      expect((await entryOf(bob, e.id)).npcIds).toEqual([])
      expect((await entryOf(dm, e.id)).npcIds).toEqual([hidden.id])
      // po odkrytí NPC ho družina u zápisu uvidí
      expectStatus(await dm.client.patch(`/journal-npcs/${hidden.id}`, { visibility: 'all' }), 200)
      expect((await entryOf(bob, e.id)).npcIds).toEqual([hidden.id])
    })

    it('změna NPC u zápisu ho ostatním označí jako novou úpravu', async () => {
      const n = (await addNpc(dm, { name: 'Pro novinku' })).body.npc
      const e = (await entry(bob, { title: 'Úprava přes NPC' })).body.entry
      await new Promise((r) => setTimeout(r, 1100)) // časy jsou na sekundy
      expectStatus(await carol.client.post(`/campaigns/${campaignId}/journal/read`, {}), 200)
      await new Promise((r) => setTimeout(r, 1100))
      expectStatus(await bob.client.patch(`/journal/${e.id}`, { npcIds: [n.id] }), 200)
      expect((await entryOf(carol, e.id)).isNew).toBe(true)
    })
  })
})
