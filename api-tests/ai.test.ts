import { beforeAll, describe, expect, it } from 'vitest'
import { Client, createCampaign, expectStatus, joinAsPlayer, registerUser, uniqueName, type TestUser } from './client'

/**
 * AI pomocník DM proti napodobenému Claude API (scripts/claude-mock.mjs). Ověřuje přístup (jen DM a jen povolené účty),
 * soukromí konverzací, že model vidí jen data kampaně, že historie jde do API beze změny (myšlenkové bloky, prázdné `{}`),
 * že návrh nic nezapíše, dokud ho DM nepotvrdí, a limity (rozpočet, počet kroků, odmítnutí, výpadek API).
 * Pomocníka smí jen účty začínající „aidm“ (claude_users v api/config.test.php).
 */
const MOCK = 'http://127.0.0.1:8199'

async function script(key: string, responses: unknown[]): Promise<void> {
  const res = await fetch(`${MOCK}/__mock/script`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key, responses }) })
  expect(res.status).toBe(200)
}

async function mockLog(key: string): Promise<any[]> {
  return (await (await fetch(`${MOCK}/__mock/log?key=${key}`)).json()).requests
}

const toolUse = (id: string, name: string, input: unknown) => ({ type: 'tool_use', id, name, input })
const text = (t: string) => ({ type: 'text', text: t })

async function ruleId(user: TestUser, q: string, kinds: string): Promise<string> {
  const res = await user.client.get(`/rules?q=${encodeURIComponent(q)}&kinds=${kinds}&scope=srd&limit=5`)
  const hit = res.body.entries.find((e: any) => e.name === q)
  if (!hit) throw new Error(`V pravidlech chybí ${q}`)
  return hit.id
}

/** Pošle kroky, dokud AI pracuje (jako klient v prohlížeči), a vrátí poslední stav konverzace. */
async function runUntilDone(user: TestUser, conversation: any, max = 20): Promise<any> {
  let conv = conversation
  for (let i = 0; i < max && conv.state === 'working'; i++) {
    const res = await user.client.post(`/ai/conversations/${conv.id}/step`)
    expectStatus(res, 200)
    conv = res.body.conversation
  }
  return conv
}

describe('AI pomocník: přístup', () => {
  let dm: TestUser
  let campaignId: string
  let player: TestUser

  beforeAll(async () => {
    dm = await registerUser('aidm')
    campaignId = await createCampaign(dm, 'AI kampaň')
    player = await joinAsPlayer(dm, campaignId)
  })

  it('anonym 401, cizinec 404, hráč 403', async () => {
    expect((await new Client().get(`/campaigns/${campaignId}/ai`)).status).toBe(401)
    expect((await new Client().post(`/campaigns/${campaignId}/ai/conversations`, { message: 'x' })).status).toBe(401)
    const stranger = await registerUser('aidm')
    expect((await stranger.client.get(`/campaigns/${campaignId}/ai`)).status).toBe(404)
    expect((await stranger.client.post(`/campaigns/${campaignId}/ai/conversations`, { message: 'x' })).status).toBe(404)
    expect((await player.client.get(`/campaigns/${campaignId}/ai`)).status).toBe(403)
    expect((await player.client.post(`/campaigns/${campaignId}/ai/conversations`, { message: 'x' })).status).toBe(403)
  })

  it('DM mimo claude_users pomocníka nevidí ani nespustí', async () => {
    const other = await registerUser('dm')
    const otherCampaign = await createCampaign(other)
    const status = await other.client.get(`/campaigns/${otherCampaign}/ai`)
    expectStatus(status, 200)
    expect(status.body).toMatchObject({ enabled: false, configured: true, conversations: [] })
    expect((await other.client.post(`/campaigns/${otherCampaign}/ai/conversations`, { message: 'Ahoj' })).status).toBe(403)
  })

  it('povolený DM vidí stav, model a rozpočet', async () => {
    const status = await dm.client.get(`/campaigns/${campaignId}/ai`)
    expectStatus(status, 200)
    expect(status.body).toMatchObject({ enabled: true, configured: true, model: 'claude-opus-5-5', budgetUsd: 5 })
  })

  it('zpráva musí mít 1 až 4000 znaků', async () => {
    expect((await dm.client.post(`/campaigns/${campaignId}/ai/conversations`, { message: '' })).status).toBe(422)
    expect((await dm.client.post(`/campaigns/${campaignId}/ai/conversations`, { message: 'x'.repeat(4001) })).status).toBe(422)
  })
})

