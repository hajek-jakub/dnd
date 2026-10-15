import { beforeAll, describe, expect, it } from 'vitest'
import { Client, createCampaign, expectStatus, joinAsPlayer, registerUser, type TestUser } from './client'

interface Entry {
  id: string
  kind: string
  name: string
  level: number | null
  category: string | null
  rarity: string | null
  attunement: boolean | null
  source: string
  isSrd: boolean
  isHomebrew: boolean
  priceGp: number | null
  hasText: boolean
  refUrl?: string
}

async function list(client: Client, query: string) {
  const res = await client.get(`/rules?${query}`)
  expectStatus(res, 200)
  return res.body as { total: number; entries: Entry[] }
}

describe('SRD 5.1 a katalog itemů', () => {
  let user: TestUser
  beforeAll(async () => {
    user = await registerUser('rules')
  })

  it('vyžaduje přihlášení', async () => {
    const anon = new Client()
    expect((await anon.get('/rules?kinds=spell')).status).toBe(401)
    expect((await anon.get('/rules/facets?kinds=spell')).status).toBe(401)
    expect((await anon.get('/rules/00000000-0000-0000-0000-000000000000')).status).toBe(401)
  })

  it('obsahuje celý SRD: 319 kouzel, 12 tříd a 12 subclass', async () => {
    expect((await list(user.client, 'kinds=spell&limit=1')).total).toBe(319)
    expect((await list(user.client, 'kinds=class&limit=1')).total).toBe(12)
    expect((await list(user.client, 'kinds=subclass&limit=1')).total).toBe(12)
    expect((await list(user.client, 'kinds=condition&limit=1')).total).toBe(15)
  })

  it('obsahuje povinné záznamy pro Monk 5 / Warlock 1', async () => {
    for (const [kind, name] of [
      ['class', 'Monk'],
      ['class', 'Warlock'],
      ['subclass', 'Open Hand'],
      ['subclass', 'Fiend'],
      ['feature', 'Stunning Strike'],
      ['feature', 'Extra Attack'],
      ['feature', 'Ki'],
      ['feature', 'Unarmored Defense'],
      ['feature', 'Pact Magic'],
    ]) {
      const res = await list(user.client, `kinds=${kind}&q=${encodeURIComponent(name!)}`)
      expect(res.entries.some((e) => e.name.toLowerCase().includes(name!.toLowerCase())), `${kind}: ${name}`).toBe(true)
    }
    // Open Hand Technique je featura subclassy Way of the Open Hand
    const technique = await list(user.client, 'kinds=feature&q=Open%20Hand%20Technique')
    expect(technique.total).toBeGreaterThan(0)
  })

  it('vyhledává a filtruje kouzla', async () => {
    const fireball = (await list(user.client, 'kinds=spell&q=fireball')).entries.find((e) => e.name === 'Fireball')
    expect(fireball).toMatchObject({ name: 'Fireball', level: 3, category: 'Evocation', isSrd: true, hasText: true })

    const level3 = await list(user.client, 'kinds=spell&level=3&limit=100')
    expect(level3.total).toBeGreaterThan(10)
    expect(level3.entries.every((e) => e.level === 3)).toBe(true)

    const wizardCantrips = await list(user.client, 'kinds=spell&level=0&tag=Wizard&limit=100')
    expect(wizardCantrips.total).toBeGreaterThan(5)
    expect(wizardCantrips.entries.some((e) => e.name === 'Fire Bolt')).toBe(true)
    const school = await list(user.client, 'kinds=spell&category=Necromancy&limit=100')
    expect(school.entries.every((e) => e.category === 'Necromancy')).toBe(true)
  })

  it('detail kouzla obsahuje komponenty, dosah a vyšší úroveň', async () => {
    const fireball = (await list(user.client, 'kinds=spell&q=fireball')).entries.find((e) => e.name === 'Fireball')
    const res = await user.client.get(`/rules/${fireball!.id}`)
    expectStatus(res, 200)
    expect(res.body.entry.description).toContain('bright streak')
    expect(res.body.entry.data).toMatchObject({ casting_time: '1 action', range: '150 feet', components: ['V', 'S', 'M'], concentration: false })
    expect(res.body.entry.data.higher_level).toContain('4th level')
    expect(res.body.entry.data.classes).toEqual(expect.arrayContaining(['Wizard', 'Sorcerer']))
    expect(res.body.entry.canEdit).toBe(false)
  })

  it('stránkuje výsledky stabilně', async () => {
    const a = await list(user.client, 'kinds=spell&limit=10&offset=0')
    const b = await list(user.client, 'kinds=spell&limit=10&offset=10')
    expect(a.entries).toHaveLength(10)
    const ids = new Set([...a.entries, ...b.entries].map((e) => e.id))
    expect(ids.size).toBe(20)
  })

  it('magické itemy: SRD má popis, ostatní jen fakta a odkaz; ceny z ceníku', async () => {
    const bag = (await list(user.client, 'kinds=magic_item&q=Bag%20of%20Holding')).entries.find((e) => e.name === 'Bag of Holding')!
    expect(bag).toMatchObject({ isSrd: true, hasText: true, rarity: 'uncommon', source: 'SRD 5.1' })
    expect(bag.priceGp).toBe(1000)

    const armor = (await list(user.client, 'kinds=magic_item&q=Adamantine%20Armor')).entries.find((e) => e.name === 'Adamantine Armor')!
    expect(armor.priceGp).toBe(1000)
    const detail = await user.client.get(`/rules/${armor.id}`)
    expect(detail.body.entry.priceNote).toBe('1,000 gp + 2 x armor cost')

    // Položka z Xanathar's Guide (mimo SRD): žádný kopírovaný popis, ale odkaz na aidedd
    const gleaming = (await list(user.client, 'kinds=magic_item&q=Armor%20of%20Gleaming')).entries.find((e) => e.name === 'Armor of Gleaming')!
    expect(gleaming).toMatchObject({ isSrd: false, hasText: false, source: 'XGE', rarity: 'common' })
    const gDetail = await user.client.get(`/rules/${gleaming.id}`)
    expect(gDetail.body.entry.description).toBe('')
    expect(gDetail.body.entry.refUrl).toBe('https://www.aidedd.org/dnd/om.php?vo=armor-of-gleaming')
    expect(gleaming.priceGp).toBe(50)

    // Položka bez odkazu na aidedd (jen z ceníku): cena a zdroj bez popisu
    const tattoo = (await list(user.client, 'kinds=magic_item&q=Absorbing%20Tattoo')).entries[0]!
    expect(tattoo).toMatchObject({ isSrd: false, hasText: false, source: 'TCE', priceGp: 3000 })
  })

  it('filtruje itemy podle vzácnosti, attunementu a zdroje', async () => {
    const legendary = await list(user.client, 'kinds=magic_item&rarity=legendary&limit=100')
    expect(legendary.total).toBeGreaterThan(10)
    expect(legendary.entries.every((e) => e.rarity === 'legendary')).toBe(true)

    const attuned = await list(user.client, 'kinds=magic_item&attunement=1&limit=100')
    expect(attuned.entries.every((e) => e.attunement === true)).toBe(true)

    const srdOnly = await list(user.client, 'kinds=magic_item&scope=srd&limit=100')
    expect(srdOnly.entries.every((e) => e.isSrd)).toBe(true)
    const other = await list(user.client, 'kinds=magic_item&scope=other&limit=100')
    expect(other.entries.every((e) => !e.isSrd)).toBe(true)
    expect(srdOnly.total + other.total).toBe((await list(user.client, 'kinds=magic_item&limit=1')).total)

    const xge = await list(user.client, 'kinds=magic_item&source=XGE&limit=100')
    expect(xge.total).toBeGreaterThan(30)
  })

  it('zbraně a zbroje mají cenu v gp a vlastnosti', async () => {
    const longsword = (await list(user.client, 'kinds=weapon&q=Longsword')).entries.find((e) => e.name === 'Longsword')!
    expect(longsword.priceGp).toBe(15)
    const detail = await user.client.get(`/rules/${longsword.id}`)
    expect(detail.body.entry.data.damage).toEqual({ dice: '1d8', type: 'Slashing' })
    expect(detail.body.entry.data.properties).toEqual(expect.arrayContaining(['Versatile']))
    const plate = (await list(user.client, 'kinds=armor&q=Plate')).entries.find((e) => e.name === 'Plate Armor')!
    expect(plate.priceGp).toBe(1500)
  })

  it('facety vrací hodnoty pro filtry', async () => {
    const spells = (await user.client.get('/rules/facets?kinds=spell')).body
    expect(spells.categories).toEqual(expect.arrayContaining(['Evocation', 'Necromancy']))
    expect(spells.levels).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(spells.tags).toEqual(expect.arrayContaining(['Wizard', 'Cleric']))
    const items = (await user.client.get('/rules/facets?kinds=magic_item')).body
    expect(items.rarities).toEqual(expect.arrayContaining(['common', 'legendary']))
    expect(items.sources).toEqual(expect.arrayContaining(['SRD 5.1', 'XGE', 'TCE']))
  })

  it('odmítá neznámý druh a hledání s divnými znaky nespadne', async () => {
    expect((await user.client.get('/rules?kinds=hack')).status).toBe(422)
    expect((await user.client.get("/rules?kinds=spell&q=%27%20OR%201%3D1%20--")).status).toBe(200)
    expect((await list(user.client, 'kinds=spell&q=%25')).total).toBe(0) // % se bere doslova
  })

  it('oficiální obsah nejde přes API měnit ani mazat', async () => {
    const fireball = (await list(user.client, 'kinds=spell&q=fireball')).entries.find((e) => e.name === 'Fireball')!
    expect((await user.client.patch(`/rules/${fireball.id}`, { name: 'Hack' })).status).toBe(403)
    expect((await user.client.delete(`/rules/${fireball.id}`)).status).toBe(403)
    expect((await user.client.get(`/rules/${fireball.id}`)).body.entry.name).toBe('Fireball')
  })

  it('seed je idempotentní a zabezpečený klíčem', async () => {
    const c = new Client()
    expect((await c.request('POST', '/admin/seed', {})).status).toBe(403)
    expect((await c.request('POST', '/admin/seed', {}, { 'X-Migrate-Key': 'spatny' })).status).toBe(403)
    const again = await c.request('POST', '/admin/seed', {}, { 'X-Migrate-Key': 'test-migrate' })
    expect(again.status).toBe(200)
    expect(again.body.skipped).toBe(true)
    const before = (await list(user.client, 'kinds=spell&limit=1')).total
    const forced = await c.request('POST', '/admin/seed?force=1', {}, { 'X-Migrate-Key': 'test-migrate' })
    expect(forced.body.skipped).toBe(false)
    expect(forced.body.counts.spell).toBe(319)
    expect(forced.body.removed).toBe(0)
    expect((await list(user.client, 'kinds=spell&limit=1')).total).toBe(before)
  })
})

