import AxeBuilder from '@axe-core/playwright'
import type { Page } from '@playwright/test'
import { makePng } from '../test-utils/png'
import { expect, test } from './fixtures'
import { registerDm } from './helpers'

// Přístupnost (axe, WCAG 2.1 A a AA) na všech hlavních stránkách, ve světlém i tmavém režimu, na počítači i na telefonu.

async function audit(page: Page, name: string) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    // Leaflet kreslí vlastní ovládací prvky mapy (odkazy bez popisku apod.); mapu hlídá samostatný test níže.
    .exclude('.leaflet-container')
    .analyze()
  const summary = results.violations.map((v) => `${v.id} (${v.impact}): ${v.help} → ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`)
  expect(summary, `Přístupnost: ${name}`).toEqual([])
}

async function setTheme(page: Page, theme: 'light' | 'dark') {
  // Přechody barev by axe změřil v půli animace, proto se pro měření vypnou.
  await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; animation: none !important; }' })
  await page.evaluate((t) => {
    document.documentElement.classList.toggle('dark', t === 'dark')
  }, theme)
}

test('přihlášení, registrace a O aplikaci jsou přístupné (světlý i tmavý režim)', async ({ page }) => {
  for (const url of ['/login', '/register', '/about']) {
    await page.goto(url)
    await expect(page.locator('h1, h2').first()).toBeVisible()
    for (const theme of ['light', 'dark'] as const) {
      await setTheme(page, theme)
      await audit(page, `${url} (${theme})`)
    }
  }
})