describe('AI pomocník: konverzace a návrh lootu', () => {
  let dm: TestUser
  let player: TestUser
  let campaignId: string
  let conversationId: string
  let proposalId: string
  const key = uniqueName('loot')

  beforeAll(async () => {
    dm = await registerUser('aidm')
    campaignId = await createCampaign(dm, 'Hrobka')
    player = await joinAsPlayer(dm, campaignId)
  })

  it('AI hledá v pravidlech, chybný návrh opraví a hotový návrh nic nezapíše', async () => {
    const bag = await ruleId(dm, 'Bag of Holding', 'magic_item')
    const armorPlus1 = await ruleId(dm, 'Armor, +1', 'magic_item')
    const chain = await ruleId(dm, 'Chain Mail', 'armor')
    const entries = [
      { folder: ['Hrobka', 'Místnost 1'], type: 'rule_item', ruleId: bag },
      { folder: ['Hrobka', 'Místnost 1'], type: 'gold', coins: { gp: 50 }, name: 'Truhla' },
      { folder: ['Hrobka', 'Místnost 2'], type: 'rule_item', ruleId: armorPlus1 },
    ]
    await script(key, [
      { content: [{ type: 'thinking', thinking: '', signature: 'sig-1' }, text('Podívám se.'), toolUse('tu_1', 'search_rules', { query: 'Bag of Holding' }), toolUse('tu_2', 'get_loot', {})] },
      // Armor, +1 bez základu: aplikace návrh odmítne a AI ho opraví
      { content: [toolUse('tu_3', 'propose_loot', { title: 'Loot: Hrobka', entries })] },
      {
        content: [
          toolUse('tu_4', 'propose_loot', {
            title: 'Loot: Hrobka',
            folders: [['Hrobka', 'Chodba']],
            entries: [
              ...entries.slice(0, 2),
              { ...entries[2], baseRuleId: chain },
              { folder: [], type: 'custom_item', name: 'Lano z obchodu', itemKind: 'other', description: '**Pevné**: unese troll.', price: { gp: 1, sp: 5 } },
            ],
          }),
        ],
      },
      { content: [text('Návrh je připravený.')] },
    ])

    const created = await dm.client.post(`/campaigns/${campaignId}/ai/conversations`, { message: `[[mock:${key}]] Připrav loot do hrobky` })
    expectStatus(created, 201)
    expect(created.body.conversation.state).toBe('working')
    conversationId = created.body.conversation.id
    const done = await runUntilDone(dm, created.body.conversation)
    expect(done.state).toBe('idle')

    const log = await mockLog(key)
    expect(log).toHaveLength(4)
    // požadavek: hlavičky, model, nástroje, cache, fallback a zacházení s myšlenkovými bloky
    expect(log[0].headers.version).toBe('2023-06-01')
    expect(log[0].headers.beta).toBe('thinking-binding-controls-2026-08-01,server-side-fallback-2026-07-01')
    expect(log[0].body).toMatchObject({
      model: 'claude-opus-5-5',
      max_tokens: 16000,
      fallbacks: 'default',
      output_config: { effort: 'medium' },
      cache_control: { type: 'ephemeral' },
      thinking: { type: 'adaptive', block_binding: { prefix_mismatch_behavior: 'drop_block' } },
    })
    expect(log[0].body.tools.map((t: any) => t.name)).toEqual(['search_rules', 'get_rule', 'get_loot', 'get_party', 'propose_loot'])
    expect(log[0].body.system[0].text).toContain('Dungeon Master')
    // historie jde zpět beze změny: myšlenkový blok s podpisem a prázdný objekt vstupu nástroje (ne pole)
    const second = log[1].body.messages
    expect(second).toHaveLength(3)
    expect(second[1]).toEqual({ role: 'assistant', content: [{ type: 'thinking', thinking: '', signature: 'sig-1' }, text('Podívám se.'), toolUse('tu_1', 'search_rules', { query: 'Bag of Holding' }), toolUse('tu_2', 'get_loot', {})] })
    expect(Array.isArray(second[1].content[3].input)).toBe(false)
    const [search, loot] = second[2].content
    expect(search).toMatchObject({ type: 'tool_result', tool_use_id: 'tu_1' })
    expect(JSON.parse(search.content).results.some((r: any) => r.id === bag && r.name === 'Bag of Holding')).toBe(true)
    expect(JSON.parse(loot.content)).toEqual({ folders: [], entries: [], truncated: false })
    // chybný návrh se vrátil modelu jako chyba s vysvětlením
    const rejected = log[2].body.messages.at(-1).content[0]
    expect(rejected).toMatchObject({ type: 'tool_result', tool_use_id: 'tu_3', is_error: true })
    expect(rejected.content).toContain('Položka 3')
    expect(rejected.content).toContain('baseRuleId')
    const accepted = log[3].body.messages.at(-1).content[0]
    expect(accepted.is_error).toBeUndefined()
    proposalId = JSON.parse(accepted.content).proposalId

    // UI: zprávy, co AI dělala, karta návrhu; myšlenkové bloky ne
    const types = done.items.map((i: any) => i.type)
    expect(types).toEqual(['user', 'assistant', 'activity', 'activity', 'activity', 'proposal', 'assistant'])
    expect(done.items[0].text).toBe(`[[mock:${key}]] Připrav loot do hrobky`)
    expect(done.items[2].text).toBe('Hledám v pravidlech: „Bag of Holding“')
    const proposal = done.items[5].proposal
    expect(proposal).toMatchObject({ id: proposalId, title: 'Loot: Hrobka', status: 'pending', folders: ['Hrobka / Chodba'] })
    expect(proposal.entries.map((e: any) => e.label)).toEqual(['Bag of Holding', 'Truhla', 'Armor, +1 (Chain Mail)', 'Lano z obchodu'])
    expect(proposal.entries[0]).toMatchObject({ folder: 'Hrobka / Místnost 1', kind: 'wondrous', rarity: 'uncommon', quantity: 1, price: null, curse: false })
    expect(proposal.entries[1]).toMatchObject({ kind: 'gold', coins: '50 gp' })
    expect(proposal.entries[2]).toMatchObject({ kind: 'armor', rarity: 'rare' })
    expect(proposal.entries[3]).toMatchObject({ folder: '', kind: 'other', price: '1 gp, 5 sp' })

    // nic se zatím nevytvořilo
    const lootBefore = await dm.client.get(`/campaigns/${campaignId}/loot`)
    expect(lootBefore.body).toEqual({ folders: [], entries: [] })
  })

  it('konverzaci a návrh nevidí ani nepotvrdí nikdo jiný', async () => {
    const stranger = await registerUser('aidm')
    for (const u of [player, stranger]) {
      expect((await u.client.get(`/ai/conversations/${conversationId}`)).status).toBe(404)
      expect((await u.client.post(`/ai/conversations/${conversationId}/step`)).status).toBe(404)
      expect((await u.client.post(`/ai/conversations/${conversationId}/messages`, { message: 'x' })).status).toBe(404)
      expect((await u.client.delete(`/ai/conversations/${conversationId}`)).status).toBe(404)
      expect((await u.client.post(`/ai/proposals/${proposalId}/apply`)).status).toBe(404)
      expect((await u.client.post(`/ai/proposals/${proposalId}/discard`)).status).toBe(404)
    }
    expect((await new Client().get(`/ai/conversations/${conversationId}`)).status).toBe(401)
    expect((await new Client().post(`/ai/proposals/${proposalId}/apply`)).status).toBe(401)
    expect((await dm.client.get(`/campaigns/${campaignId}/loot`)).body.entries).toEqual([])
  })

  it('DM návrh potvrdí: složky a položky vzniknou v lootu stejně jako ručně', async () => {
    const res = await dm.client.post(`/ai/proposals/${proposalId}/apply`)
    expectStatus(res, 200)
    expect(res.body.proposal.status).toBe('applied')
    const names = (id: string | null) => res.body.folders.filter((f: any) => f.parentId === id).map((f: any) => f.name)
    expect(names(null)).toEqual(['Hrobka'])
    const tomb = res.body.folders.find((f: any) => f.name === 'Hrobka').id
    expect(names(tomb)).toEqual(['Chodba', 'Místnost 1', 'Místnost 2'])
    const byName = new Map(res.body.entries.map((e: any) => [e.data.name, e]))
    expect(res.body.entries).toHaveLength(4)
    expect((byName.get('Truhla') as any).data.currency).toEqual({ gp: 50 })
    expect((byName.get('Armor, +1 (Chain Mail)') as any).data.armor).toMatchObject({ base: 16 })
    expect((byName.get('Lano z obchodu') as any)).toMatchObject({ folderId: null, priceCp: 150 })
    // podruhé to nejde
    expect((await dm.client.post(`/ai/proposals/${proposalId}/apply`)).status).toBe(409)
    expect((await dm.client.post(`/ai/proposals/${proposalId}/discard`)).status).toBe(409)
    expect((await dm.client.get(`/campaigns/${campaignId}/loot`)).body.entries).toHaveLength(4)
  })

  it('v další zprávě se AI dozví, že DM návrh vytvořil', async () => {
    await script(key, [{ content: [text('Super.')] }])
    const res = await dm.client.post(`/ai/conversations/${conversationId}/messages`, { message: 'Hotovo?' })
    expectStatus(res, 200)
    expect(res.body.conversation.state).toBe('idle')
    const last = (await mockLog(key)).at(-1).body.messages.at(-1)
    expect(last.content[0].text).toContain('„Loot: Hrobka“ DM vytvořil v lootu.')
    expect(last.content[1]).toEqual(text('Hotovo?'))
    expect(res.body.conversation.items.at(-2)).toMatchObject({ type: 'user', text: 'Hotovo?' })
    const status = await dm.client.get(`/campaigns/${campaignId}/ai`)
    expect(status.body.conversations[0]).toMatchObject({ id: conversationId, title: `[[mock:${key}]] Připrav loot do hrobky` })
  })

  it('zahozený návrh nic nevytvoří a konverzace jde smazat', async () => {
    const k = uniqueName('discard')
    await script(k, [{ content: [toolUse('tu_d', 'propose_loot', { title: 'Zahodit', entries: [{ folder: ['Smetí'], type: 'gold', coins: { cp: 1 } }] })] }, { content: [text('Ok')] }])
    const created = await dm.client.post(`/campaigns/${campaignId}/ai/conversations`, { message: `[[mock:${k}]] návrh` })
    const done = await runUntilDone(dm, created.body.conversation)
    const proposal = done.items.find((i: any) => i.type === 'proposal').proposal
    const discarded = await dm.client.post(`/ai/proposals/${proposal.id}/discard`)
    expectStatus(discarded, 200)
    expect(discarded.body.proposal.status).toBe('discarded')
    expect((await dm.client.post(`/ai/proposals/${proposal.id}/apply`)).status).toBe(409)
    expect((await dm.client.get(`/campaigns/${campaignId}/loot`)).body.folders.some((f: any) => f.name === 'Smetí')).toBe(false)
    expect((await dm.client.delete(`/ai/conversations/${done.id}`)).status).toBe(204)
    expect((await dm.client.get(`/ai/conversations/${done.id}`)).status).toBe(404)
  })
})

