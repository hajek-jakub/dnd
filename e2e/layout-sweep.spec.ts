import type { Page } from '@playwright/test'
import { makePng } from '../test-utils/png'
import { expect, test } from './fixtures'
import { registerDm } from './helpers'

// Průchod všemi hlavními stránkami na počítači i na telefonu: nic nejezdí do stran a dotykové prvky jsou aspoň 44 px.

async function problems(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = []
    const overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth
    if (overflow > 0) out.push(`stránka jezdí do stran o ${overflow} px`)
    // Obsah nesmí přetékat z karty (i když stránka jako celek nejezdí do stran).
    for (const el of document.querySelectorAll<HTMLElement>('main [data-slot="card"] *, main li *')) {
      if (el.closest('.leaflet-container')) continue
      const rect = el.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) continue
      const box = el.closest<HTMLElement>('[data-slot="card"], li')?.getBoundingClientRect()
      if (!box || el.matches('[data-slot="card"], li')) continue
      // prvky uvnitř posuvného kontejneru (řádek záložek apod.) přetékat smějí
      let scrolled = false
      for (let p: HTMLElement | null = el.parentElement; p && !p.matches('[data-slot="card"], li'); p = p.parentElement) {
        const o = getComputedStyle(p).overflowX
        if (o === 'auto' || o === 'scroll' || o === 'hidden') scrolled = true
      }
      if (scrolled) continue
      if (rect.right > box.right + 1 || rect.left < box.left - 1) {
        out.push(`přetéká z karty: ${el.tagName} "${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 30)}" o ${Math.round(Math.max(rect.right - box.right, box.left - rect.left))} px`)
      }
    }
    for (const el of document.querySelectorAll<HTMLElement>('main button, main input, main select, main textarea, main summary')) {
      if (el.closest('.leaflet-container')) continue
      const target = el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio') ? (el.closest('label') ?? el) : el
      const rect = target.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) continue
      if (rect.width <= 2 && rect.height <= 2) continue // vizuálně skrytý prvek (např. vstup souboru za tlačítkem)
      if (rect.height < 43.5) out.push(`${el.tagName} "${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 30)}" ${Math.round(rect.height)} px`)
    }
    return out
  })
}

