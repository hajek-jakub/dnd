import { beforeAll, describe, expect, it } from 'vitest'
import { Client, createCampaign, expectStatus, joinAsPlayer, registerUser, type TestUser } from './client'

/**
 * Pozvánky existujících uživatelů jménem: zve jen DM, pozvaný ji sám přijme (stane se hráčem, nikdy DM) nebo odmítne.
 * Cizí pozvánka se tváří jako neexistující, návrhy jsou jen lidé ze sdílených kampaní (seznam účtů nejde vypsat).
 */
describe('pozvánky jménem', () => {
  let dm: TestUser
  let campaignId: string
  let player: TestUser

  beforeAll(async () => {
    dm = await registerUser('invdm')
    campaignId = await createCampaign(dm, 'Pozvánková kampaň')
    player = await joinAsPlayer(dm, campaignId)
  })

  it('anonym 401, cizinec 404, hráč 403', async () => {
    const target = await registerUser('cil')
    const anon = new Client()
    expect((await anon.post(`/campaigns/${campaignId}/invitations`, { username: target.username })).status).toBe(401)
    expect((await anon.get('/invitations')).status).toBe(401)
    const stranger = await registerUser('cizinec')
    for (const path of [`/campaigns/${campaignId}/invitations`, `/campaigns/${campaignId}/invite-suggestions`]) {
      expect((await stranger.client.get(path)).status, path).toBe(404)
      expect((await player.client.get(path)).status, path).toBe(403)
    }
    expect((await stranger.client.post(`/campaigns/${campaignId}/invitations`, { username: target.username })).status).toBe(404)
    expect((await player.client.post(`/campaigns/${campaignId}/invitations`, { username: target.username })).status).toBe(403)
    expect((await target.client.get('/invitations')).body.invitations).toEqual([])
  })

  it('DM pozve jménem, pozvaný vidí pozvánku i v /summary a přijetím se stane hráčem', async () => {
    const target = await registerUser('novak')
    const res = await dm.client.post(`/campaigns/${campaignId}/invitations`, { username: target.username.toUpperCase() })
    expectStatus(res, 201)
    expect(res.body.invitations.map((i: any) => i.userId)).toContain(target.id)
    // opakování nic nezdvojí
    const again = await dm.client.post(`/campaigns/${campaignId}/invitations`, { username: target.username })
    expectStatus(again, 200)
    expect(again.body.invitations.filter((i: any) => i.userId === target.id)).toHaveLength(1)

    const summary = await target.client.get('/summary')
    expect(summary.body.invitations).toHaveLength(1)
    const inv = summary.body.invitations[0]
    expect(inv).toMatchObject({ campaignId, campaignName: 'Pozvánková kampaň', dmName: dm.username, invitedBy: dm.username })
    expect(Object.keys(inv).sort()).toEqual(['campaignId', 'campaignName', 'createdAt', 'dmName', 'id', 'invitedBy'])
    expect(summary.body.notifications.notifications[0]).toMatchObject({ kind: 'invite', campaignId })
    // pozvaný ještě není člen
    expect((await target.client.get(`/campaigns/${campaignId}`)).status).toBe(404)

    // cizí pozvánku nikdo jiný nepřijme ani neodmítne
    expect((await player.client.post(`/invitations/${inv.id}/accept`)).status).toBe(404)
    expect((await dm.client.post(`/invitations/${inv.id}/decline`)).status).toBe(404)

    const accepted = await target.client.post(`/invitations/${inv.id}/accept`)
    expectStatus(accepted, 200)
    expect(accepted.body.campaignId).toBe(campaignId)
    const show = await target.client.get(`/campaigns/${campaignId}`)
    expect(show.body.campaign.role).toBe('player')
    expect((await target.client.get('/invitations')).body.invitations).toEqual([])
    expect((await target.client.post(`/invitations/${inv.id}/accept`)).status).toBe(404)
    // DM dostane oznámení, čekající pozvánka zmizela
    const dmSummary = await dm.client.get('/summary')
    expect(dmSummary.body.notifications.notifications.some((n: any) => n.kind === 'invite' && n.campaignId === campaignId)).toBe(true)
    expect((await dm.client.get(`/campaigns/${campaignId}/invitations`)).body.invitations.some((i: any) => i.userId === target.id)).toBe(false)
  })

  it('neznámé jméno 404, sám sebe a člena 422', async () => {
    expect((await dm.client.post(`/campaigns/${campaignId}/invitations`, { username: 'nikdo-takovy-neni' })).status).toBe(404)
    const self = await dm.client.post(`/campaigns/${campaignId}/invitations`, { username: dm.username })
    expect(self.status).toBe(422)
    const member = await dm.client.post(`/campaigns/${campaignId}/invitations`, { username: player.username })
    expect(member.status).toBe(422)
    expect(member.body.error.field).toBe('username')
    expect((await dm.client.post(`/campaigns/${campaignId}/invitations`, {})).status).toBe(422)
  })

  it('odmítnutí a zrušení pozvánky', async () => {
    const a = await registerUser('odmita')
    const b = await registerUser('zrusena')
    await dm.client.post(`/campaigns/${campaignId}/invitations`, { username: a.username })
    const list = await dm.client.post(`/campaigns/${campaignId}/invitations`, { username: b.username })
    const forB = list.body.invitations.find((i: any) => i.userId === b.id)

    const invA = (await a.client.get('/invitations')).body.invitations[0]
    expectStatus(await a.client.post(`/invitations/${invA.id}/decline`), 204)
    expect((await a.client.get(`/campaigns/${campaignId}`)).status).toBe(404)

    // hráč pozvánku zrušit nesmí, cizí kampaň ji nenajde
    expect((await player.client.delete(`/campaigns/${campaignId}/invitations/${forB.id}`)).status).toBe(403)
    const otherDm = await registerUser('jinydm')
    const other = await createCampaign(otherDm)
    expect((await otherDm.client.delete(`/campaigns/${other}/invitations/${forB.id}`)).status).toBe(404)
    expectStatus(await dm.client.delete(`/campaigns/${campaignId}/invitations/${forB.id}`), 204)
    expect((await b.client.get('/invitations')).body.invitations).toEqual([])
    expect((await b.client.post(`/invitations/${forB.id}/accept`)).status).toBe(404)
  })

  it('návrhy jsou jen lidé ze sdílených kampaní a jde je pozvat podle id', async () => {
    const newCampaign = await createCampaign(dm, 'Druhá kampaň')
    const outsider = await registerUser('mimo')
    const sug = await dm.client.get(`/campaigns/${newCampaign}/invite-suggestions`)
    expectStatus(sug, 200)
    const ids = sug.body.suggestions.map((s: any) => s.userId)
    expect(ids).toContain(player.id)
    expect(ids).not.toContain(outsider.id)
    expect(ids).not.toContain(dm.id)

    expectStatus(await dm.client.post(`/campaigns/${newCampaign}/invitations`, { userId: player.id }), 201)
    // podle id nejde pozvat někoho, s kým DM nehraje (jinak by šlo zkoušet id cizích účtů)
    expect((await dm.client.post(`/campaigns/${newCampaign}/invitations`, { userId: outsider.id })).status).toBe(404)
    const after = await dm.client.get(`/campaigns/${newCampaign}/invite-suggestions`)
    expect(after.body.suggestions.map((s: any) => s.userId)).not.toContain(player.id)

    // hráč z jiné kampaně ji přijme a je v nové kampani hráčem, ne DM
    const inv = (await player.client.get('/invitations')).body.invitations.find((i: any) => i.campaignId === newCampaign)
    expect(inv).toBeTruthy()
    expectStatus(await player.client.post(`/invitations/${inv.id}/accept`), 200)
    expect((await player.client.get('/campaigns')).body.campaigns.find((c: any) => c.id === newCampaign).role).toBe('player')
  })

  it('připojení kódem čekající pozvánku jménem uklidí', async () => {
    const target = await registerUser('kodem')
    await dm.client.post(`/campaigns/${campaignId}/invitations`, { username: target.username })
    const code = (await dm.client.post(`/campaigns/${campaignId}/invites`, {})).body.invite.code
    expectStatus(await target.client.post(`/invites/${code}/accept`), 200)
    expect((await target.client.get('/invitations')).body.invitations).toEqual([])
  })

  it('pozvání podléhá rate limitu', async () => {
    const limited = await registerUser('limitdm')
    const camp = await createCampaign(limited)
    let last = 0
    for (let i = 0; i < 21; i++) last = (await limited.client.post(`/campaigns/${camp}/invitations`, { username: `nikdo${i}x` })).status
    expect(last).toBe(429)
  })
})

