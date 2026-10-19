import { readFileSync } from 'node:fs'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { Client, createCampaign, makePng, registerUser, type TestUser } from './client'

/**
 * Audit celé tabulky tras z api/src/App.php: žádná chráněná trasa nesmí být dostupná bez přihlášení,
 * cizinec (přihlášený, ale mimo kampaň) nesmí dostat nic z cizí kampaně (404) a žádná trasa nesmí spadnout na 500,
 * ani když dostane nesmyslné vstupy. Nová trasa se do auditu dostane sama, jakmile se přidá do App.php.
 */
const source = readFileSync(path.resolve(import.meta.dirname, '../api/src/App.php'), 'utf8')
const routes = [...source.matchAll(/\$r->add\('(GET|POST|PATCH|DELETE)', '([^']+)', [^;]*?(auth: false)?\);/g)].map((m) => ({ method: m[1]!, pattern: m[2]!, pub: m[3] !== undefined }))
const PUBLIC = routes.filter((r) => r.pub)
const PROTECTED = routes.filter((r) => !r.pub)

const UUID = '00000000-0000-4000-8000-000000000000'
const fill = (pattern: string, ids: Record<string, string> = {}) => pattern.replace(/\{(\w+)\}/g, (_, name: string) => ids[name] ?? UUID)

// Testy procházejí celou tabulku tras po jedné; pod zátěží (jednovláknový php -S a paralelní soubory) potřebují delší limit.
describe('audit tras API', () => {
  let owner: TestUser
  let outsider: TestUser
  let ids: { campaign: string; character: string; map: string; pin: string; note: string; entry: string; tactic: string; enemy: string; folder: string; lootEntry: string; conversation: string }

  beforeAll(async () => {
    // „aidm“ na začátku jména: majitel smí AI pomocníka (claude_users v api/config.test.php), takže audit projde i jeho trasy se skutečnou konverzací
    owner = await registerUser('aidmaudit')
    outsider = await registerUser('auditcizi')
    const campaign = await createCampaign(owner, 'Audit')
    const character = (await owner.client.post(`/campaigns/${campaign}/characters`, { name: 'Audit', abilityScores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }, levels: [{ classIndex: 'fighter' }] })).body.character.id
    const map = (await owner.client.upload(`/campaigns/${campaign}/maps`, 'image', makePng(100, 100), 'm.png', 'image/png', { name: 'Mapa' })).body.map.id
    await owner.client.patch(`/maps/${map}`, { visible: true })
    const pin = (await owner.client.post(`/maps/${map}/pins`, { x: 1, y: 1, title: 'Bod' })).body.pin.id
    const note = (await owner.client.post(`/campaigns/${campaign}/dm-notes`, { body: 'tajné' })).body.note.id
    const entry = (await owner.client.post(`/campaigns/${campaign}/journal`, { title: 'Zápis' })).body.entry.id
    const tactic = (await owner.client.post(`/characters/${character}/tactics`, { kind: 'rule', title: 'Poučka', text: 'x' })).body.tactic.id
    const enemy = (await owner.client.post(`/campaigns/${campaign}/enemies`, { name: 'Goblin', hpMax: 7 })).body.enemy.id
    const folder = (await owner.client.post(`/campaigns/${campaign}/loot/folders`, { name: 'Dungeon' })).body.folder.id
    const lootEntry = (await owner.client.post(`/campaigns/${campaign}/loot/entries`, { folderId: folder, kind: 'gold', currency: { gp: 1 } })).body.entry.id
    // Konverzace vznikne i bez odpovědi AI (napodobený server odpoví výchozím textem; když je rozpočet testů vyčerpaný, vrátí chybu, ale id ano).
    const conversation = (await owner.client.post(`/campaigns/${campaign}/ai/conversations`, { message: 'Audit' })).body.conversation.id
    ids = { campaign, character, map, pin, note, entry, tactic, enemy, folder, lootEntry, conversation }
  })

  it('tabulka tras se načetla (a obsahuje všechny moduly)', () => {
    expect(routes.length).toBeGreaterThan(60)
    for (const p of ['/campaigns/{id}/messages', '/campaigns/{id}/rolls', '/campaigns/{id}/maps', '/characters/{id}/adjust', '/campaigns/{id}/dm/hp', '/pins/{id}', '/campaigns/{id}/journal', '/journal/{id}', '/characters/{id}/tactics', '/tactics/{id}', '/campaigns/{id}/enemies', '/enemies/{id}', '/campaigns/{id}/initiative', '/enemies/{id}/initiative', '/campaigns/{id}/loot', '/loot/folders/{id}', '/loot/entries/{id}', '/campaigns/{id}/ai', '/ai/conversations/{id}', '/ai/proposals/{id}/apply']) {
      expect(routes.some((r) => r.pattern === p), p).toBe(true)
    }
    expect(PUBLIC.map((r) => r.pattern).sort()).toEqual(['/admin/diagnostics', '/admin/migrate', '/admin/seed', '/auth/login', '/auth/logout', '/auth/me', '/auth/register', '/health'])
  })

  it('každá chráněná trasa bez přihlášení vrátí 401', async () => {
    const anon = new Client()
    const failures: string[] = []
    for (const r of PROTECTED) {
      const res = await anon.request(r.method, fill(r.pattern), r.method === 'GET' || r.method === 'DELETE' ? undefined : {})
      if (res.status !== 401) failures.push(`${r.method} ${r.pattern} -> ${res.status}`)
    }
    expect(failures).toEqual([])
  }, 60_000)

  it('veřejné administrátorské trasy bez klíče nic neprovedou', async () => {
    const anon = new Client()
    for (const p of ['/admin/migrate', '/admin/seed', '/admin/diagnostics']) {
      const res = await anon.post(p, {})
      expect([401, 403, 404], p).toContain(res.status)
    }
  })

  it('cizinec dostane u cizí kampaně a jejích věcí 404 (nikdy 2xx), na žádné trase 5xx', async () => {
    const real: Record<string, string> = { campaign: ids.campaign, character: ids.character, map: ids.map, pin: ids.pin, note: ids.note, entry: ids.entry, tactic: ids.tactic, enemy: ids.enemy, folder: ids.folder, lootEntry: ids.lootEntry, conversation: ids.conversation }
    const failures: string[] = []
    for (const r of PROTECTED) {
      if (!r.pattern.includes('{')) continue
      // které id patří do které trasy
      const kind = r.pattern.startsWith('/campaigns/') ? 'campaign' : r.pattern.startsWith('/characters/') ? 'character' : r.pattern.startsWith('/maps/') ? 'map' : r.pattern.startsWith('/pins/') ? 'pin' : r.pattern.startsWith('/dm-notes/') ? 'note' : r.pattern.startsWith('/journal/') ? 'entry' : r.pattern.startsWith('/tactics/') ? 'tactic' : r.pattern.startsWith('/enemies/') ? 'enemy' : r.pattern.startsWith('/loot/folders/') ? 'folder' : r.pattern.startsWith('/loot/entries/') ? 'lootEntry' : r.pattern.startsWith('/ai/conversations/') ? 'conversation' : null
      if (kind === null) continue
      const url = fill(r.pattern, { id: real[kind]! })
      const res = await outsider.client.request(r.method, url, r.method === 'GET' || r.method === 'DELETE' ? undefined : {})
      if (res.status !== 404) failures.push(`${r.method} ${url} -> ${res.status}`)
    }
    expect(failures).toEqual([])
  }, 60_000)

  it('žádná trasa nespadne na 500, ani když dostane neexistující id nebo prázdné či nesmyslné tělo', async () => {
    const failures: string[] = []
    const bodies: unknown[] = [{}, { x: 'a', body: 5, to: [1], expression: [], name: null }]
    for (const r of PROTECTED) {
      for (const user of [owner, outsider]) {
        for (const body of r.method === 'GET' || r.method === 'DELETE' ? [undefined] : bodies) {
          // /admin a odhlášení nemažeme, nic z toho nesmí padat, ale ničí jen vlastní relaci
          if (r.pattern === '/auth/logout') continue
          const res = await user.client.request(r.method, fill(r.pattern), body)
          if (res.status >= 500) failures.push(`${user.username.slice(0, 8)} ${r.method} ${r.pattern} ${JSON.stringify(body)} -> ${res.status}`)
        }
      }
    }
    expect(failures).toEqual([])
  }, 60_000)
})
