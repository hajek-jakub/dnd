import { describe, expect, it } from 'vitest'
import { Client, createCampaign, createInvite, expectStatus, joinAsPlayer, registerUser } from './client'

describe('kampaně, členství a role', () => {
  it('zakladatel je DM a vidí kampaň i členy', async () => {
    const dm = await registerUser('dm')
    const id = await createCampaign(dm, 'Ztracený důl')
    const show = await dm.client.get(`/campaigns/${id}`)
    expect(show.body.campaign).toMatchObject({ name: 'Ztracený důl', role: 'dm' })
    const members = await dm.client.get(`/campaigns/${id}/members`)
    expect(members.body.members).toHaveLength(1)
    expect(members.body.members[0]).toMatchObject({ userId: dm.id, role: 'dm' })
  })

  it('role je per kampaň: DM v jedné kampani je hráčem v jiné', async () => {
    const alice = await registerUser('alice')
    const bob = await registerUser('bob')
    const campA = await createCampaign(alice, 'A')
    const campB = await createCampaign(bob, 'B')
    const { code } = await createInvite(bob, campB)
    expectStatus(await alice.client.post(`/invites/${code}/accept`), 200)

    const list = await alice.client.get('/campaigns')
    const roles = Object.fromEntries(list.body.campaigns.map((c: { id: string; role: string }) => [c.id, c.role]))
    expect(roles).toEqual({ [campA]: 'dm', [campB]: 'player' })
  })

  it('cizinec nevidí kampaň ani nic z ní (404, ne 403)', async () => {
    const dm = await registerUser('dm')
    const id = await createCampaign(dm)
    const stranger = await registerUser('cizinec')
    expect((await stranger.client.get('/campaigns')).body.campaigns).toEqual([])
    for (const path of [`/campaigns/${id}`, `/campaigns/${id}/members`, `/campaigns/${id}/invites`, `/campaigns/${id}/characters`, `/campaigns/${id}/dm-notes`]) {
      expect((await stranger.client.get(path)).status, path).toBe(404)
    }
    expect((await stranger.client.post(`/campaigns/${id}/invites`, {})).status).toBe(404)
    expect((await stranger.client.patch(`/campaigns/${id}`, { name: 'Hack' })).status).toBe(404)
    expect((await stranger.client.delete(`/campaigns/${id}`)).status).toBe(404)
    expect((await stranger.client.delete(`/campaigns/${id}/members/${dm.id}`)).status).toBe(404)
    // kampaň tím nesmí být dotčená
    expect((await dm.client.get(`/campaigns/${id}`)).body.campaign.name).toBe('Testovací kampaň')
  })

  it('neplatné id v URL neprozradí nic a nespadne', async () => {
    const user = await registerUser('x')
    for (const id of ['abc', "1' OR '1'='1", '00000000-0000-0000-0000-000000000000']) {
      expect((await user.client.get(`/campaigns/${encodeURIComponent(id)}`)).status).toBe(404)
    }
  })

  it('hráč nemůže spravovat kampaň, pozvánky ani odebírat jiné', async () => {
    const dm = await registerUser('dm')
    const id = await createCampaign(dm)
    const bob = await joinAsPlayer(dm, id, 'bob')
    const carol = await joinAsPlayer(dm, id, 'carol')
    const invite = await createInvite(dm, id)

    expect((await bob.client.patch(`/campaigns/${id}`, { name: 'Hacknuto' })).status).toBe(403)
    expect((await bob.client.delete(`/campaigns/${id}`)).status).toBe(403)
    expect((await bob.client.get(`/campaigns/${id}/invites`)).status).toBe(403)
    expect((await bob.client.post(`/campaigns/${id}/invites`, {})).status).toBe(403)
    expect((await bob.client.patch(`/campaigns/${id}/invites/${invite.id}`, { revoked: true })).status).toBe(403)
    expect((await bob.client.delete(`/campaigns/${id}/members/${carol.id}`)).status).toBe(403)
    expect((await bob.client.delete(`/campaigns/${id}/members/${dm.id}`)).status).toBe(403)

    const after = await dm.client.get(`/campaigns/${id}`)
    expect(after.body.campaign.name).toBe('Testovací kampaň')
    expect((await dm.client.get(`/campaigns/${id}/members`)).body.members).toHaveLength(3)
  })

  it('role se klientem změnit nedá (žádný endpoint, žádné pole)', async () => {
    const dm = await registerUser('dm')
    const id = await createCampaign(dm)
    const bob = await joinAsPlayer(dm, id)
    expect([404, 405]).toContain((await bob.client.patch(`/campaigns/${id}/members/${bob.id}`, { role: 'dm' })).status)
    expect((await bob.client.patch(`/campaigns/${id}`, { role: 'dm' })).status).toBe(403)
    const members = await dm.client.get(`/campaigns/${id}/members`)
    expect(members.body.members.find((m: { userId: string }) => m.userId === bob.id).role).toBe('player')
  })

  it('hráč může odejít, DM může odebrat hráče, DM se odebrat nedá', async () => {
    const dm = await registerUser('dm')
    const id = await createCampaign(dm)
    const bob = await joinAsPlayer(dm, id, 'bob')
    const carol = await joinAsPlayer(dm, id, 'carol')

    expect((await bob.client.delete(`/campaigns/${id}/members/${bob.id}`)).status).toBe(204)
    expect((await bob.client.get(`/campaigns/${id}`)).status).toBe(404)

    expect((await dm.client.delete(`/campaigns/${id}/members/${carol.id}`)).status).toBe(204)
    expect((await carol.client.get(`/campaigns/${id}`)).status).toBe(404)

    expect((await dm.client.delete(`/campaigns/${id}/members/${dm.id}`)).status).toBe(403)
    expect((await dm.client.get(`/campaigns/${id}/members`)).body.members).toHaveLength(1)
  })

  it('DM může kampaň přejmenovat a smazat', async () => {
    const dm = await registerUser('dm')
    const id = await createCampaign(dm)
    const bob = await joinAsPlayer(dm, id)
    expect((await dm.client.patch(`/campaigns/${id}`, { name: 'Nové jméno' })).body.campaign.name).toBe('Nové jméno')
    expect((await dm.client.delete(`/campaigns/${id}`)).status).toBe(204)
    expect((await dm.client.get(`/campaigns/${id}`)).status).toBe(404)
    expect((await bob.client.get(`/campaigns/${id}`)).status).toBe(404)
  })
})

