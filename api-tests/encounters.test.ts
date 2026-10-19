import { beforeAll, describe, expect, it } from 'vitest'
import { Client, createCampaign, expectStatus, joinAsPlayer, registerUser, uniqueName, type TestUser } from './client'

/**
 * Nepřátelé v přípravě (loot): nestvůry ze SRD jako šablony, loot, který z nepřítele padá, „Do boje“ do Panelu DM
 * a návrh AI s nepřáteli. Všechno jen pro DM (hráč 403, cizinec 404, anonym 401).
 */
const MOCK = 'http://127.0.0.1:8199'

async function rule(user: TestUser, kind: string, name: string): Promise<any> {
  const res = await user.client.get(`/rules?kinds=${kind}&q=${encodeURIComponent(name)}&limit=20`)
  const hit = res.body.entries.find((e: any) => e.name === name)
  if (!hit) throw new Error(`V pravidlech chybí ${name}`)
  return hit
}

const goblin = { name: 'Goblin', hpMax: 7, ac: 15, initiative: 2, attacks: [{ name: 'Scimitar', toHit: 4, damage: '1d6+2' }], notes: '', count: 3, cr: '1/4', xp: 50 }

describe('nestvůry ze SRD', () => {
  let dm: TestUser
  beforeAll(async () => {
    dm = await registerUser('mondm')
  })

  it('jsou v pravidlech se stat blokem a šablonou nepřítele', async () => {
    const hit = await rule(dm, 'monster', 'Goblin')
    expect(hit).toMatchObject({ kind: 'monster', category: 'Humanoid', isSrd: true })
    expect(hit.summary).toContain('CR 1/4 (50 XP), AC 15, HP 7 (2d6)')
    const detail = (await dm.client.get(`/rules/${hit.id}`)).body.entry
    expect(detail.description).toContain('**Nimble Escape.**')
    expect(detail.enemyTemplate).toEqual({
      name: 'Goblin',
      hpMax: 7,
      ac: 15,
      initiative: 2,
      attacks: [
        { name: 'Scimitar', toHit: 4, damage: '1d6+2' },
        { name: 'Shortbow', toHit: 4, damage: '1d6+2' },
      ],
      notes: expect.stringContaining('CR 1/4 (50 XP)'),
      cr: '1/4',
      xp: 50,
    })
    // drak: víc kostek zranění v jednom útoku, Multiattack v poznámce
    const dragon = (await dm.client.get(`/rules/${(await rule(dm, 'monster', 'Adult Red Dragon')).id}`)).body.entry.enemyTemplate
    expect(dragon.attacks[0]).toEqual({ name: 'Bite', toHit: 14, damage: '2d10+8+2d6' })
    expect(dragon.notes).toContain('**Multiattack.**')
    // filtr podle CR (tag) a typu
    const cr = await dm.client.get('/rules?kinds=monster&tag=CR%201%2F4&category=Humanoid&limit=50')
    expect(cr.body.entries.map((e: any) => e.name)).toContain('Goblin')
    expect(cr.body.entries.every((e: any) => e.category === 'Humanoid')).toBe(true)
    // ostatní záznamy šablonu nemají
    const bag = (await dm.client.get(`/rules/${(await rule(dm, 'magic_item', 'Bag of Holding')).id}`)).body.entry
    expect(bag.enemyTemplate).toBeNull()
  })
})