describe('homebrew obsah', () => {
  let dm: TestUser
  let bob: TestUser
  let carol: TestUser
  let dave: TestUser // cizinec
  let campaignId: string
  let otherCampaignId: string
  let bobSpell: string
  let bobPrivate: string

  beforeAll(async () => {
    dm = await registerUser('dm')
    campaignId = await createCampaign(dm, 'Homebrew kampaň')
    otherCampaignId = await createCampaign(dm, 'Jiná kampaň')
    bob = await joinAsPlayer(dm, campaignId, 'bob')
    carol = await joinAsPlayer(dm, campaignId, 'carol')
    dave = await registerUser('dave')

    const spell = await bob.client.post(`/campaigns/${campaignId}/homebrew`, {
      kind: 'spell',
      name: 'Bobův ohnivý šíp',
      description: 'Vystřelíš šíp z ohně.',
      level: 2,
      school: 'Evocation',
      castingTime: '1 action',
      range: '60 feet',
      components: 'V, S',
      duration: 'Instantaneous',
      classes: 'Wizard, Sorcerer',
      concentration: false,
    })
    expectStatus(spell, 201)
    bobSpell = spell.body.entry.id

    const priv = await bob.client.post(`/campaigns/${campaignId}/homebrew`, {
      kind: 'magic_item',
      name: 'Bobův tajný prsten',
      description: 'Zatím nikdo neví.',
      rarity: 'rare',
      attunement: true,
      priceGp: 1234.5,
      visibility: 'private',
    })
    expectStatus(priv, 201)
    bobPrivate = priv.body.entry.id
  })

  it('člen vytvoří homebrew a vidí ho ve výpisu i v detailu', async () => {
    const res = await bob.client.get(`/rules/${bobSpell}`)
    expect(res.body.entry).toMatchObject({
      name: 'Bobův ohnivý šíp',
      kind: 'spell',
      level: 2,
      category: 'Evocation',
      isHomebrew: true,
      isSrd: false,
      source: 'Homebrew',
      visibility: 'campaign',
      canEdit: true,
      ownerName: bob.username,
    })
    expect(res.body.entry.data).toMatchObject({ casting_time: '1 action', range: '60 feet', classes: ['Wizard', 'Sorcerer'] })
    expect(res.body.entry.tags).toEqual(['Wizard', 'Sorcerer'])

    const mine = await list(bob.client, `kinds=spell&scope=homebrew&campaignId=${campaignId}`)
    expect(mine.entries.map((e) => e.name)).toEqual(['Bobův ohnivý šíp'])
    const wizard = await list(bob.client, `kinds=spell&tag=Wizard&campaignId=${campaignId}&limit=100`)
    expect(wizard.entries.some((e) => e.name === 'Bobův ohnivý šíp')).toBe(true)
  })

  it('bez campaignId se homebrew ve výpisu nikdy neukáže', async () => {
    const all = await list(bob.client, 'kinds=spell&q=Bobův&limit=100')
    expect(all.total).toBe(0)
    expect((await bob.client.get('/rules?kinds=spell&scope=homebrew')).status).toBe(422)
  })

  it('ostatní členové vidí sdílený homebrew, ale ne soukromý; DM vidí vše', async () => {
    expect((await carol.client.get(`/rules/${bobSpell}`)).status).toBe(200)
    expect((await carol.client.get(`/rules/${bobPrivate}`)).status).toBe(404)
    const carolView = await list(carol.client, `kinds=spell,magic_item&scope=homebrew&campaignId=${campaignId}`)
    expect(carolView.entries.map((e) => e.name)).toEqual(['Bobův ohnivý šíp'])

    const dmView = await list(dm.client, `kinds=spell,magic_item&scope=homebrew&campaignId=${campaignId}`)
    expect(dmView.entries.map((e) => e.name).sort()).toEqual(['Bobův ohnivý šíp', 'Bobův tajný prsten'])
    const ring = await dm.client.get(`/rules/${bobPrivate}`)
    expect(ring.body.entry).toMatchObject({ rarity: 'rare', attunement: true, priceGp: 1234.5, visibility: 'private', canEdit: true })
  })

  it('cizinec nevidí homebrew cizí kampaně ani ho nenajde přes výpis', async () => {
    expect((await dave.client.get(`/rules/${bobSpell}`)).status).toBe(404)
    expect((await dave.client.get(`/rules/${bobPrivate}`)).status).toBe(404)
    expect((await dave.client.get(`/rules?kinds=spell&scope=homebrew&campaignId=${campaignId}`)).status).toBe(404)
    expect((await dave.client.get(`/rules?kinds=spell&campaignId=${campaignId}`)).status).toBe(404)
    expect((await dave.client.get(`/rules/facets?kinds=spell&campaignId=${campaignId}`)).status).toBe(404)
    expect((await list(dave.client, 'kinds=spell,magic_item&q=Bobův')).total).toBe(0)
    expect((await dave.client.post(`/campaigns/${campaignId}/homebrew`, { kind: 'spell', name: 'Hack', level: 1 })).status).toBe(404)
  })

  it('homebrew jedné kampaně není vidět v jiné kampani', async () => {
    const dmOther = await list(dm.client, `kinds=spell&scope=homebrew&campaignId=${otherCampaignId}`)
    expect(dmOther.total).toBe(0)
    const dmAllMine = await list(dm.client, `kinds=spell&campaignId=${otherCampaignId}&q=Bobův`)
    expect(dmAllMine.total).toBe(0)
  })

  it('upravit nebo smazat smí jen autor a DM', async () => {
    expect((await carol.client.patch(`/rules/${bobSpell}`, { name: 'Carol hack' })).status).toBe(403)
    expect((await carol.client.delete(`/rules/${bobSpell}`)).status).toBe(403)
    expect((await carol.client.patch(`/rules/${bobPrivate}`, { name: 'Hack' })).status).toBe(404) // soukromé: neexistuje
    expect((await dave.client.patch(`/rules/${bobSpell}`, { name: 'Hack' })).status).toBe(404)
    expect((await dave.client.delete(`/rules/${bobSpell}`)).status).toBe(404)
    expect((await bob.client.get(`/rules/${bobSpell}`)).body.entry.name).toBe('Bobův ohnivý šíp')

    const edited = await bob.client.patch(`/rules/${bobSpell}`, { description: 'Nový popis', level: 3, range: '120 feet' })
    expect(edited.status).toBe(200)
    expect(edited.body.entry).toMatchObject({ description: 'Nový popis', level: 3, name: 'Bobův ohnivý šíp' })
    // částečná úprava nesmí přepsat ostatní údaje
    expect(edited.body.entry.data).toMatchObject({ range: '120 feet', casting_time: '1 action', components: 'V, S' })

    const byDm = await dm.client.patch(`/rules/${bobSpell}`, { name: 'Přejmenováno DM' })
    expect(byDm.body.entry.name).toBe('Přejmenováno DM')
    expect((await bob.client.patch(`/rules/${bobSpell}`, { name: 'Bobův ohnivý šíp' })).status).toBe(200)
  })

  it('hráč může svůj homebrew skrýt, DM ho může smazat', async () => {
    const hidden = await bob.client.patch(`/rules/${bobSpell}`, { visibility: 'private' })
    expect(hidden.body.entry.visibility).toBe('private')
    expect((await carol.client.get(`/rules/${bobSpell}`)).status).toBe(404)
    await bob.client.patch(`/rules/${bobSpell}`, { visibility: 'campaign' })
    expect((await carol.client.get(`/rules/${bobSpell}`)).status).toBe(200)

    const temp = await bob.client.post(`/campaigns/${campaignId}/homebrew`, { kind: 'feature', name: 'Dočasná featura', description: 'x', level: 3, category: 'Monk' })
    expectStatus(temp, 201)
    expect((await dm.client.delete(`/rules/${temp.body.entry.id}`)).status).toBe(204)
    expect((await bob.client.get(`/rules/${temp.body.entry.id}`)).status).toBe(404)
  })

  it('validuje vstup', async () => {
    const post = (body: unknown) => bob.client.post(`/campaigns/${campaignId}/homebrew`, body)
    expect((await post({ kind: 'monster', name: 'x' })).status).toBe(422)
    expect((await post({ kind: 'spell', name: '', level: 1 })).status).toBe(422)
    expect((await post({ kind: 'spell', name: 'x' })).status).toBe(422) // chybí level
    expect((await post({ kind: 'spell', name: 'x', level: 10 })).status).toBe(422)
    expect((await post({ kind: 'magic_item', name: 'x', rarity: 'mythic' })).status).toBe(422)
    expect((await post({ kind: 'magic_item', name: 'x', priceGp: -5 })).status).toBe(422)
    expect((await post({ kind: 'subclass', name: 'x' })).status).toBe(422) // chybí mateřská třída
    expect((await post({ kind: 'feature', name: 'x', level: 25 })).status).toBe(422)
    expect((await post({ kind: 'spell', name: 'x', level: 1, visibility: 'public' })).status).toBe(422)
    const ok = await post({ kind: 'subclass', name: 'Cesta stínu', category: 'Monk', description: 'Popis' })
    expect(ok.status).toBe(201)
    expect(ok.body.entry.tags).toEqual(['Monk'])
  })

  it('XSS a SQL v názvu jsou jen text', async () => {
    const evil = "<script>alert(1)</script>'; DROP TABLE rules_entries;--"
    const res = await bob.client.post(`/campaigns/${campaignId}/homebrew`, { kind: 'feature', name: evil, description: evil })
    expect(res.status).toBe(201)
    expect(res.body.entry.name).toBe(evil)
    expect((await list(bob.client, 'kinds=spell&limit=1')).total).toBe(319)
  })

  it('po smazání kampaně zmizí i její homebrew', async () => {
    const campaign = await createCampaign(dm, 'Dočasná')
    const member = await joinAsPlayer(dm, campaign, 'tmp')
    const made = await member.client.post(`/campaigns/${campaign}/homebrew`, { kind: 'spell', name: 'Dočasné kouzlo', level: 1 })
    expectStatus(made, 201)
    expect((await dm.client.delete(`/campaigns/${campaign}`)).status).toBe(204)
    expect((await dm.client.get(`/rules/${made.body.entry.id}`)).status).toBe(404)
  })
})