describe('seznam kampaní pro výběr', () => {
  it('ukáže mou postavu, další session a počet členů, cizí postavy ne', async () => {
    const dm = await registerUser('vyberdm')
    const campaignId = await createCampaign(dm, 'Výběr')
    const player = await joinAsPlayer(dm, campaignId)
    const other = await joinAsPlayer(dm, campaignId)
    const stats = { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }
    const mine = await player.client.post(`/campaigns/${campaignId}/characters`, { name: 'Moje', abilityScores: stats, levels: [{ classIndex: 'rogue', hpRoll: null }] })
    expectStatus(mine, 201)
    expectStatus(await other.client.post(`/campaigns/${campaignId}/characters`, { name: 'Cizí', abilityScores: stats, levels: [{ classIndex: 'rogue', hpRoll: null }] }), 201)
    const date = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10)
    expectStatus(await dm.client.post(`/campaigns/${campaignId}/sessions`, { date, time: '18:00' }), 201)

    const list = await player.client.get('/campaigns')
    const c = list.body.campaigns.find((x: any) => x.id === campaignId)
    expect(c).toMatchObject({ role: 'player', memberCount: 3, myCharacter: { id: mine.body.character.id, name: 'Moje', photoVersion: null }, nextSession: { date, time: '18:00' } })
    const dmView = (await dm.client.get('/campaigns')).body.campaigns.find((x: any) => x.id === campaignId)
    expect(dmView.myCharacter).toBeNull()
  })

  it('pravidla jde zvolit už při založení', async () => {
    const dm = await registerUser('pravdm')
    const res = await dm.client.post('/campaigns', { name: 'Nová pravidla', settings: { ruleset: '2024' } })
    expectStatus(res, 201)
    expect(res.body.campaign.settings).toEqual({ ruleset: '2024' })
    expect((await dm.client.post('/campaigns', { name: 'Špatně', settings: { ruleset: '3000' } })).status).toBe(422)
    expect((await dm.client.post('/campaigns', { name: 'Špatně', settings: { role: 'dm' } })).status).toBe(422)
  })
})
