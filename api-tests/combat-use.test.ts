import { beforeAll, describe, expect, it } from 'vitest'
import { createCampaign, expectStatus, joinAsPlayer, registerUser, type TestUser } from './client'

const body = (name: string, extra: Record<string, unknown> = {}) => ({
  name,
  abilityScores: { str: 10, dex: 14, con: 10, int: 10, wis: 10, cha: 10 },
  levels: [{ classIndex: 'fighter', hpRoll: null }],
  ...extra,
})

describe('použití taktik: počet útoků, munice, kombo, spotřebitelné itemy, série hodů, death saves', () => {
  let dm: TestUser
  let bob: TestUser
  let carol: TestUser
  let campaignId: string
  let bobChar: string
  let carolChar: string

  beforeAll(async () => {
    dm = await registerUser('cudm')
    campaignId = await createCampaign(dm, 'Použití')
    bob = await joinAsPlayer(dm, campaignId, 'bob')
    carol = await joinAsPlayer(dm, campaignId, 'carol')
    bobChar = (await bob.client.post(`/campaigns/${campaignId}/characters`, body('Bob'))).body.character.id
    carolChar = (await carol.client.post(`/campaigns/${campaignId}/characters`, body('Carol'))).body.character.id
  })

  const addItem = async (user: TestUser, char: string, input: Record<string, unknown>) => (await user.client.post(`/characters/${char}/items`, input)).body.item
  const tactic = (user: TestUser, char: string, input: Record<string, unknown>) => user.client.post(`/characters/${char}/tactics`, input)

  describe('spotřebovatelné itemy', () => {
    it('příznak consumable jde nastavit, množství může klesnout na 0 a vrátit se', async () => {
      const bolts = await addItem(bob, bobChar, { name: 'Šípy', kind: 'other', quantity: 20, consumable: true })
      expect(bolts).toMatchObject({ quantity: 20, consumable: true })
      const zero = await bob.client.patch(`/characters/${bobChar}/items/${bolts.id}`, { quantity: 0 })
      expectStatus(zero, 200)
      expect(zero.body.item.quantity).toBe(0)
      expect((await bob.client.patch(`/characters/${bobChar}/items/${bolts.id}`, { quantity: -1 })).status).toBe(422)
      expect((await bob.client.patch(`/characters/${bobChar}/items/${bolts.id}`, { quantity: 5, consumable: false })).body.item).toMatchObject({ quantity: 5, consumable: false })
    })

    it('munice z pravidel (Crossbow bolt) je spotřebovatelná sama, běžné vybavení ne', async () => {
      const rule = async (q: string) => (await bob.client.get(`/rules?kinds=equipment&q=${encodeURIComponent(q)}`)).body.entries.find((e: any) => e.name === q)
      const bolt = await addItem(bob, bobChar, { ruleId: (await rule('Crossbow bolt')).id })
      expect(bolt.consumable).toBe(true)
      const backpack = await addItem(bob, bobChar, { ruleId: (await rule('Backpack')).id })
      expect(backpack.consumable).toBe(false)
    })

    it('operace item v adjust ubírá a přidává kusy, drží meze a cizí item nejde', async () => {
      const arrows = await addItem(bob, bobChar, { name: 'Šipky', kind: 'other', quantity: 3, consumable: true })
      const q = async () => (await bob.client.get(`/characters/${bobChar}`)).body.character.items.find((i: any) => i.id === arrows.id).quantity
      expectStatus(await bob.client.post(`/characters/${bobChar}/adjust`, { ops: [{ op: 'item', itemId: arrows.id, delta: -2 }] }), 200)
      expect(await q()).toBe(1)
      await bob.client.post(`/characters/${bobChar}/adjust`, { ops: [{ op: 'item', itemId: arrows.id, delta: -5 }] })
      expect(await q()).toBe(0)
      await bob.client.post(`/characters/${bobChar}/adjust`, { ops: [{ op: 'item', itemId: arrows.id, delta: 4 }] })
      expect(await q()).toBe(4)
      const foreign = await addItem(carol, carolChar, { name: 'Cizí', kind: 'other', quantity: 5 })
      expectStatus(await bob.client.post(`/characters/${bobChar}/adjust`, { ops: [{ op: 'item', itemId: foreign.id, delta: -1 }] }), 404)
      expectStatus(await bob.client.post(`/characters/${bobChar}/adjust`, { ops: [{ op: 'item', itemId: 'neni-uuid', delta: -1 }] }), 404)
      expectStatus(await bob.client.post(`/characters/${bobChar}/adjust`, { ops: [{ op: 'item', itemId: arrows.id, delta: 1.5 }] }), 422)
      expectStatus(await carol.client.post(`/characters/${bobChar}/adjust`, { ops: [{ op: 'item', itemId: arrows.id, delta: -1 }] }), 403)
      expect((await carol.client.get(`/characters/${carolChar}`)).body.character.items.find((i: any) => i.id === foreign.id).quantity).toBe(5)
    })
  })

  describe('taktiky: počet útoků, munice a kombo', () => {
    it('count je 1 až 10 a výchozí 1', async () => {
      const ok = await tactic(bob, bobChar, { kind: 'attack', title: 'Kopí', toHit: 'd20+8', roll: '1d8+5' })
      expectStatus(ok, 201)
      expect(ok.body.tactic.data).toMatchObject({ count: 1, ammo: '' })
      expect((await tactic(bob, bobChar, { kind: 'attack', title: 'Moc', count: 0 })).status).toBe(422)
      expect((await tactic(bob, bobChar, { kind: 'attack', title: 'Moc', count: 11 })).status).toBe(422)
      expect((await tactic(bob, bobChar, { kind: 'ki', title: 'Flurry', toHit: 'd20+7', roll: '1d6+4', count: 2, hex: true, cost: 'ki:1' })).body.tactic.data).toMatchObject({ count: 2, hex: true, toHit: 'd20+7' })
      expect((await tactic(bob, bobChar, { kind: 'spell', title: 'Blast', toHit: 'd20+6', roll: '1d10', count: 2 })).body.tactic.data).toMatchObject({ count: 2, toHit: 'd20+6' })
    })

    it('munice musí být item téže postavy', async () => {
      const mine = await addItem(bob, bobChar, { name: 'Bolty', kind: 'other', quantity: 9, consumable: true })
      const theirs = await addItem(carol, carolChar, { name: 'Cizí bolty', kind: 'other', quantity: 9 })
      const ok = await tactic(bob, bobChar, { kind: 'attack', title: 'Kuše', ammo: mine.id })
      expectStatus(ok, 201)
      expect(ok.body.tactic.data.ammo).toBe(mine.id)
      expect((await tactic(bob, bobChar, { kind: 'attack', title: 'Cizí', ammo: theirs.id })).status).toBe(422)
      expect((await tactic(bob, bobChar, { kind: 'attack', title: 'Nesmysl', ammo: 'neni-uuid' })).status).toBe(422)
      expect((await bob.client.patch(`/tactics/${ok.body.tactic.id}`, { ammo: theirs.id })).status).toBe(422)
      // úprava jiného pole munici nezmění
      expect((await bob.client.patch(`/tactics/${ok.body.tactic.id}`, { count: 2 })).body.tactic.data).toMatchObject({ ammo: mine.id, count: 2 })
    })

    it('kombo smí používat jen útoky, kouzla a ki schopnosti téže postavy', async () => {
      const spear = (await tactic(bob, bobChar, { kind: 'attack', title: 'Kopí 2', count: 2 })).body.tactic
      const rule = (await tactic(bob, bobChar, { kind: 'rule', title: 'Poučka', text: 'x' })).body.tactic
      const foreign = (await tactic(carol, carolChar, { kind: 'attack', title: 'Cizí kopí' })).body.tactic
      const combo = await tactic(bob, bobChar, { kind: 'combo', title: 'Burst', uses: [{ id: spear.id, count: 2 }] })
      expectStatus(combo, 201)
      expect(combo.body.tactic.data.uses).toEqual([{ id: spear.id, count: 2 }])
      expect((await tactic(bob, bobChar, { kind: 'combo', title: 'Pravidlo', uses: [{ id: rule.id, count: 1 }] })).status).toBe(422)
      expect((await tactic(bob, bobChar, { kind: 'combo', title: 'Cizí', uses: [{ id: foreign.id, count: 1 }] })).status).toBe(422)
      expect((await tactic(bob, bobChar, { kind: 'combo', title: 'Počet', uses: [{ id: spear.id, count: 0 }] })).status).toBe(422)
      expect((await tactic(bob, bobChar, { kind: 'combo', title: 'Tvar', uses: [{ count: 1 }] })).status).toBe(422)
      expect((await bob.client.patch(`/tactics/${combo.body.tactic.id}`, { uses: [{ id: foreign.id, count: 1 }] })).status).toBe(422)
    })
  })

  describe('série hodů (batch)', () => {
    const batch = (user: TestUser, payload: Record<string, unknown>) => user.client.post(`/campaigns/${campaignId}/rolls/batch`, payload)

    it('každý útok má hod na zásah a zranění, všechno je v logu', async () => {
      const res = await batch(bob, { characterId: bobChar, attacks: [{ label: 'Kopí #1', toHit: '1d20+8', damage: '1d8+5+1d4' }, { label: 'Kopí #2', toHit: '1d20+8', damage: '1d8+5+1d4' }, { label: 'Blast', damage: '3d6' }] })
      expectStatus(res, 201)
      expect(res.body.results).toHaveLength(3)
      const [first, , third] = res.body.results
      expect(first.hit.expression).toBe('1d20+8')
      expect(first.hit.total).toBeGreaterThanOrEqual(9)
      expect(first.damage.expression).toBe('1d8+5+1d4')
      expect(first.damage.crit).toBe(first.crit)
      expect(first.crit).toBe(first.hit.natural === 20)
      expect(third.hit).toBeNull()
      expect(third.damage.total).toBeGreaterThanOrEqual(3)
      const log = (await dm.client.get(`/campaigns/${campaignId}/rolls`)).body.rolls as any[]
      expect(log.filter((r) => r.label.startsWith('Kopí #')).length).toBe(4)
    })

    it('skryté série vidí jen ten, kdo hodil, a DM', async () => {
      const res = await batch(bob, { hidden: true, attacks: [{ label: 'Tajný útok', toHit: '1d20', damage: '1d6' }] })
      expectStatus(res, 201)
      expect(res.body.results[0].hit.hidden).toBe(true)
      const labels = async (u: TestUser) => ((await u.client.get(`/campaigns/${campaignId}/rolls`)).body.rolls as any[]).map((r) => r.label)
      expect((await labels(bob)).some((l) => l.startsWith('Tajný útok'))).toBe(true)
      expect((await labels(dm)).some((l) => l.startsWith('Tajný útok'))).toBe(true)
      expect((await labels(carol)).some((l) => l.startsWith('Tajný útok'))).toBe(false)
    })

    it('validace: prázdná série, chybný výraz, příliš mnoho útoků, cizí postava, režim', async () => {
      expectStatus(await batch(bob, { attacks: [] }), 422)
      expectStatus(await batch(bob, {}), 422)
      expectStatus(await batch(bob, { attacks: [{ label: 'x', toHit: 'hodně' }] }), 422)
      expectStatus(await batch(bob, { attacks: [{ label: 'x' }] }), 422)
      expectStatus(await batch(bob, { attacks: Array.from({ length: 25 }, () => ({ label: 'x', toHit: '1d20' })) }), 422)
      expectStatus(await batch(bob, { characterId: carolChar, attacks: [{ label: 'x', toHit: '1d20' }] }), 403)
      expectStatus(await batch(bob, { mode: 'dvojite', attacks: [{ label: 'x', toHit: '1d20' }] }), 422)
      // při chybě v druhém útoku se nezapíše ani první
      const before = ((await dm.client.get(`/campaigns/${campaignId}/rolls`)).body.rolls as any[]).length
      expectStatus(await batch(bob, { attacks: [{ label: 'Půlka', toHit: '1d20' }, { label: 'Vadný', toHit: 'nic' }] }), 422)
      expect(((await dm.client.get(`/campaigns/${campaignId}/rolls`)).body.rolls as any[]).length).toBe(before)
    })

    it('cizinec nic nehodí a anonym je odmítnut', async () => {
      const eve = await registerUser('eve')
      expectStatus(await batch(eve, { attacks: [{ label: 'x', toHit: '1d20' }] }), 404)
    })
  })

  describe('death saves vidí jen majitel a DM', () => {
    it('hráč s plným náhledem cizí postavy death saves nevidí, majitel i DM ano', async () => {
      expectStatus(await dm.client.patch(`/characters/${bobChar}`, { visibility: 'full' }), 200)
      expectStatus(await bob.client.post(`/characters/${bobChar}/adjust`, { ops: [{ op: 'hp', delta: -100, max: 12 }, { op: 'deathSave', kind: 'success', delta: 2 }, { op: 'deathSave', kind: 'failure', delta: 1 }] }), 200)
      const state = (u: TestUser, c: any) => c.state
      const own = (await bob.client.get(`/characters/${bobChar}`)).body.character
      expect(state(bob, own)).toMatchObject({ hpCurrent: 0, deathSuccesses: 2, deathFailures: 1 })
      expect((await dm.client.get(`/characters/${bobChar}`)).body.character.state).toMatchObject({ deathSuccesses: 2, deathFailures: 1 })
      // Carol vidí celý sheet (visibility full), ale ne death saves
      const seen = (await carol.client.get(`/characters/${bobChar}`)).body.character
      expect(seen.access).toBe('full')
      expect(seen.state).toMatchObject({ hpCurrent: 0, deathSuccesses: 0, deathFailures: 0 })
      const inList = (await carol.client.get(`/campaigns/${campaignId}/characters`)).body.characters.find((c: any) => c.id === bobChar)
      expect(inList.state).toMatchObject({ deathSuccesses: 0, deathFailures: 0 })
      const dmList = (await dm.client.get(`/campaigns/${campaignId}/characters`)).body.characters.find((c: any) => c.id === bobChar)
      expect(dmList.state).toMatchObject({ deathSuccesses: 2, deathFailures: 1 })
    })
  })
})