test('stránky po přihlášení jsou přístupné (světlý i tmavý režim)', async ({ page }) => {
  test.setTimeout(180_000)
  await registerDm(page, 'a11y')
  await page.getByLabel('Název kampaně').fill('Přístupnost')
  await page.getByRole('button', { name: 'Založit kampaň' }).click()
  await expect(page).toHaveURL(/\/campaigns\//)
  const campaignId = page.url().split('/campaigns/')[1]!

  const character = (await (await page.request.post(`/api/campaigns/${campaignId}/characters`, {
    data: { name: 'Axe', abilityScores: { str: 10, dex: 14, con: 12, int: 10, wis: 13, cha: 8 }, levels: [{ classIndex: 'monk', hpRoll: null }, { classIndex: 'warlock', hpRoll: null }], skillProficiencies: { acrobatics: 1 } },
  })).json()).character.id as string
  const item = await page.request.post(`/api/characters/${character}/items`, { data: { name: 'Meč', kind: 'weapon', weapon: { damageDice: '1d8', damageType: 'Slashing', extraDamage: [{ dice: '1d4', type: 'Fire' }] } } })
  await page.request.patch(`/api/characters/${character}/items/${(await item.json()).item.id}`, { data: { equipped: true } })
  for (const t of [
    { kind: 'attack', title: 'Dlouhý název útoku, který se musí na telefonu zalomit', toHit: 'd20+8', damage: '1d8+5 + 1d4 fire', cost: 'ki:1', usage: 'Použij vždy, když je protivník v dosahu. '.repeat(3) },
    { kind: 'spell', title: 'Hex', level: 1, actionType: 'bonus', concentration: true, cost: 'slot:1', effect: 'Dlouhý efekt. '.repeat(30), roll: '1d10' },
    { kind: 'combo', title: 'Maximální burst', steps: ['Krok jedna', 'Krok dva'], highlight: true, expectedDamage: '~50 dmg', cost: 'ki:2' },
    { kind: 'rule', title: 'Pravidlo', text: 'Text pravidla. '.repeat(20) },
  ]) {
    await page.request.post(`/api/characters/${character}/tactics`, { data: t })
  }
  await page.request.post(`/api/campaigns/${campaignId}/messages`, { data: { to: 'all', body: 'Ahoj' } })
  await page.request.post(`/api/campaigns/${campaignId}/journal`, { data: { topic: 'Příběh', title: 'Zápis', body: '# Nadpis\n- odrážka\n**tučně**', pinned: true } })
  const map = (await (await page.request.post(`/api/campaigns/${campaignId}/maps`, { multipart: { name: 'Mapa', image: { name: 'm.png', mimeType: 'image/png', buffer: Buffer.from(makePng(300, 200)) } } })).json()).map.id as string
  await page.request.post(`/api/maps/${map}/pins`, { data: { x: 50, y: 50, title: 'Bod', description: 'Popis' } })

  await page.request.post(`/api/campaigns/${campaignId}/enemies`, { data: { name: 'Goblin', hpMax: 7, ac: 15, attacks: [{ name: 'Scimitar', toHit: 4, damage: '1d6+2' }] } })
  await page.request.post(`/api/campaigns/${campaignId}/characters`, { data: { name: 'Batan', kind: 'npc', abilityScores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }, levels: [{ classIndex: 'fighter', hpRoll: null }] } })

  const lootFolder = (await (await page.request.post(`/api/campaigns/${campaignId}/loot/folders`, { data: { name: 'Dungeon s hodně dlouhým názvem, aby se zalomil' } })).json()).folder.id as string
  await page.request.post(`/api/campaigns/${campaignId}/loot/folders`, { data: { name: 'Místnost 1', parentId: lootFolder } })
  await page.request.post(`/api/campaigns/${campaignId}/loot/entries`, {
    data: { kind: 'item', item: { name: 'Démonické kopí s hodně dlouhým názvem, aby se zalomilo', kind: 'weapon', description: '**Ďábelský šepot**: slyší tě.', curse: 'Kletba', weapon: { damageDice: '1d8', damageType: 'Piercing', category: 'martial', range: 'melee' } } },
  })
  await page.request.post(`/api/campaigns/${campaignId}/loot/entries`, { data: { kind: 'gold', name: 'Truhla', currency: { gp: 100, sp: 5 } } })
  // nepřítel v přípravě s lootem, poslaný do boje; jeden padne, ať je vidět i karta s lootem k rozdání
  const lootEnemy = (await (await page.request.post(`/api/campaigns/${campaignId}/loot/entries`, {
    data: { kind: 'enemy', enemy: { name: 'Náčelník goblinů s hodně dlouhým jménem', hpMax: 7, ac: 15, initiative: 2, count: 2, cr: '1/4', xp: 50, notes: '**Nimble Escape.** Disengage nebo Hide jako bonusová akce.', attacks: [{ name: 'Scimitar', toHit: 4, damage: '1d6+2' }] } },
  })).json()).entry.id as string
  await page.request.post(`/api/campaigns/${campaignId}/loot/entries`, { data: { kind: 'gold', name: 'Měšec náčelníka s dlouhým názvem', currency: { sp: 12 }, dropFrom: lootEnemy } })
  await page.request.post(`/api/campaigns/${campaignId}/loot/deploy`, { data: { entryIds: [lootEnemy] } })
  const fallen = (await (await page.request.get(`/api/campaigns/${campaignId}/enemies`)).json()).enemies.find((e: { sourceEntryId: string | null }) => e.sourceEntryId === lootEnemy)
  await page.request.post(`/api/enemies/${fallen.id}/hp`, { data: { delta: -7 } })

  const pages: [string, string, (p: Page) => Promise<void>][] = [
    ['kampaně', '/campaigns', async (p) => void (await expect(p.getByRole('heading', { name: 'Moje kampaně' })).toBeVisible())],
    ['kampaň (DM)', `/campaigns/${campaignId}`, async (p) => void (await expect(p.getByRole('heading', { name: 'Přístupnost', level: 1 })).toBeVisible())],
    ['panel DM', `/campaigns/${campaignId}/dm`, async (p) => void (await expect(p.getByRole('heading', { name: 'Panel DM' })).toBeVisible())],
    [
      'loot a itemy',
      `/campaigns/${campaignId}/dm/loot`,
      async (p) => {
        await expect(p.getByRole('heading', { name: 'Loot a itemy', level: 1 })).toBeVisible()
        await p.getByLabel('Vybrat Truhla').check()
        await p.getByRole('button', { name: /^Dát vybrané: Batan/ }).click() // ukáže i seznam „Připraveno k rozdání“
        await p.getByRole('button', { name: /^Podrobnosti: Démonické kopí/ }).click()
      },
    ],
    ['deník', `/campaigns/${campaignId}/journal`, async (p) => void (await expect(p.getByRole('heading', { name: 'Deník', level: 1 })).toBeVisible())],
    ['zprávy', `/campaigns/${campaignId}/messages`, async (p) => void (await expect(p.getByRole('heading', { name: 'Zprávy', level: 1 })).toBeVisible())],
    ['mapy', `/campaigns/${campaignId}/maps`, async (p) => void (await expect(p.getByRole('heading', { name: 'Mapy', level: 1 })).toBeVisible())],
    ['oznámení', '/notifications', async (p) => void (await expect(p.getByRole('heading', { name: 'Oznámení' })).toBeVisible())],
    ['profil', '/profile', async (p) => void (await expect(p.getByRole('heading', { name: 'Profil a nastavení účtu', level: 1 })).toBeAttached())],
    ['pravidla', '/rules', async (p) => void (await expect(p.getByRole('heading', { name: 'Pravidla a obsah' })).toBeVisible())],
    ['nová postava', `/campaigns/${campaignId}/characters/new`, async (p) => void (await expect(p.locator('h1').first()).toBeVisible())],
    ['sheet: přehled', `/characters/${character}`, async (p) => void (await expect(p.getByRole('heading', { name: 'Axe', level: 1 })).toBeVisible())],
  ]
  for (const [name, url, ready] of pages) {
    await page.goto(url)
    await ready(page)
    for (const theme of ['light', 'dark'] as const) {
      await setTheme(page, theme)
      await audit(page, `${name} (${theme})`)
    }
  }

  // záložky sheetu
  await page.goto(`/characters/${character}`)
  for (const tab of ['Kouzla', 'Inventář', 'Taktiky', 'Featury', 'Postava']) {
    await page.getByRole('button', { name: tab, exact: true }).click()
    for (const theme of ['light', 'dark'] as const) {
      await setTheme(page, theme)
      await audit(page, `sheet: ${tab} (${theme})`)
    }
  }

  // dialogy: panel kostek
  await page.getByRole('button', { name: 'Kostky', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Kostky' })).toBeVisible()
  await audit(page, 'panel kostek')
  await page.keyboard.press('Escape')

  // okno s hodem kostkou (rolling i výsledek, výhoda se dvěma hody), světlý i tmavý režim
  await page.getByRole('button', { name: 'Přehled', exact: true }).click()
  await page.getByRole('button', { name: 'Výhoda', exact: true }).click()
  await page.getByRole('button', { name: /^Hodit: Akrobacie/ }).click()
  await expect(page.getByRole('dialog', { name: 'Hod kostkou' }).getByTestId('roll-result-total')).toBeVisible()
  for (const theme of ['light', 'dark'] as const) {
    await setTheme(page, theme)
    await audit(page, `okno s hodem (${theme})`)
  }
})

test('mapa: stránka s mapou je přístupná mimo vnitřní ovládání Leafletu', async ({ page }) => {
  await registerDm(page, 'a11ymap')
  await page.getByLabel('Název kampaně').fill('Mapa a11y')
  await page.getByRole('button', { name: 'Založit kampaň' }).click()
  await expect(page).toHaveURL(/\/campaigns\//)
  const campaignId = page.url().split('/campaigns/')[1]!
  const map = (await (await page.request.post(`/api/campaigns/${campaignId}/maps`, { multipart: { name: 'Mapa', image: { name: 'm.png', mimeType: 'image/png', buffer: Buffer.from(makePng(300, 200)) } } })).json()).map.id as string
  await page.request.post(`/api/maps/${map}/pins`, { data: { x: 50, y: 50, title: 'Bod' } })
  await page.goto(`/campaigns/${campaignId}/maps/${map}`)
  await expect(page.locator('.leaflet-image-layer')).toBeVisible()
  await audit(page, 'mapa')
})
