import { beforeAll, describe, expect, it } from 'vitest'
import { createCampaign, expectStatus, joinAsPlayer, registerUser, type TestUser } from './client'

/** Počítadlo nat 1 u zbraní a Thieves' Tools: 0–20, rozbití a oprava, která ho vynuluje. */
const BASE = { abilityScores: { str: 10, dex: 14, con: 12, int: 10, wis: 10, cha: 10 }, levels: [{ classIndex: 'rogue' }] }

describe('rozbití zbraně (nat 1)', () => {
  let dm: TestUser
  let bob: TestUser
  let carol: TestUser
  let stranger: TestUser
  let campaignId: string
  let bobChar: string
  let carolChar: string
  let swordId: string
  let toolsId: string

  const adjust = (user: TestUser, id: string, ops: unknown[]) => user.client.post(`/characters/${id}/adjust`, { ops })
  const item = async (user: TestUser, charId: string, itemId: string) =>
    (await user.client.get(`/characters/${charId}`)).body.character.items.find((i: { id: string }) => i.id === itemId)

  beforeAll(async () => {
    dm = await registerUser('dm')
    campaignId = await createCampaign(dm, 'Rozbití')
    bob = await joinAsPlayer(dm, campaignId, 'bob')
    carol = await joinAsPlayer(dm, campaignId, 'carol')
    stranger = await registerUser('cizi')
    bobChar = (await bob.client.post(`/campaigns/${campaignId}/characters`, { ...BASE, name: 'Robinn' })).body.character.id
    carolChar = (await carol.client.post(`/campaigns/${campaignId}/characters`, { ...BASE, name: 'Carol' })).body.character.id
    swordId = (await bob.client.post(`/characters/${bobChar}/items`, { name: 'Shortsword', kind: 'weapon', quantity: 2 })).body.item.id
    toolsId = (await bob.client.post(`/characters/${bobChar}/items`, { name: "Thieves' Tools", kind: 'other' })).body.item.id
  })

  it('nová zbraň i náčiní začínají na 0 a nejsou rozbité', async () => {
    expect(await item(bob, bobChar, swordId)).toMatchObject({ nat1: 0, broken: false })
    expect(await item(bob, bobChar, toolsId)).toMatchObject({ nat1: 0, broken: false })
  })

  it('číslo se zvedá po jedné a drží se v 0 až 20, zbroj ho nemá', async () => {
    expectStatus(await adjust(bob, bobChar, [{ op: 'nat1', itemId: swordId, delta: 1 }]), 200)
    expect(await item(bob, bobChar, swordId)).toMatchObject({ nat1: 1, broken: false })
    expectStatus(await adjust(bob, bobChar, [{ op: 'nat1', itemId: toolsId, delta: 2 }]), 200)
    expect((await item(bob, bobChar, toolsId)).nat1).toBe(2)
    expectStatus(await adjust(bob, bobChar, [{ op: 'nat1', itemId: swordId, delta: 20 }]), 200)
    expect((await item(bob, bobChar, swordId)).nat1).toBe(20)
    expectStatus(await adjust(bob, bobChar, [{ op: 'nat1', itemId: swordId, delta: -20 }]), 200)
    expect((await item(bob, bobChar, swordId)).nat1).toBe(0)
    expectStatus(await adjust(bob, bobChar, [{ op: 'nat1', itemId: swordId, delta: 21 }]), 422)

    const rope = (await bob.client.post(`/characters/${bobChar}/items`, { name: 'Rope', kind: 'other' })).body.item.id
    const denied = await adjust(bob, bobChar, [{ op: 'nat1', itemId: rope, delta: 1 }])
    expectStatus(denied, 422)
    expect(denied.body.error.field).toBe('ops')
  })

  it('rozbití a oprava: oprava vynuluje počítadlo a zbraň zase drží', async () => {
    expectStatus(await adjust(bob, bobChar, [{ op: 'nat1', itemId: swordId, delta: 3 }, { op: 'break', itemId: swordId }]), 200)
    expect(await item(bob, bobChar, swordId)).toMatchObject({ nat1: 3, broken: true })
    const repaired = await adjust(dm, bobChar, [{ op: 'repair', itemId: swordId }])
    expectStatus(repaired, 200)
    expect(repaired.body.wear[swordId]).toEqual({ nat1: 0, broken: false })
    expect(await item(bob, bobChar, swordId)).toMatchObject({ nat1: 0, broken: false })
  })

  it('část stacku si počítadlo odnese s sebou', async () => {
    expectStatus(await adjust(bob, bobChar, [{ op: 'nat1', itemId: swordId, delta: 4 }, { op: 'break', itemId: swordId }]), 200)
    const moved = await bob.client.post(`/characters/${bobChar}/transfer`, { toCharacterId: carolChar, itemId: swordId, quantity: 1 })
    expectStatus(moved, 200)
    const received = (await carol.client.get(`/characters/${carolChar}`)).body.character.items.find((i: { name: string }) => i.name === 'Shortsword')
    expect(received).toMatchObject({ quantity: 1, nat1: 4, broken: true })
    expect(await item(bob, bobChar, swordId)).toMatchObject({ quantity: 1, nat1: 4, broken: true })
  })

  it('cizí postavu neupraví hráč (403) ani cizinec (404), neznámý item je 404', async () => {
    expectStatus(await adjust(carol, bobChar, [{ op: 'nat1', itemId: swordId, delta: 1 }]), 403)
    expectStatus(await adjust(stranger, bobChar, [{ op: 'break', itemId: swordId }]), 404)
    expectStatus(await adjust(bob, bobChar, [{ op: 'repair', itemId: '00000000-0000-4000-8000-000000000000' }]), 404)
  })
})
