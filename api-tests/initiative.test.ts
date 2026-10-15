import { beforeAll, describe, expect, it } from 'vitest'
import { createCampaign, expectStatus, joinAsPlayer, registerUser, type TestUser } from './client'

const body = (name: string, extra: Record<string, unknown> = {}) => ({
  name,
  abilityScores: { str: 10, dex: 14, con: 10, int: 10, wis: 10, cha: 10 },
  levels: [{ classIndex: 'fighter', hpRoll: null }],
  ...extra,
})

describe('iniciativa (jen DM) a nepřátelé s iniciativou', () => {
  let dm: TestUser
  let bob: TestUser
  let eve: TestUser
  let campaignId: string
  let bobChar: string
  let npcId: string
  let goblin: string

  const view = async () => (await dm.client.get(`/campaigns/${campaignId}/initiative`)).body as { round: number; active: { kind: string; id: string } | null; entries: { kind: string; id: string; value: number | null }[] }
  const keys = async () => (await view()).entries.map((e) => `${e.kind}:${e.id}`)
  const set = (kind: string, id: string, value?: number) => dm.client.post(`/campaigns/${campaignId}/initiative`, { kind, id, ...(value === undefined ? {} : { value }) })

  beforeAll(async () => {
    dm = await registerUser('indm')
    campaignId = await createCampaign(dm, 'Iniciativa')
    bob = await joinAsPlayer(dm, campaignId, 'bob')
    eve = await registerUser('eve')
    bobChar = (await bob.client.post(`/campaigns/${campaignId}/characters`, body('Bob'))).body.character.id
    npcId = (await dm.client.post(`/campaigns/${campaignId}/characters`, body('Batan', { kind: 'npc' }))).body.character.id
    goblin = (await dm.client.post(`/campaigns/${campaignId}/enemies`, { name: 'Goblin', hpMax: 7, initiative: 2 })).body.enemy.id
  })

  it('jen DM: hráč 403, cizinec 404, anonym 401', async () => {
    for (const [method, url, payload] of [
      ['GET', `/campaigns/${campaignId}/initiative`, undefined],
      ['POST', `/campaigns/${campaignId}/initiative`, { kind: 'character', id: bobChar, value: 10 }],
      ['POST', `/campaigns/${campaignId}/initiative/order`, { keys: [] }],
      ['POST', `/campaigns/${campaignId}/initiative/next`, {}],
      ['DELETE', `/campaigns/${campaignId}/initiative/character/${bobChar}`, undefined],
      ['DELETE', `/campaigns/${campaignId}/initiative`, undefined],
      ['POST', `/campaigns/${campaignId}/enemies/initiative`, {}],
      ['POST', `/enemies/${goblin}/initiative`, {}],
    ] as const) {
      expect((await bob.client.request(method, url, payload)).status, `${method} ${url}`).toBe(403)
      expect((await eve.client.request(method, url, payload)).status, `${method} ${url}`).toBe(404)
    }
  })

  it('hod postavy s příznakem initiative se zapíše do pořadí, hráč pořadí nevidí', async () => {
    const roll = await bob.client.post(`/campaigns/${campaignId}/rolls`, { expression: '1d20+2', label: 'Iniciativa', characterId: bobChar, initiative: true })
    expectStatus(roll, 201)
    const v = await view()
    expect(v.entries).toEqual([{ kind: 'character', id: bobChar, value: roll.body.roll.total }])
    expect((await bob.client.get(`/campaigns/${campaignId}/initiative`)).status).toBe(403)
    // bez characterId nebo s cizí postavou to nejde
    expectStatus(await bob.client.post(`/campaigns/${campaignId}/rolls`, { expression: '1d20', initiative: true }), 422)
    expectStatus(await bob.client.post(`/campaigns/${campaignId}/rolls`, { expression: '1d20', characterId: npcId, initiative: true }), 403)
    expectStatus(await bob.client.post(`/campaigns/${campaignId}/rolls`, { expression: '1d20', characterId: bobChar, initiative: 'ano' }), 422)
    // hod bez příznaku iniciativu nemění
    const before = JSON.stringify(await view())
    await bob.client.post(`/campaigns/${campaignId}/rolls`, { expression: '1d20', characterId: bobChar })
    expect(JSON.stringify(await view())).toBe(before)
  })

  it('hodnota zařadí postavu podle výše a nezmění ruční pořadí ostatních', async () => {
    await dm.client.delete(`/campaigns/${campaignId}/initiative`)
    await set('character', bobChar, 10)
    await set('character', npcId, 15)
    await set('enemy', goblin, 12)
    expect(await keys()).toEqual([`character:${npcId}`, `enemy:${goblin}`, `character:${bobChar}`])
    // shoda se starším záznamem: nový je až za ním
    await set('enemy', goblin, 10)
    expect(await keys()).toEqual([`character:${npcId}`, `character:${bobChar}`, `enemy:${goblin}`])
    // ruční přetažení zůstane, i když se pak změní jiný záznam
    expectStatus(await dm.client.post(`/campaigns/${campaignId}/initiative/order`, { keys: [`enemy:${goblin}`, `character:${npcId}`, `character:${bobChar}`] }), 200)
    expect(await keys()).toEqual([`enemy:${goblin}`, `character:${npcId}`, `character:${bobChar}`])
    await set('character', bobChar, 3)
    expect(await keys()).toEqual([`enemy:${goblin}`, `character:${npcId}`, `character:${bobChar}`])
  })

  it('přidání bez hodnoty jde na konec, hromadně přidá víc záznamů', async () => {
    await dm.client.delete(`/campaigns/${campaignId}/initiative`)
    const res = await dm.client.post(`/campaigns/${campaignId}/initiative`, { subjects: [{ kind: 'character', id: bobChar }, { kind: 'enemy', id: goblin }, { kind: 'character', id: npcId }] })
    expectStatus(res, 200)
    expect(res.body.entries.map((e: any) => [e.kind, e.value])).toEqual([['character', null], ['enemy', null], ['character', null]])
    await set('character', npcId, 8)
    expect((await view()).entries[0]).toMatchObject({ id: npcId, value: 8 })
  })

  it('validace: neznámý druh, cizí záznam, hodnota mimo meze, špatné pořadí', async () => {
    expectStatus(await set('monster', goblin, 5), 422)
    expectStatus(await set('character', '00000000-0000-4000-8000-000000000000', 5), 422)
    expectStatus(await set('character', bobChar, 99), 422)
    expectStatus(await set('character', bobChar, 1.5 as number), 422)
    expectStatus(await dm.client.post(`/campaigns/${campaignId}/initiative/order`, { keys: [`character:${bobChar}`] }), 422)
    expectStatus(await dm.client.post(`/campaigns/${campaignId}/initiative/order`, { keys: 'x' }), 422)
    // záznam z jiné kampaně nejde přidat
    const other = await createCampaign(dm, 'Jiná')
    const foreign = (await dm.client.post(`/campaigns/${other}/enemies`, { name: 'Cizí', hpMax: 3 })).body.enemy.id
    expectStatus(await set('enemy', foreign, 5), 422)
  })

  it('nepřítel hodí iniciativu (k20 + bonus), je skrytý a zapíše se; hromadně jen ti, kdo stojí', async () => {
    await dm.client.delete(`/campaigns/${campaignId}/initiative`)
    const one = await dm.client.post(`/enemies/${goblin}/initiative`, {})
    expectStatus(one, 200)
    expect(one.body.result.total).toBeGreaterThanOrEqual(3)
    expect(one.body.result.total).toBeLessThanOrEqual(22)
    expect((await view()).entries).toEqual([{ kind: 'enemy', id: goblin, value: one.body.result.total }])
    const log = (await dm.client.get(`/campaigns/${campaignId}/rolls`)).body.rolls as any[]
    expect(log.find((r) => r.label === 'Goblin: iniciativa')).toMatchObject({ hidden: true })
    expect(((await bob.client.get(`/campaigns/${campaignId}/rolls`)).body.rolls as any[]).some((r) => r.label === 'Goblin: iniciativa')).toBe(false)

    const dead = (await dm.client.post(`/campaigns/${campaignId}/enemies`, { name: 'Mrtvola', hpMax: 3, hpCurrent: 0 })).body.enemy.id
    const all = await dm.client.post(`/campaigns/${campaignId}/enemies/initiative`, {})
    expectStatus(all, 200)
    expect(all.body.results.map((r: any) => r.id)).not.toContain(dead)
    expect(all.body.results.map((r: any) => r.id)).toContain(goblin)
  })

  it('další tah: postupuje pořadím, přeskočí padlé nepřátele a po posledním začne nové kolo', async () => {
    await dm.client.delete(`/campaigns/${campaignId}/initiative`)
    const fallen = (await dm.client.post(`/campaigns/${campaignId}/enemies`, { name: 'Padlý', hpMax: 5 })).body.enemy.id
    await set('character', npcId, 18)
    await set('enemy', fallen, 15)
    await set('character', bobChar, 12)
    await dm.client.post(`/enemies/${fallen}/hp`, { delta: -5 })
    const step = async () => (await dm.client.post(`/campaigns/${campaignId}/initiative/next`, {})).body as { round: number; active: { id: string } }
    let s = await step()
    expect([s.round, s.active.id]).toEqual([1, npcId])
    s = await step()
    expect([s.round, s.active.id]).toEqual([1, bobChar]) // padlý se přeskočí
    s = await step()
    expect([s.round, s.active.id]).toEqual([2, npcId]) // nové kolo
    expect((await view()).active).toEqual({ kind: 'character', id: npcId })
  })

  it('odebrání záznamu, úklid po smazané postavě a nepříteli, konec souboje', async () => {
    await dm.client.delete(`/campaigns/${campaignId}/initiative`)
    const temp = (await dm.client.post(`/campaigns/${campaignId}/characters`, body('Dočasná', { kind: 'npc' }))).body.character.id
    const mook = (await dm.client.post(`/campaigns/${campaignId}/enemies`, { name: 'Mook', hpMax: 2 })).body.enemy.id
    await set('character', temp, 9)
    await set('enemy', mook, 8)
    await set('character', bobChar, 7)
    expectStatus(await dm.client.delete(`/campaigns/${campaignId}/initiative/character/${bobChar}`), 200)
    expect(await keys()).toEqual([`character:${temp}`, `enemy:${mook}`])
    expectStatus(await dm.client.delete(`/characters/${temp}`), 204)
    expect(await keys()).toEqual([`enemy:${mook}`])
    expectStatus(await dm.client.delete(`/enemies/${mook}`), 204)
    expect(await keys()).toEqual([])
    await set('character', bobChar, 5)
    await dm.client.post(`/campaigns/${campaignId}/initiative/next`, {})
    const cleared = await dm.client.delete(`/campaigns/${campaignId}/initiative`)
    expect(cleared.body).toEqual({ round: 1, active: null, entries: [] })
    expect(await view()).toEqual({ round: 1, active: null, entries: [] })
    expectStatus(await dm.client.delete(`/campaigns/${campaignId}/initiative/character/neni-uuid`), 422)
  })

  it('bonus iniciativy nepřítele: validace a kopie', async () => {
    expectStatus(await dm.client.post(`/campaigns/${campaignId}/enemies`, { name: 'Moc', hpMax: 3, initiative: 99 }), 422)
    const created = (await dm.client.post(`/campaigns/${campaignId}/enemies`, { name: 'Rychlý', hpMax: 3, initiative: 4 })).body.enemy
    expect(created.initiative).toBe(4)
    expect((await dm.client.post(`/enemies/${created.id}/duplicate`, {})).body.enemy).toMatchObject({ name: 'Rychlý 2', initiative: 4 })
    expect((await dm.client.patch(`/enemies/${created.id}`, { initiative: -1 })).body.enemy.initiative).toBe(-1)
  })
})