test('všechny hlavní stránky: bez horizontálního scrollu a s dost velkými dotykovými prvky', async ({ page }) => {
  test.setTimeout(180_000)
  await registerDm(page, 'sweep')
  await page.getByLabel('Název kampaně').fill('Sweep')
  await page.getByRole('button', { name: 'Založit kampaň' }).click()
  await expect(page).toHaveURL(/\/campaigns\//)
  const campaignId = page.url().split('/campaigns/')[1]!

  const character = (await (await page.request.post(`/api/campaigns/${campaignId}/characters`, {
    data: {
      name: 'Sweep',
      race: 'Human',
      abilityScores: { str: 10, dex: 16, con: 14, int: 8, wis: 15, cha: 14 },
      levels: [...Array(5).fill({ classIndex: 'monk', hpRoll: null }), { classIndex: 'warlock', hpRoll: null }],
      subclasses: { monk: 'open-hand', warlock: 'fiend' },
      skillProficiencies: { acrobatics: 1, stealth: 2 },
    },
  })).json()).character.id as string
  const weapon = await page.request.post(`/api/characters/${character}/items`, {
    data: { name: 'Dlouhé jméno magického meče, který se musí zalomit', kind: 'weapon', quantity: 3, weapon: { damageDice: '1d8', damageType: 'Slashing', magicBonus: 1, extraDamage: [{ dice: '1d4', type: 'Fire' }] } },
  })
  await page.request.patch(`/api/characters/${character}/items/${(await weapon.json()).item.id}`, { data: { equipped: true } })
  const spell = (await (await page.request.get('/api/rules?kinds=spell&q=expeditious')).json()).entries[0]
  await page.request.post(`/api/characters/${character}/spells`, { data: { ruleId: spell.id, classIdx: 'warlock' } })
  for (const t of [
    { kind: 'attack', title: 'Dlouhý název útoku, který se musí na telefonu zalomit', toHit: 'd20+8', damage: '1d8+5 + 1d4 fire', cost: 'ki:1', usage: 'Použij vždy, když je protivník v dosahu. '.repeat(3) },
    { kind: 'spell', title: 'Hex', level: 1, actionType: 'bonus', concentration: true, cost: 'slot:1', effect: 'Dlouhý efekt. '.repeat(30), roll: '1d10' },
    { kind: 'combo', title: 'Maximální burst', steps: ['Krok jedna', 'Krok dva'], highlight: true, expectedDamage: '~50 dmg', cost: 'ki:2' },
    { kind: 'rule', title: 'Pravidlo', text: 'Text pravidla. '.repeat(20) },
  ]) {
    await page.request.post(`/api/characters/${character}/tactics`, { data: t })
  }
  await page.request.post(`/api/campaigns/${campaignId}/messages`, { data: { to: 'all', body: 'x'.repeat(300) } })
  await page.request.post(`/api/campaigns/${campaignId}/journal`, { data: { topic: 'Příběh', title: 'Zápis s dlouhým názvem '.repeat(4), body: 'Text '.repeat(200), pinned: true } })
  await page.request.post(`/api/campaigns/${campaignId}/dm-notes`, { data: { body: 'Poznámka\n'.repeat(5) } })
  await page.request.post(`/api/campaigns/${campaignId}/dm/xp`, { data: { characterIds: [character], amount: 10, split: false } })
  const map = (await (await page.request.post(`/api/campaigns/${campaignId}/maps`, { multipart: { name: 'Mapa s hodně dlouhým názvem, aby se zalomil', image: { name: 'm.png', mimeType: 'image/png', buffer: Buffer.from(makePng(600, 400)) } } })).json()).map.id as string
  await page.request.post(`/api/maps/${map}/pins`, { data: { x: 50, y: 50, title: 'Bod s dlouhým názvem '.repeat(3), description: 'Popis '.repeat(60) } })

  await page.request.post(`/api/campaigns/${campaignId}/characters`, {
    data: { name: 'NPC s hodně dlouhým jménem, aby se zalomilo', kind: 'npc', abilityScores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }, levels: [{ classIndex: 'fighter', hpRoll: null }] },
  })
  await page.request.post(`/api/campaigns/${campaignId}/enemies`, {
    data: { name: 'Goblin s hodně dlouhým jménem, aby se zalomilo', hpMax: 7, ac: 15, notes: 'Poznámka '.repeat(40), attacks: [{ name: 'Scimitar s dlouhým názvem', toHit: 4, damage: '1d6+2' }, { name: 'Luk', toHit: 4, damage: '1d6+2' }] },
  })

  const pages: [string, string][] = [
    ['domů', '/'],
    ['kampaně', '/campaigns'],
    ['kampaň', `/campaigns/${campaignId}`],
    ['panel DM', `/campaigns/${campaignId}/dm`],
    ['nepřátelé', `/campaigns/${campaignId}/enemies`],
    ['deník', `/campaigns/${campaignId}/journal`],
    ['zprávy', `/campaigns/${campaignId}/messages?t=group`],
    ['mapy', `/campaigns/${campaignId}/maps`],
    ['mapa', `/campaigns/${campaignId}/maps/${map}`],
    ['oznámení', '/notifications'],
    ['profil', '/profile'],
    ['pravidla: kouzla', '/rules'],
    ['pravidla: magické itemy', '/rules?g=items'],
    ['nová postava', `/campaigns/${campaignId}/characters/new`],
    ['level up', `/characters/${character}/levelup`],
  ]
  const failures: string[] = []
  for (const [name, url] of pages) {
    await page.goto(url)
    await page.waitForLoadState('networkidle')
    for (const p of await problems(page)) failures.push(`${name}: ${p}`)
  }

  await page.goto(`/characters/${character}`)
  await page.waitForLoadState('networkidle')
  for (const tab of ['Přehled', 'Kouzla', 'Inventář', 'Taktiky', 'Featury', 'Postava']) {
    await page.getByRole('button', { name: tab, exact: true }).click()
    for (const p of await problems(page)) failures.push(`sheet ${tab}: ${p}`)
    if (tab === 'Taktiky') {
      await page.getByRole('button', { name: 'Upravit taktiky' }).click()
      for (const p of await problems(page)) failures.push(`sheet Taktiky (úpravy): ${p}`)
      await page.getByRole('button', { name: 'Upravit taktiky' }).click()
    }
  }

  // dialogy: panel kostek
  await page.getByRole('button', { name: 'Kostky', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Kostky' })).toBeVisible()
  const dialogOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  if (dialogOverflow > 0) failures.push(`panel kostek: jezdí do stran o ${dialogOverflow} px`)

  expect(failures).toEqual([])
})