describe('AI pomocník: model vidí jen data kampaně', () => {
  it('homebrew jiné kampaně nenajde ani nepřečte, vlastní ano; družina je jen z kampaně', async () => {
    const dm = await registerUser('aidm')
    const campaignId = await createCampaign(dm, 'Moje')
    const otherDm = await registerUser('aidm')
    const otherCampaign = await createCampaign(otherDm, 'Cizí')
    const foreignName = uniqueName('Cizi prsten ')
    const foreign = (await otherDm.client.post(`/campaigns/${otherCampaign}/homebrew`, { kind: 'magic_item', name: foreignName, description: 'tajné' })).body.entry.id
    const ownName = uniqueName('Muj prsten ')
    const own = (await dm.client.post(`/campaigns/${campaignId}/homebrew`, { kind: 'magic_item', name: ownName, description: 'můj popis' })).body.entry.id
    // DM vede i druhou kampaň: její homebrew do konverzace první kampaně nepatří, i když ho DM jinak vidí
    const secondCampaign = await createCampaign(dm, 'Druhá')
    const secondName = uniqueName('Druhy prsten ')
    const second = (await dm.client.post(`/campaigns/${secondCampaign}/homebrew`, { kind: 'magic_item', name: secondName, description: 'jinde' })).body.entry.id
    await dm.client.post(`/campaigns/${campaignId}/characters`, { name: 'Batan', abilityScores: { str: 14, dex: 10, con: 12, int: 10, wis: 10, cha: 10 }, levels: [{ classIndex: 'fighter' }] })
    await otherDm.client.post(`/campaigns/${otherCampaign}/characters`, { name: 'Cizák', abilityScores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }, levels: [{ classIndex: 'wizard' }] })

    const k = uniqueName('scope')
    await script(k, [
      { content: [toolUse('a', 'search_rules', { query: foreignName }), toolUse('b', 'get_rule', { id: foreign }), toolUse('c', 'search_rules', { query: ownName }), toolUse('d', 'get_rule', { id: own }), toolUse('e', 'get_party', {}), toolUse('f', 'search_rules', { query: secondName }), toolUse('g', 'get_rule', { id: second })] },
      { content: [text('Hotovo')] },
    ])
    const created = await dm.client.post(`/campaigns/${campaignId}/ai/conversations`, { message: `[[mock:${k}]] hledej` })
    await runUntilDone(dm, created.body.conversation)
    const [a, b, c, d, e, f, g] = (await mockLog(k))[1].body.messages.at(-1).content
    expect(JSON.parse(a.content)).toEqual({ total: 0, results: [] })
    expect(b).toMatchObject({ is_error: true })
    expect(b.content).toContain('nenalezen')
    expect(JSON.parse(c.content).results[0]).toMatchObject({ id: own, name: ownName, homebrew: true })
    expect(JSON.parse(d.content)).toMatchObject({ id: own, description: 'můj popis' })
    const party = JSON.parse(e.content)
    expect(party.campaign).toEqual({ name: 'Moje', ruleset: '2014' })
    expect(party.characters.map((ch: any) => ch.name)).toEqual(['Batan'])
    expect(JSON.parse(f.content)).toEqual({ total: 0, results: [] })
    expect(g).toMatchObject({ is_error: true })
    expect(JSON.stringify((await mockLog(k)).map((r) => r.body))).not.toMatch(/tajné|jinde/)
  })
})

