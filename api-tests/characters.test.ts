import { beforeAll, describe, expect, it } from 'vitest'
import { createCampaign, expectStatus, joinAsPlayer, registerUser, type TestUser } from './client'

// Zadání: hráč nesmí přes API přečíst ani změnit cizí postavu, DM poznámky (a později zprávy).

/** Minimální platné tělo pro vytvoření postavy (vlastnosti a levely jsou povinné). */
const BASE = {
  abilityScores: { str: 10, dex: 14, con: 12, int: 10, wis: 13, cha: 8 },
  levels: [{ classIndex: 'monk', hpRoll: null }],
}

describe('postavy a DM poznámky: oprávnění', () => {
  let dm: TestUser
  let bob: TestUser
  let carol: TestUser
  let dave: TestUser // cizinec
  let campaignId: string
  let otherCampaignId: string
  let bobChar: string
  let carolChar: string

  beforeAll(async () => {
    dm = await registerUser('dm')
    campaignId = await createCampaign(dm, 'Hlavní')
    otherCampaignId = await createCampaign(dm, 'Jiná')
    bob = await joinAsPlayer(dm, campaignId, 'bob')
    carol = await joinAsPlayer(dm, campaignId, 'carol')
    dave = await registerUser('dave')

    const b = await bob.client.post(`/campaigns/${campaignId}/characters`, {
      ...BASE,
      levels: [...Array(5).fill({ classIndex: 'monk', hpRoll: null }), { classIndex: 'warlock', hpRoll: null }],
      subclasses: { monk: 'open-hand' },
      name: 'Hajoš', race: 'Human', notes: 'TAJNÉ: bobova poznámka',
    })
    expectStatus(b, 201)
    bobChar = b.body.character.id
    const c = await carol.client.post(`/campaigns/${campaignId}/characters`, { ...BASE, name: 'Carolina postava', notes: 'carol soukromě' })
    expectStatus(c, 201)
    carolChar = c.body.character.id
  })

  it('majitel vidí vše o své postavě, včetně soukromých poznámek', async () => {
    const res = await bob.client.get(`/characters/${bobChar}`)
    expect(res.status).toBe(200)
    expect(res.body.character).toMatchObject({ name: 'Hajoš', notes: 'TAJNÉ: bobova poznámka', visibility: 'public_only', access: 'full' })
  })

  it('ostatní hráči vidí v seznamu jen veřejný náhled bez soukromých polí', async () => {
    const res = await carol.client.get(`/campaigns/${campaignId}/characters`)
    expect(res.status).toBe(200)
    const hajos = res.body.characters.find((c: { id: string }) => c.id === bobChar)
    expect(hajos).toBeDefined()
    expect(hajos).toMatchObject({ name: 'Hajoš', race: 'Human', classSummary: 'Monk 5 / Warlock 1', level: 6, access: 'public' })
    expect(Object.keys(hajos).sort()).toEqual(['access', 'campaignId', 'classSummary', 'id', 'level', 'name', 'ownerId', 'photoVersion', 'race'])
    expect(JSON.stringify(res.body)).not.toContain('TAJNÉ')
    // vlastní postavu vidí celou
    expect(res.body.characters.find((c: { id: string }) => c.id === carolChar).notes).toBe('carol soukromě')
  })

  it('hráč nepřečte cizí postavu přímo (403) a nemůže ji změnit ani smazat', async () => {
    expect((await carol.client.get(`/characters/${bobChar}`)).status).toBe(403)
    expect((await carol.client.patch(`/characters/${bobChar}`, { name: 'Hacknuto', notes: 'hack' })).status).toBe(403)
    expect((await carol.client.delete(`/characters/${bobChar}`)).status).toBe(403)
    const after = await bob.client.get(`/characters/${bobChar}`)
    expect(after.body.character).toMatchObject({ name: 'Hajoš', notes: 'TAJNÉ: bobova poznámka' })
  })

  it('hráč si nemůže sám povolit viditelnost, předat postavu ani vytvořit postavu na cizí jméno', async () => {
    expect((await bob.client.patch(`/characters/${bobChar}`, { visibility: 'full' })).status).toBe(403)
    expect((await bob.client.patch(`/characters/${bobChar}`, { ownerId: carol.id })).status).toBe(403)
    expect((await bob.client.post(`/campaigns/${campaignId}/characters`, { ...BASE, name: 'Podvrh', ownerId: carol.id })).status).toBe(403)
    expect((await bob.client.post(`/campaigns/${campaignId}/characters`, { ...BASE, name: 'Podvrh', visibility: 'full' })).status).toBe(403)
    expect((await bob.client.get(`/characters/${bobChar}`)).body.character.visibility).toBe('public_only')
  })

  it('postavu nelze přesunout do jiné kampaně', async () => {
    const res = await dm.client.patch(`/characters/${bobChar}`, { campaignId: otherCampaignId, name: 'Hajoš' })
    expect(res.status).toBe(200)
    expect(res.body.character.campaignId).toBe(campaignId)
    // a DM kampaně 2 (jiný uživatel) by do ní stejně nevložil cizí postavu
    const intruder = await registerUser('intruder')
    expect((await intruder.client.post(`/campaigns/${campaignId}/characters`, { ...BASE, name: 'Vetřelec' })).status).toBe(404)
  })

  it('cizinec nevidí nic: ani seznam, ani postavu, ani veřejný náhled', async () => {
    expect((await dave.client.get(`/campaigns/${campaignId}/characters`)).status).toBe(404)
    expect((await dave.client.get(`/characters/${bobChar}`)).status).toBe(404)
    expect((await dave.client.patch(`/characters/${bobChar}`, { name: 'Hack' })).status).toBe(404)
    expect((await dave.client.delete(`/characters/${bobChar}`)).status).toBe(404)
    expect((await dave.client.post(`/campaigns/${campaignId}/characters`, { ...BASE, name: 'Votrok' })).status).toBe(404)
    expect((await dave.client.get('/characters/neexistuje')).status).toBe(404)
  })

  it('DM vidí a upravuje všechny postavy; po povolení vidí ostatní celou postavu, ale pořád ji nemění', async () => {
    const all = await dm.client.get(`/campaigns/${campaignId}/characters`)
    expect(all.body.characters).toHaveLength(2)
    expect(all.body.characters.every((c: { access: string }) => c.access === 'full')).toBe(true)

    expect((await dm.client.patch(`/characters/${bobChar}`, { xp: 7000 })).body.character.xp).toBe(7000)

    expect((await dm.client.patch(`/characters/${bobChar}`, { visibility: 'full' })).status).toBe(200)
    const carolView = await carol.client.get(`/characters/${bobChar}`)
    expect(carolView.status).toBe(200)
    expect(carolView.body.character.notes).toBe('TAJNÉ: bobova poznámka')
    expect((await carol.client.patch(`/characters/${bobChar}`, { name: 'Hacknuto' })).status).toBe(403)

    // vrátit zpět, ať ostatní testy nejsou ovlivněné
    await dm.client.patch(`/characters/${bobChar}`, { visibility: 'public_only' })
    expect((await carol.client.get(`/characters/${bobChar}`)).status).toBe(403)
  })

  it('DM může postavu předat jen členovi kampaně', async () => {
    expect((await dm.client.patch(`/characters/${carolChar}`, { ownerId: dave.id })).status).toBe(422)
    expect((await dm.client.patch(`/characters/${carolChar}`, { ownerId: 'neni-uuid' })).status).toBe(422)
  })

  it('vstup se validuje a SQL injection je jen text', async () => {
    expect((await bob.client.post(`/campaigns/${campaignId}/characters`, { ...BASE, name: '' })).status).toBe(422)
    expect((await bob.client.post(`/campaigns/${campaignId}/characters`, { name: 'bez vlastností' })).status).toBe(422)
    expect((await bob.client.post(`/campaigns/${campaignId}/characters`, { ...BASE, name: 'x', levels: [] })).status).toBe(422)
    expect((await bob.client.post(`/campaigns/${campaignId}/characters`, { ...BASE, name: 'x', levels: [{ classIndex: 'ninja' }] })).status).toBe(422)
    const evil = "Robert'); DROP TABLE users;--"
    const res = await bob.client.post(`/campaigns/${campaignId}/characters`, { ...BASE, name: evil })
    expect(res.status).toBe(201)
    expect(res.body.character.name).toBe(evil)
    expect((await bob.client.get('/auth/me')).body.user).not.toBeNull() // tabulka users stále existuje
    await bob.client.delete(`/characters/${res.body.character.id}`)
  })

  describe('DM poznámky', () => {
    let noteId: string

    beforeAll(async () => {
      const res = await dm.client.post(`/campaigns/${campaignId}/dm-notes`, { body: 'Bob něco tají', characterId: bobChar })
      expectStatus(res, 201)
      noteId = res.body.note.id
    })

    it('DM je vidí a upravuje', async () => {
      expect((await dm.client.get(`/campaigns/${campaignId}/dm-notes`)).body.notes).toHaveLength(1)
      expect((await dm.client.patch(`/dm-notes/${noteId}`, { body: 'Upraveno' })).body.note.body).toBe('Upraveno')
    })

    it('hráč je nepřečte, nevytvoří, nezmění ani nesmaže', async () => {
      expect((await bob.client.get(`/campaigns/${campaignId}/dm-notes`)).status).toBe(403)
      expect((await bob.client.post(`/campaigns/${campaignId}/dm-notes`, { body: 'hráčská' })).status).toBe(403)
      expect((await bob.client.patch(`/dm-notes/${noteId}`, { body: 'přepsáno' })).status).toBe(403)
      expect((await bob.client.delete(`/dm-notes/${noteId}`)).status).toBe(403)
      const notes = await dm.client.get(`/campaigns/${campaignId}/dm-notes`)
      expect(notes.body.notes[0].body).toBe('Upraveno')
    })

    it('DM poznámky se neobjeví nikde v datech postavy ani kampaně', async () => {
      const char = await bob.client.get(`/characters/${bobChar}`)
      const camp = await bob.client.get(`/campaigns/${campaignId}`)
      expect(JSON.stringify([char.body, camp.body])).not.toContain('Upraveno')
    })

    it('cizinec nemá k poznámkám přístup', async () => {
      expect((await dave.client.get(`/campaigns/${campaignId}/dm-notes`)).status).toBe(404)
      expect((await dave.client.patch(`/dm-notes/${noteId}`, { body: 'x' })).status).toBe(404)
      expect((await dave.client.delete(`/dm-notes/${noteId}`)).status).toBe(404)
    })

    it('poznámka nemůže odkazovat na postavu z jiné kampaně', async () => {
      const foreign = await dm.client.post(`/campaigns/${otherCampaignId}/characters`, { ...BASE, name: 'Cizí' })
      expectStatus(foreign, 201)
      const res = await dm.client.post(`/campaigns/${campaignId}/dm-notes`, { body: 'x', characterId: foreign.body.character.id })
      expect(res.status).toBe(422)
    })
  })

  it('smazání postavy odstraní i její DM poznámky, ostatní zůstanou', async () => {
    const temp = await bob.client.post(`/campaigns/${campaignId}/characters`, { ...BASE, name: 'Dočasná' })
    expectStatus(temp, 201)
    await dm.client.post(`/campaigns/${campaignId}/dm-notes`, { body: 'k dočasné', characterId: temp.body.character.id })
    const before = (await dm.client.get(`/campaigns/${campaignId}/dm-notes`)).body.notes.length
    expect((await bob.client.delete(`/characters/${temp.body.character.id}`)).status).toBe(204)
    const after = (await dm.client.get(`/campaigns/${campaignId}/dm-notes`)).body.notes.length
    expect(after).toBe(before - 1)
  })
})