describe('pozvánky', () => {
  it('náhled a přijetí pozvánky přihlášeným uživatelem', async () => {
    const dm = await registerUser('dm')
    const id = await createCampaign(dm, 'Pozvánková')
    const { code } = await createInvite(dm, id)
    const bob = await registerUser('bob')

    const preview = await bob.client.get(`/invites/${code}`)
    expect(preview.body.invite).toMatchObject({ campaignId: id, campaignName: 'Pozvánková', alreadyMember: false })
    expect(preview.body.invite.dmName).toBe(dm.username)

    expect((await bob.client.post(`/invites/${code}/accept`)).body.campaignId).toBe(id)
    const campaigns = await bob.client.get('/campaigns')
    expect(campaigns.body.campaigns[0]).toMatchObject({ id, role: 'player' })
  })

  it('opakované přijetí pozvánku nespotřebuje znovu', async () => {
    const dm = await registerUser('dm')
    const id = await createCampaign(dm)
    const { code } = await createInvite(dm, id, { maxUses: 5 })
    const bob = await registerUser('bob')
    await bob.client.post(`/invites/${code}/accept`)
    await bob.client.post(`/invites/${code}/accept`)
    const invites = await dm.client.get(`/campaigns/${id}/invites`)
    expect(invites.body.invites[0].uses).toBe(1)
  })

  it('DM kampaně přijetím vlastní pozvánky nepřijde o roli DM', async () => {
    const dm = await registerUser('dm')
    const id = await createCampaign(dm)
    const { code } = await createInvite(dm, id)
    expect((await dm.client.get(`/invites/${code}`)).body.invite.alreadyMember).toBe(true)
    await dm.client.post(`/invites/${code}/accept`)
    expect((await dm.client.get(`/campaigns/${id}`)).body.campaign.role).toBe('dm')
  })

  it('zrušená a vyčerpaná pozvánka se nedá použít', async () => {
    const dm = await registerUser('dm')
    const id = await createCampaign(dm)
    const revoked = await createInvite(dm, id)
    expect((await dm.client.patch(`/campaigns/${id}/invites/${revoked.id}`, { revoked: true })).body.invite.revoked).toBe(true)
    const full = await createInvite(dm, id, { maxUses: 1 })

    const a = await registerUser('a')
    const b = await registerUser('b')
    expect((await a.client.post(`/invites/${revoked.code}/accept`)).status).toBe(404)
    expect((await a.client.get(`/invites/${revoked.code}`)).status).toBe(404)
    expect((await a.client.post(`/invites/${full.code}/accept`)).status).toBe(200)
    expect((await b.client.post(`/invites/${full.code}/accept`)).status).toBe(404)
  })

  it('pozvánku jiné kampaně nejde zrušit přes cizí kampaň', async () => {
    const dm1 = await registerUser('dm1')
    const dm2 = await registerUser('dm2')
    const camp1 = await createCampaign(dm1)
    const camp2 = await createCampaign(dm2)
    const inv2 = await createInvite(dm2, camp2)
    // dm1 zkouší zrušit pozvánku kampaně 2 přes vlastní kampaň 1
    expect((await dm1.client.patch(`/campaigns/${camp1}/invites/${inv2.id}`, { revoked: true })).status).toBe(404)
    const bob = await registerUser('bob')
    expect((await bob.client.post(`/invites/${inv2.code}/accept`)).status).toBe(200)
  })

  it('kód pozvánky nejde hádat: po 30 pokusech přijde 429', async () => {
    const user = await registerUser('hadac')
    let last = 0
    for (let i = 0; i < 31; i++) {
      last = (await user.client.get('/invites/AAAAAAAAAA')).status
    }
    expect(last).toBe(429)
  })

  it('platnost pozvánky se validuje', async () => {
    const dm = await registerUser('dm')
    const id = await createCampaign(dm)
    expect((await dm.client.post(`/campaigns/${id}/invites`, { expiresInDays: 0 })).status).toBe(422)
    expect((await dm.client.post(`/campaigns/${id}/invites`, { expiresInDays: 366 })).status).toBe(422)
    expect((await dm.client.post(`/campaigns/${id}/invites`, { maxUses: 0 })).status).toBe(422)
    expect((await dm.client.post(`/campaigns/${id}/invites`, { expiresInDays: null })).body.invite.expiresAt).toBeNull()
  })

  it('anonym nemůže pozvánku ani zobrazit, ani přijmout', async () => {
    const dm = await registerUser('dm')
    const id = await createCampaign(dm)
    const { code } = await createInvite(dm, id)
    const anon = new Client()
    expect((await anon.get(`/invites/${code}`)).status).toBe(401)
    expect((await anon.post(`/invites/${code}/accept`)).status).toBe(401)
  })

  it('pravidla kampaně (2014 / 2024): mění jen DM, platné jsou jen dvě hodnoty, ostatní nastavení se nepřepíše', async () => {
    const dm = await registerUser('dm')
    const id = await createCampaign(dm, 'Pravidla')
    const player = await joinAsPlayer(dm, id, 'hrac')
    const outsider = await registerUser('cizi')

    // bez nastavení je kampaň ve výchozím stavu (klient bere 2014)
    expect((await dm.client.get(`/campaigns/${id}`)).body.campaign.settings).toEqual({})

    expectStatus(await player.client.patch(`/campaigns/${id}`, { settings: { ruleset: '2024' } }), 403)
    expectStatus(await outsider.client.patch(`/campaigns/${id}`, { settings: { ruleset: '2024' } }), 404)
    for (const bad of ['2020', 2024, null, '', '5e']) {
      expectStatus(await dm.client.patch(`/campaigns/${id}`, { settings: { ruleset: bad } }), 422)
    }
    expectStatus(await dm.client.patch(`/campaigns/${id}`, { settings: { encumbrance: true } }), 200)
    const res = await dm.client.patch(`/campaigns/${id}`, { settings: { ruleset: '2024' } })
    expectStatus(res, 200)
    expect(res.body.campaign.settings).toEqual({ encumbrance: true, ruleset: '2024' })
    // člen kampaně nastavení vidí, cizinec ne
    expect((await player.client.get(`/campaigns/${id}`)).body.campaign.settings.ruleset).toBe('2024')
    expectStatus(await outsider.client.get(`/campaigns/${id}`), 404)
    expect((await dm.client.patch(`/campaigns/${id}`, { settings: { ruleset: '2014' } })).body.campaign.settings).toEqual({ encumbrance: true, ruleset: '2014' })
  })
})