describe('nepřátelé v přípravě a loot z nich', () => {
  let dm: TestUser
  let player: TestUser
  let campaignId: string
  let folderId: string
  let enemyId: string
  let dropId: string
  let goldId: string
  let characterId: string

  beforeAll(async () => {
    dm = await registerUser('encdm')
    campaignId = await createCampaign(dm, 'Setkání')
    player = await joinAsPlayer(dm, campaignId)
    characterId = (await player.client.post(`/campaigns/${campaignId}/characters`, { name: 'Bob', abilityScores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }, levels: [{ classIndex: 'fighter' }] })).body.character.id
    folderId = (await dm.client.post(`/campaigns/${campaignId}/loot/folders`, { name: 'Jeskyně' })).body.folder.id
  })

  it('nepřítel je šablona s ověřenými hodnotami; cenu ani „padá z“ mít nemůže', async () => {
    const created = await dm.client.post(`/campaigns/${campaignId}/loot/entries`, { folderId, kind: 'enemy', enemy: goblin })
    expectStatus(created, 201)
    enemyId = created.body.entry.id
    expect(created.body.entry).toMatchObject({ kind: 'enemy', folderId, dropFrom: null, data: { ...goblin } })
    for (const bad of [
      { kind: 'enemy', enemy: { name: 'Bez HP' } },
      { kind: 'enemy', enemy: { ...goblin, attacks: [{ name: 'X', toHit: 4, damage: 'hodně' }] } },
      { kind: 'enemy', enemy: { ...goblin, count: 21 } },
      { kind: 'enemy', enemy: { ...goblin, cr: 'silný' } },
      { kind: 'enemy', enemy: goblin, price: { gp: 5 } },
      { kind: 'enemy', enemy: goblin, dropFrom: enemyId },
    ]) {
      expect((await dm.client.post(`/campaigns/${campaignId}/loot/entries`, bad)).status, JSON.stringify(bad)).toBe(422)
    }
  })

  it('item a zlato můžou padat jen z nepřítele téže kampaně', async () => {
    const drop = await dm.client.post(`/campaigns/${campaignId}/loot/entries`, { folderId, kind: 'item', item: { name: 'Zrezivělý scimitar', kind: 'weapon' }, dropFrom: enemyId })
    expectStatus(drop, 201)
    dropId = drop.body.entry.id
    expect(drop.body.entry.dropFrom).toBe(enemyId)
    goldId = (await dm.client.post(`/campaigns/${campaignId}/loot/entries`, { folderId, kind: 'gold', name: 'Měšec', currency: { sp: 12 }, dropFrom: enemyId })).body.entry.id
    // na item odkazovat nejde, ani na nepřítele z cizí kampaně
    expect((await dm.client.post(`/campaigns/${campaignId}/loot/entries`, { kind: 'gold', currency: { cp: 1 }, dropFrom: dropId })).status).toBe(422)
    const other = await createCampaign(dm, 'Jiná')
    const foreign = (await dm.client.post(`/campaigns/${other}/loot/entries`, { kind: 'enemy', enemy: goblin })).body.entry.id
    expect((await dm.client.post(`/campaigns/${campaignId}/loot/entries`, { kind: 'gold', currency: { cp: 1 }, dropFrom: foreign })).status).toBe(422)
    // odkaz jde zrušit i změnit úpravou
    expectStatus(await dm.client.patch(`/loot/entries/${goldId}`, { dropFrom: null }), 200)
    const back = await dm.client.patch(`/loot/entries/${goldId}`, { dropFrom: enemyId })
    expect(back.body.entry.dropFrom).toBe(enemyId)
    expect((await dm.client.patch(`/loot/entries/${goldId}`, { dropFrom: goldId })).status).toBe(422)
  })

  it('nepřítele nejde rozdat hráčům (nic se nerozdá)', async () => {
    const res = await dm.client.post(`/campaigns/${campaignId}/loot/give`, { assignments: [{ entryId: goldId, characterIds: [characterId] }, { entryId: enemyId, characterIds: [characterId] }] })
    expect(res.status).toBe(422)
    const bob = (await player.client.get(`/characters/${characterId}`)).body.character
    expect(bob.currency.sp ?? 0).toBe(0)
  })

  it('Do boje: vzniknou očíslovaní nepřátelé s plnými HP a vidí, co z nich padá', async () => {
    const res = await dm.client.post(`/campaigns/${campaignId}/loot/deploy`, { entryIds: [enemyId] })
    expectStatus(res, 200)
    expect(res.body.created).toEqual(['Goblin 1', 'Goblin 2', 'Goblin 3'])
    const enemies = (await dm.client.get(`/campaigns/${campaignId}/enemies`)).body.enemies
    expect(enemies).toHaveLength(3)
    expect(enemies[0]).toMatchObject({ name: 'Goblin 1', hpMax: 7, hpCurrent: 7, ac: 15, initiative: 2, sourceEntryId: enemyId, sourceFolderId: folderId })
    expect(enemies[0].drops.map((d: any) => d.label)).toEqual(['Zrezivělý scimitar', 'Měšec: 12 sp'])
    // podruhé pokračuje v číslování; kopie si pamatuje šablonu
    const again = await dm.client.post(`/campaigns/${campaignId}/loot/deploy`, { entryIds: [enemyId] })
    expect(again.body.created).toEqual(['Goblin 4', 'Goblin 5', 'Goblin 6'])
    const copy = await dm.client.post(`/enemies/${enemies[0].id}/duplicate`, {})
    expect(copy.body.enemy).toMatchObject({ sourceEntryId: enemyId, drops: [{ label: 'Zrezivělý scimitar' }, { label: 'Měšec: 12 sp' }] })
    // jen nepřátelé z přípravy této kampaně
    expect((await dm.client.post(`/campaigns/${campaignId}/loot/deploy`, { entryIds: [dropId] })).status).toBe(422)
    expect((await dm.client.post(`/campaigns/${campaignId}/loot/deploy`, { entryIds: [] })).status).toBe(422)
  })

  it('přístup: hráč 403, cizinec 404, anonym 401', async () => {
    expect((await player.client.post(`/campaigns/${campaignId}/loot/deploy`, { entryIds: [enemyId] })).status).toBe(403)
    expect((await (await registerUser('cizi')).client.post(`/campaigns/${campaignId}/loot/deploy`, { entryIds: [enemyId] })).status).toBe(404)
    expect((await new Client().post(`/campaigns/${campaignId}/loot/deploy`, { entryIds: [enemyId] })).status).toBe(401)
    expect((await player.client.post(`/campaigns/${campaignId}/loot/entries`, { kind: 'enemy', enemy: goblin })).status).toBe(403)
  })

  it('smazaný nepřítel: loot zůstane ve složce bez odkazu, nepřátelé v boji zůstanou', async () => {
    expect((await dm.client.delete(`/loot/entries/${enemyId}`)).status).toBe(204)
    const tree = (await dm.client.get(`/campaigns/${campaignId}/loot`)).body
    expect(tree.entries.find((e: any) => e.id === dropId)).toMatchObject({ dropFrom: null, folderId })
    const enemies = (await dm.client.get(`/campaigns/${campaignId}/enemies`)).body.enemies
    expect(enemies.length).toBe(7)
    expect(enemies.every((e: any) => e.sourceEntryId === null && e.drops.length === 0)).toBe(true)
  })

  it('smazaná složka s nepřítelem: loot jinde z něj přestane padat', async () => {
    const room = (await dm.client.post(`/campaigns/${campaignId}/loot/folders`, { name: 'Doupě' })).body.folder.id
    const ogre = (await dm.client.post(`/campaigns/${campaignId}/loot/entries`, { folderId: room, kind: 'enemy', enemy: { ...goblin, name: 'Ogre', count: 1 } })).body.entry.id
    const club = (await dm.client.post(`/campaigns/${campaignId}/loot/entries`, { folderId, kind: 'item', item: { name: 'Kyj', kind: 'weapon' }, dropFrom: ogre })).body.entry.id
    expect((await dm.client.delete(`/loot/folders/${room}`)).status).toBe(204)
    const tree = (await dm.client.get(`/campaigns/${campaignId}/loot`)).body
    expect(tree.entries.find((e: any) => e.id === club).dropFrom).toBeNull()
  })
})