describe('AI pomocník: chyby a limity', () => {
  let dm: TestUser
  let campaignId: string

  beforeAll(async () => {
    dm = await registerUser('aidm')
    campaignId = await createCampaign(dm, 'Limity')
  })

  it('výpadek API: zpráva zůstane uložená a krok jde zopakovat', async () => {
    const k = uniqueName('down')
    const overloaded = { status: 529, body: { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } } }
    // první pokus a jedno automatické zopakování selžou
    await script(k, [overloaded, overloaded, { content: [text('Už to jde.')] }])
    const created = await dm.client.post(`/campaigns/${campaignId}/ai/conversations`, { message: `[[mock:${k}]] ahoj` })
    expectStatus(created, 201)
    expect(created.body.error.code).toBe('ai_overloaded')
    expect(created.body.conversation.state).toBe('working')
    const retry = await dm.client.post(`/ai/conversations/${created.body.conversation.id}/step`)
    expectStatus(retry, 200)
    expect(retry.body.conversation).toMatchObject({ state: 'idle' })
    expect(retry.body.conversation.items.at(-1)).toMatchObject({ type: 'assistant', text: 'Už to jde.' })
  })

  it('neplatný požadavek (400) se ukáže jako chyba a nic se neuloží', async () => {
    const k = uniqueName('bad')
    await script(k, [{ status: 400, body: { type: 'error', error: { type: 'invalid_request_error', message: 'messages: bad' } } }])
    const created = await dm.client.post(`/campaigns/${campaignId}/ai/conversations`, { message: `[[mock:${k}]] x` })
    expect(created.body.error).toMatchObject({ code: 'ai_rejected' })
    expect(created.body.error.message).toContain('messages: bad')
    expect(created.body.conversation.items.map((i: any) => i.type)).toEqual(['user'])
  })

  it('odmítnutí: obsah se neuloží a AI se nezkouší znovu, dokud DM nenapíše', async () => {
    const k = uniqueName('refusal')
    await script(k, [{ content: [], stop_reason: 'refusal', stop_details: { type: 'refusal', category: null } }, { content: [text('Jiná odpověď')] }])
    const created = await dm.client.post(`/campaigns/${campaignId}/ai/conversations`, { message: `[[mock:${k}]] x` })
    expect(created.body.conversation).toMatchObject({ state: 'stopped' })
    expect(created.body.conversation.notice).toContain('odmítla')
    const again = await dm.client.post(`/ai/conversations/${created.body.conversation.id}/step`)
    expect(again.body.conversation.state).toBe('stopped')
    expect(await mockLog(k)).toHaveLength(1)
    const next = await dm.client.post(`/ai/conversations/${created.body.conversation.id}/messages`, { message: 'zkus znovu' })
    expect(next.body.conversation).toMatchObject({ state: 'idle', notice: null })
  })

  it('po 16 krocích bez odpovědi se AI zastaví', async () => {
    const k = uniqueName('loop')
    await script(k, Array.from({ length: 20 }, (_, i) => ({ content: [toolUse(`t${i}`, 'get_loot', {})] })))
    const created = await dm.client.post(`/campaigns/${campaignId}/ai/conversations`, { message: `[[mock:${k}]] smyčka` })
    const done = await runUntilDone(dm, created.body.conversation, 30)
    expect(done.state).toBe('stopped')
    expect(done.notice).toContain('moc kroků')
    expect(await mockLog(k)).toHaveLength(16)
  })

  it('neznámý nástroj a nesmyslný vstup vrátí modelu chybu, ne 500', async () => {
    const k = uniqueName('junk')
    await script(k, [
      { content: [toolUse('x1', 'delete_everything', {}), toolUse('x2', 'search_rules', { query: 5 }), toolUse('x3', 'propose_loot', { title: 'x', entries: 'ne' }), toolUse('x4', 'get_rule', { id: 'nic' })] },
      { content: [text('ok')] },
    ])
    const created = await dm.client.post(`/campaigns/${campaignId}/ai/conversations`, { message: `[[mock:${k}]] x` })
    const done = await runUntilDone(dm, created.body.conversation)
    expect(done.state).toBe('idle')
    const results = (await mockLog(k))[1].body.messages.at(-1).content
    expect(results.map((r: any) => r.is_error)).toEqual([true, true, true, true])
  })

  it('diagnostika serveru ukáže spojení s Claude API', async () => {
    const res = await new Client().request('POST', '/admin/diagnostics', {}, { 'X-Migrate-Key': 'test-migrate' })
    expectStatus(res, 200)
    expect(res.body).toMatchObject({ curl: true, claude: { configured: true, reachable: true, status: 200, error: null, model: 'claude-opus-5-5' } })
  })

  // Musí být poslední v souboru: vyčerpá měsíční rozpočet testovací DB (5 USD).
  it('útrata se počítá z tokenů a po vyčerpání měsíčního rozpočtu AI neodpoví', async () => {
    const k = uniqueName('budget')
    // 300 000 výstupních tokenů Opus 5.5 = 6 USD
    await script(k, [{ content: [text('drahé')], usage: { input_tokens: 10, output_tokens: 300_000, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } }])
    const before = (await dm.client.get(`/campaigns/${campaignId}/ai`)).body.spentUsd
    const created = await dm.client.post(`/campaigns/${campaignId}/ai/conversations`, { message: `[[mock:${k}]] x` })
    expect(created.body.conversation.state).toBe('idle')
    const status = await dm.client.get(`/campaigns/${campaignId}/ai`)
    expect(status.body.spentUsd).toBeCloseTo(before + 6, 1)
    const blocked = await dm.client.post(`/ai/conversations/${created.body.conversation.id}/messages`, { message: 'další' })
    expect(blocked.status).toBe(429)
    expect(blocked.body.error.code).toBe('ai_budget')
  })
})
