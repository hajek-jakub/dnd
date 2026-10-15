import { beforeAll, describe, expect, it } from 'vitest'
import { Client, createCampaign, expectStatus, joinAsPlayer, registerUser, type TestUser } from './client'

describe('taktiky postavy', () => {
  let dm: TestUser
  let bob: TestUser
  let carol: TestUser
  let eve: TestUser
  let campaignId: string
  let bobChar: string
  let carolChar: string

  const base = { abilityScores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }, levels: [{ classIndex: 'fighter' }] }
  const add = (user: TestUser, char: string, body: Record<string, unknown>) => user.client.post(`/characters/${char}/tactics`, body)
  const list = async (user: TestUser, char: string) => {
    const res = await user.client.get(`/characters/${char}/tactics`)
    expectStatus(res, 200)
    return res.body.tactics as any[]
  }

  beforeAll(async () => {
    dm = await registerUser('dm')
    campaignId = await createCampaign(dm, 'Taktiky')
    bob = await joinAsPlayer(dm, campaignId, 'bob')
    carol = await joinAsPlayer(dm, campaignId, 'carol')
    eve = await registerUser('eve')
    bobChar = (await bob.client.post(`/campaigns/${campaignId}/characters`, { ...base, name: 'Bob' })).body.character.id
    carolChar = (await carol.client.post(`/campaigns/${campaignId}/characters`, { ...base, name: 'Carol' })).body.character.id
  })

  describe('oprávnění', () => {
    it('anonym 401, cizinec 404', async () => {
      const anon = new Client()
      expect((await anon.get(`/characters/${bobChar}/tactics`)).status).toBe(401)
      expect((await anon.post(`/characters/${bobChar}/tactics`, { kind: 'rule', title: 'x', text: 'y' })).status).toBe(401)
      expectStatus(await eve.client.get(`/characters/${bobChar}/tactics`), 404)
      expectStatus(await add(eve, bobChar, { kind: 'rule', title: 'x', text: 'y' }), 404)
    })

    it('majitel a DM čtou i upravují, jiný hráč nečte (403) ani nemění', async () => {
      const mine = await add(bob, bobChar, { kind: 'rule', title: 'Moje', text: 'Poučka' })
      expectStatus(mine, 201)
      expectStatus(await add(dm, bobChar, { kind: 'rule', title: 'Od DM', text: 'DM poučka' }), 201)
      expect((await list(bob, bobChar)).map((t) => t.title)).toEqual(['Moje', 'Od DM'])
      expect((await list(dm, bobChar)).length).toBe(2)
      expectStatus(await carol.client.get(`/characters/${bobChar}/tactics`), 403)
      expectStatus(await add(carol, bobChar, { kind: 'rule', title: 'Hack', text: 'x' }), 403)
      const id = mine.body.tactic.id
      expectStatus(await carol.client.patch(`/tactics/${id}`, { title: 'Hack' }), 403)
      expectStatus(await carol.client.delete(`/tactics/${id}`), 403)
      expectStatus(await eve.client.patch(`/tactics/${id}`, { title: 'Hack' }), 404)
      expectStatus(await eve.client.delete(`/tactics/${id}`), 404)
      expect((await list(bob, bobChar)).map((t) => t.title)).toEqual(['Moje', 'Od DM'])
    })

    it('postava s visibility full je čitelná i pro ostatní členy, ale pořád ne měnitelná', async () => {
      await dm.client.patch(`/characters/${carolChar}`, { visibility: 'full' })
      await add(carol, carolChar, { kind: 'rule', title: 'Veřejná', text: 'x' })
      expect((await list(bob, carolChar)).map((t) => t.title)).toEqual(['Veřejná'])
      expectStatus(await add(bob, carolChar, { kind: 'rule', title: 'Hack', text: 'x' }), 403)
    })

    it('taktiky mizí s postavou', async () => {
      const c = (await bob.client.post(`/campaigns/${campaignId}/characters`, { ...base, name: 'Pomíjivý' })).body.character.id
      const t = (await add(bob, c, { kind: 'rule', title: 'x', text: 'y' })).body.tactic.id
      expectStatus(await bob.client.delete(`/characters/${c}`), 204)
      expectStatus(await bob.client.patch(`/tactics/${t}`, { title: 'z' }), 404)
    })
  })

  describe('druhy a jejich data', () => {
    it('všech šest druhů se uloží s výchozími hodnotami a normalizovanými poli', async () => {
      const c = (await bob.client.post(`/campaigns/${campaignId}/characters`, { ...base, name: 'Druhy' })).body.character.id
      const attack = (await add(bob, c, { kind: 'attack', title: 'Kopí', toHit: 'd20+8', damage: '1d8+5 + 1d4 fire', actionType: 'action', cost: 'free', range: '5 ft', ignored: 'zahodit' })).body.tactic
      expect(attack.data).toEqual({ actionType: 'action', toHit: 'd20+8', damage: '1d8+5 + 1d4 fire', roll: '', range: '5 ft', usage: '', note: '', cost: 'free', hex: true, count: 1, ammo: '' })
      const spell = (await add(bob, c, { kind: 'spell', title: 'Hex', level: 1, actionType: 'bonus', range: '90 ft', duration: '1 hodina', concentration: true, save: '', effect: '+1d6 necrotic', cost: 'slot:1' })).body.tactic
      expect(spell.data).toMatchObject({ level: 1, actionType: 'bonus', concentration: true, cost: 'slot:1' })
      const ki = (await add(bob, c, { kind: 'ki', title: 'Flurry', cost: 'ki:1', actionType: 'bonus', description: 'Dva údery' })).body.tactic
      expect(ki.data).toEqual({ actionType: 'bonus', cost: 'ki:1', description: 'Dva údery', toHit: '', damage: '', roll: '', count: 1, hex: false })
      const passive = (await add(bob, c, { kind: 'passive', title: 'Deflect', type: 'reaction', description: 'Sniž damage' })).body.tactic
      expect(passive.data).toEqual({ type: 'reaction', description: 'Sniž damage', cost: 'free' })
      const combo = (await add(bob, c, { kind: 'combo', title: 'Burst', steps: ['Hex', 'Attack 2x', 'Flurry'], expectedDamage: '~53', cost: 'ki:1', highlight: true })).body.tactic
      expect(combo.data).toMatchObject({ steps: ['Hex', 'Attack 2x', 'Flurry'], highlight: true, cost: 'ki:1' })
      const rule = (await add(bob, c, { kind: 'rule', title: 'Sloty', text: '1 slot = 1 kouzlo' })).body.tactic
      expect(rule.data).toEqual({ text: '1 slot = 1 kouzlo' })
      expect((await list(bob, c)).map((t) => t.kind).sort()).toEqual(['attack', 'combo', 'ki', 'passive', 'rule', 'spell'])
    })

    it('neplatná data se odmítnou', async () => {
      const bad: [string, Record<string, unknown>][] = [
        ['neznámý druh', { kind: 'magic', title: 'x' }],
        ['bez druhu', { title: 'x' }],
        ['prázdný název', { kind: 'rule', title: '', text: 'x' }],
        ['dlouhý název', { kind: 'rule', title: 'x'.repeat(121), text: 'x' }],
        ['rule bez textu', { kind: 'rule', title: 'x' }],
        ['špatná cena', { kind: 'ki', title: 'x', cost: 'mana:3' }],
        ['nulová cena', { kind: 'ki', title: 'x', cost: 'ki:0' }],
        ['cena slot:10', { kind: 'ki', title: 'x', cost: 'slot:10' }],
        ['cena číslem', { kind: 'ki', title: 'x', cost: 1 }],
        ['typ akce', { kind: 'ki', title: 'x', actionType: 'swim' }],
        ['úroveň kouzla', { kind: 'spell', title: 'x', level: 10 }],
        ['úroveň textem', { kind: 'spell', title: 'x', level: '1' }],
        ['typ pasivky', { kind: 'passive', title: 'x', type: 'active' }],
        ['příznak', { kind: 'combo', title: 'x', highlight: 'ano' }],
        ['kroky nejsou pole', { kind: 'combo', title: 'x', steps: 'a' }],
        ['prázdný krok', { kind: 'combo', title: 'x', steps: ['a', ' '] }],
        ['moc kroků', { kind: 'combo', title: 'x', steps: Array(13).fill('a') }],
        ['dlouhý popis', { kind: 'ki', title: 'x', description: 'x'.repeat(2001) }],
        ['dlouhý útok', { kind: 'attack', title: 'x', toHit: 'x'.repeat(41) }],
      ]
      for (const [label, body] of bad) expect((await add(bob, bobChar, body)).status, label).toBe(422)
    })

    it('text se vrací beze změny (žádné HTML)', async () => {
      const res = await add(bob, bobChar, { kind: 'rule', title: '<b>x</b>', text: '<img src=x onerror=alert(1)>' })
      expect(res.body.tactic).toMatchObject({ title: '<b>x</b>', data: { text: '<img src=x onerror=alert(1)>' } })
    })
  })

  describe('úprava, mazání a pořadí', () => {
    it('PATCH změní jen poslané pole, druh se měnit nedá', async () => {
      const c = (await bob.client.post(`/campaigns/${campaignId}/characters`, { ...base, name: 'Úpravy' })).body.character.id
      const t = (await add(bob, c, { kind: 'ki', title: 'Flurry', cost: 'ki:1', actionType: 'bonus', description: 'Dva údery' })).body.tactic
      const res = await bob.client.patch(`/tactics/${t.id}`, { description: 'Nový popis', kind: 'rule' })
      expectStatus(res, 200)
      expect(res.body.tactic).toMatchObject({ kind: 'ki', title: 'Flurry', data: { cost: 'ki:1', actionType: 'bonus', description: 'Nový popis' } })
      expectStatus(await bob.client.patch(`/tactics/${t.id}`, { cost: 'ki:99999' }), 422)
      expectStatus(await bob.client.patch(`/tactics/${t.id}`, { title: '' }), 422)
      expect((await list(bob, c))[0].data.description).toBe('Nový popis')
      expectStatus(await bob.client.delete(`/tactics/${t.id}`), 204)
      expectStatus(await bob.client.delete(`/tactics/${t.id}`), 404)
      expectStatus(await bob.client.patch('/tactics/neni-uuid', { title: 'x' }), 404)
    })

    it('nové položky se řadí na konec svého druhu a reorder změní pořadí', async () => {
      const c = (await bob.client.post(`/campaigns/${campaignId}/characters`, { ...base, name: 'Pořadí' })).body.character.id
      const ids: string[] = []
      for (const title of ['A', 'B', 'C']) ids.push((await add(bob, c, { kind: 'rule', title, text: title })).body.tactic.id)
      await add(bob, c, { kind: 'ki', title: 'Jiný druh', cost: 'ki:1' })
      expect((await list(bob, c)).filter((t) => t.kind === 'rule').map((t) => t.title)).toEqual(['A', 'B', 'C'])
      const res = await bob.client.post(`/characters/${c}/tactics/reorder`, { kind: 'rule', ids: [ids[2], ids[0], ids[1]] })
      expectStatus(res, 200)
      expect(res.body.tactics.filter((t: any) => t.kind === 'rule').map((t: any) => t.title)).toEqual(['C', 'A', 'B'])
      expect((await list(bob, c)).filter((t) => t.kind === 'rule').map((t) => t.position)).toEqual([0, 1, 2])
      // nová položka jde za poslední
      await add(bob, c, { kind: 'rule', title: 'D', text: 'D' })
      expect((await list(bob, c)).filter((t) => t.kind === 'rule').map((t) => t.title)).toEqual(['C', 'A', 'B', 'D'])
    })

    it('reorder odmítne neúplný, duplicitní, cizí a špatný vstup; cizí postava ne', async () => {
      const c = (await bob.client.post(`/campaigns/${campaignId}/characters`, { ...base, name: 'Pořadí2' })).body.character.id
      const a = (await add(bob, c, { kind: 'rule', title: 'A', text: 'A' })).body.tactic.id
      const b = (await add(bob, c, { kind: 'rule', title: 'B', text: 'B' })).body.tactic.id
      const other = (await add(bob, bobChar, { kind: 'rule', title: 'Cizí', text: 'x' })).body.tactic.id
      const post = (body: unknown) => bob.client.post(`/characters/${c}/tactics/reorder`, body)
      expectStatus(await post({ kind: 'rule', ids: [a] }), 422)
      expectStatus(await post({ kind: 'rule', ids: [a, a] }), 422)
      expectStatus(await post({ kind: 'rule', ids: [a, other] }), 422)
      expectStatus(await post({ kind: 'rule', ids: [a, b, other] }), 422)
      expectStatus(await post({ kind: 'magic', ids: [a, b] }), 422)
      expectStatus(await post({ kind: 'rule', ids: 'a' }), 422)
      expectStatus(await post({ kind: 'rule' }), 422)
      expectStatus(await carol.client.post(`/characters/${c}/tactics/reorder`, { kind: 'rule', ids: [b, a] }), 403)
      expectStatus(await eve.client.post(`/characters/${c}/tactics/reorder`, { kind: 'rule', ids: [b, a] }), 404)
      expect((await list(bob, c)).map((t) => t.title)).toEqual(['A', 'B'])
    })

    it('limit počtu položek na postavu', async () => {
      const c = (await bob.client.post(`/campaigns/${campaignId}/characters`, { ...base, name: 'Limit' })).body.character.id
      // rychlé naplnění přes DB není k dispozici, proto jen ověříme, že limit je 200 a 201. položka se odmítne
      for (let i = 0; i < 200; i++) {
        const res = await add(bob, c, { kind: 'rule', title: `P${i}`, text: 'x' })
        if (res.status !== 201) throw new Error(`položka ${i}: ${res.status} ${JSON.stringify(res.body)}`)
      }
      expectStatus(await add(bob, c, { kind: 'rule', title: 'navíc', text: 'x' }), 422)
    }, 120_000)
  })
})