describe('munice v balení', () => {
  it('Arrow z pravidel je balení 20 kusů (×2 = 40), i v lootu', async () => {
    const dm = await registerUser('bundledm')
    const campaignId = await createCampaign(dm, 'Šípy')
    const charId = (await dm.client.post(`/campaigns/${campaignId}/characters`, { name: 'Lučištník', abilityScores: { str: 10, dex: 16, con: 10, int: 10, wis: 10, cha: 10 }, levels: [{ classIndex: 'ranger' }] })).body.character.id
    const arrow = (await rule(dm, 'equipment', 'Arrow')).id
    const one = await dm.client.post(`/characters/${charId}/items`, { ruleId: arrow })
    expect(one.body.item).toMatchObject({ name: 'Arrow', quantity: 20, consumable: true })
    const two = await dm.client.post(`/characters/${charId}/items`, { ruleId: arrow, quantity: 2 })
    expect(two.body.item.quantity).toBe(40)
    expect((await dm.client.post(`/characters/${charId}/items`, { ruleId: arrow, quantity: 500 })).status).toBe(422)
    const loot = await dm.client.post(`/campaigns/${campaignId}/loot/entries`, { kind: 'item', item: { ruleId: arrow }, price: { gp: 1 } })
    expect(loot.body.entry).toMatchObject({ priceCp: 100, data: { name: 'Arrow', quantity: 20 } })
    // běžné vybavení zůstává po kusech
    const rope = await dm.client.post(`/characters/${charId}/items`, { ruleId: (await rule(dm, 'equipment', 'Rope, hempen (50 feet)')).id, quantity: 2 })
    expect(rope.body.item.quantity).toBe(2)
  })
})

describe('AI pomocník navrhne setkání s lootem z nepřátel', () => {
  async function script(key: string, responses: unknown[]): Promise<void> {
    await fetch(`${MOCK}/__mock/script`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key, responses }) })
  }
  const toolUse = (id: string, name: string, input: unknown) => ({ type: 'tool_use', id, name, input })

  it('nepřítel z pravidel + loot přes key; chybný odkaz a cena u nepřítele se vrátí jako chyba', async () => {
    const dm = await registerUser('aidmenc')
    const campaignId = await createCampaign(dm, 'AI setkání')
    const monster = await rule(dm, 'monster', 'Goblin')
    const scimitar = await rule(dm, 'weapon', 'Scimitar')
    const k = uniqueName('enc')
    const good = [
      { folder: ['Jeskyně', '1. Vstup'], type: 'enemy', key: 'goblini', ruleId: monster.id, count: 4, notes: 'Hlídají vstup, dva s luky.' },
      { folder: ['Jeskyně', '1. Vstup'], type: 'rule_item', ruleId: scimitar.id, quantity: 2, dropFrom: 'goblini' },
      { folder: ['Jeskyně', '1. Vstup'], type: 'gold', coins: { cp: 30, sp: 8 }, name: 'Měšce goblinů', dropFrom: 'goblini' },
      { folder: ['Jeskyně', '1. Vstup'], type: 'gold', coins: { gp: 25 }, name: 'Truhla' },
    ]
    await script(k, [
      { content: [toolUse('a', 'search_rules', { kinds: ['monster'], cr: '1/4', monsterType: 'humanoid' }), toolUse('b', 'get_rule', { id: monster.id })] },
      { content: [toolUse('c', 'propose_loot', { title: 'Setkání', entries: [{ ...good[0], price: { gp: 1 } }, { ...good[1], dropFrom: 'skreti' }] })] },
      { content: [toolUse('d', 'propose_loot', { title: 'Jeskyně: vstup', entries: good })] },
      { content: [{ type: 'text', text: 'Hotovo.' }] },
    ])
    let conv = (await dm.client.post(`/campaigns/${campaignId}/ai/conversations`, { message: `[[mock:${k}]] setkání` })).body.conversation
    for (let i = 0; i < 10 && conv.state === 'working'; i++) conv = (await dm.client.post(`/ai/conversations/${conv.id}/step`)).body.conversation
    const log = (await (await fetch(`${MOCK}/__mock/log?key=${k}`)).json()).requests
    const [search, detail] = log[1].body.messages.at(-1).content
    expect(JSON.parse(search.content).results.some((r: any) => r.name === 'Goblin')).toBe(true)
    expect(JSON.parse(detail.content)).toMatchObject({ kind: 'monster', enemy: { hpMax: 7, ac: 15 } })
    expect(JSON.parse(detail.content).data).toBeUndefined()
    const rejected = log[2].body.messages.at(-1).content[0]
    expect(rejected.is_error).toBe(true)
    expect(rejected.content).toContain('Nepřítel nemá cenu')
    expect(rejected.content).toContain("dropFrom 'skreti'")

    const card = conv.items.find((i: any) => i.type === 'proposal').proposal
    expect(card.entries[0]).toMatchObject({ kind: 'enemy', label: 'Goblin', count: 4, cr: '1/4', ac: 15, hpMax: 7, dropFrom: null })
    expect(card.entries[1]).toMatchObject({ label: 'Scimitar', quantity: 2, dropFrom: 'Goblin' })
    expect(card.entries[3]).toMatchObject({ label: 'Truhla', dropFrom: null })

    const applied = await dm.client.post(`/ai/proposals/${card.id}/apply`)
    expectStatus(applied, 200)
    const enemy = applied.body.entries.find((e: any) => e.kind === 'enemy')
    expect(enemy.data).toMatchObject({ name: 'Goblin', count: 4, hpMax: 7, cr: '1/4' })
    expect(enemy.data.notes).toMatch(/^Hlídají vstup, dva s luky\.\nCR 1\/4/)
    const drops = applied.body.entries.filter((e: any) => e.dropFrom === enemy.id).map((e: any) => e.data.name)
    expect(drops.sort()).toEqual(['Měšce goblinů', 'Scimitar'])
    expect(applied.body.entries.find((e: any) => e.data.name === 'Truhla').dropFrom).toBeNull()
    // vznikl nepřítel před svým lootem a do boje jde rovnou
    const fight = await dm.client.post(`/campaigns/${campaignId}/loot/deploy`, { entryIds: [enemy.id] })
    expect(fight.body.created).toHaveLength(4)
  })
})
