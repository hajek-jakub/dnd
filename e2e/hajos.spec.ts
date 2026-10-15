import { spawnSync } from 'node:child_process'
import path from 'node:path'
import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { registerDm } from './helpers'

// Seed postavy Hajoš (seed/hajos.json) a to, co z něj uživatel v UI uvidí. Běží v obou projektech (počítač i telefon).

const root = path.resolve(import.meta.dirname, '..')

function seedHajos(username: string): void {
  const res = spawnSync('php', ['api/bin/seed-hajos.php'], {
    cwd: root,
    encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '', DND_CONFIG: path.join(root, 'api/config.test.php'), SEED_OWNER_USERNAME: username },
  })
  expect(res.status, res.stderr + res.stdout).toBe(0)
}

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow, 'stránka nesmí jezdit do stran').toBeLessThanOrEqual(0)
}

test('Hajoš ze seedu: propočítané hodnoty, "nedoplněno", "ke ověření" a Demonic Spear v útocích', async ({ page }) => {
  const username = await registerDm(page, 'hajos')
  seedHajos(username)

  await page.goto('/campaigns')
  await page.getByRole('link', { name: /Testovací kampaň \(seed\)/ }).click()
  await page.getByRole('region', { name: 'Moje postava' }).getByRole('link', { name: /Hajoš/ }).click()
  await expect(page.getByRole('heading', { name: 'Hajoš', level: 1 })).toBeVisible()
  await expect(page.getByText('Human · Monk 5 / Warlock 1')).toBeVisible()
  await expectNoHorizontalScroll(page)

  // engine z uložených vstupů: stejná čísla jako na papíře
  await expect(page.getByRole('button', { name: /^Armor Class: 16/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Rychlost: 40 ft/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Proficiency bonus: \+3/ })).toBeVisible()
  await expect(page.getByRole('status', { name: 'Životy: 39 z 39' })).toBeVisible()

  // XP, background a alignment jsou prázdné, UI říká "nedoplněno"
  await expect(page.getByText('XP nedoplněno')).toBeVisible()
  await expect(page.getByTestId('missing-info')).toContainText('background, alignment, XP')
  // co čeká na potvrzení, je vypsané
  await expect(page.getByText(/Ke ověření \(\d+\)/)).toBeVisible()
  await expect(page.getByText(/na sheetu „Cross“, předpokládám Light Crossbow/).first()).toBeVisible()

  // útok Demonic Spear: +8 k útoku, kostka 1d8 a doplňkové zranění 1d4 fire
  const spear = page.getByRole('listitem').filter({ hasText: 'Demonic Spear' }).filter({ hasText: 'k20' })
  await expect(spear).toContainText('1d8')
  await expect(spear).toContainText('+ 1d4 fire')
  await expect(spear.getByRole('button', { name: /bonus k útoku: \+8/ })).toBeVisible()
  await expect(spear.getByRole('button', { name: /bonus ke zranění: \+5/ })).toBeVisible()

  // v inventáři má item s TO_CONFIRM štítek "ke ověření"
  await page.getByRole('button', { name: 'Inventář', exact: true }).click()
  const crossbow = page.getByRole('listitem').filter({ hasText: 'Crossbow, light' }).filter({ has: page.getByText('Podrobnosti') }).first()
  await crossbow.getByText('Podrobnosti').click()
  await expect(crossbow.getByTestId('unconfirmed').first()).toContainText('ke ověření')
  await expectNoHorizontalScroll(page)

  // nedoplněné údaje jde doplnit a upozornění zmizí
  await page.getByRole('button', { name: 'Postava', exact: true }).click()
  await page.getByLabel('Background').fill('Acolyte')
  await expect(page.getByLabel('Background')).toHaveValue('Acolyte')
})

test('homebrew zbraň: DM ji vytvoří ve formuláři a přidá postavě do inventáře s +1 a 1d4 fire', async ({ page }) => {
  await registerDm(page, 'hbweapon')
  await page.getByLabel('Název kampaně').fill('Zbraně')
  await page.getByRole('button', { name: 'Založit kampaň' }).click()
  await expect(page).toHaveURL(/\/campaigns\//)
  const campaignId = page.url().split('/campaigns/')[1]!

  await page.goto(`/rules?g=gear&campaign=${campaignId}`)
  await page.getByRole('link', { name: 'Nová zbraň' }).click()
  const form = page.getByRole('region', { name: 'Detail' })
  await form.getByLabel('Název', { exact: true }).fill('Plamenné kopí')
  await form.getByLabel('Kostka zranění').fill('1d6')
  await form.getByLabel('Typ zranění').fill('Piercing')
  await form.getByLabel('Vlastnosti (oddělené čárkou)').fill('Thrown, Versatile')
  await form.getByLabel('Kostka oběma rukama (Versatile)').fill('1d8')
  await form.getByLabel(/^Magický bonus/).fill('1')
  await form.getByLabel(/^Doplňková zranění/).fill('1d4 fire')
  await form.getByRole('button', { name: 'Uložit' }).click()

  const detail = page.getByRole('article')
  await expect(detail.getByRole('heading', { name: 'Plamenné kopí' })).toBeVisible()
  await expect(detail.getByText('1d6 Piercing')).toBeVisible()
  await expect(detail.getByText('Thrown, Versatile')).toBeVisible()

  // do inventáře postavy přes API (stejný krok jako tlačítko "Přidat" v inventáři) a ověření útoku na sheetu
  const rule = (await (await page.request.get(`/api/rules?kinds=weapon&campaignId=${campaignId}&scope=homebrew`)).json()).entries[0]
  const char = (await (await page.request.post(`/api/campaigns/${campaignId}/characters`, {
    data: { name: 'Šermíř', abilityScores: { str: 10, dex: 14, con: 12, int: 10, wis: 10, cha: 10 }, levels: [{ classIndex: 'fighter', hpRoll: null }] },
  })).json()).character.id
  const added = await page.request.post(`/api/characters/${char}/items`, { data: { ruleId: rule.id } })
  expect(added.status()).toBe(201)
  const itemId = (await added.json()).item.id
  await page.request.patch(`/api/characters/${char}/items/${itemId}`, { data: { equipped: true } })

  await page.goto(`/characters/${char}`)
  const attack = page.getByRole('listitem').filter({ hasText: 'Plamenné kopí' }).filter({ hasText: 'k20' })
  await expect(attack).toContainText('+ 1d4 fire')
  await expect(attack.getByRole('button', { name: /bonus k útoku: \+3/ })).toBeVisible() // STR 0 / DEX 2 + proficiency 2 + magie 1
  await expectNoHorizontalScroll(page)
})

test('DM přepne pravidla kampaně na 2024: sheet počítá martial arts d8 a Focus Points, prohlížeč pravidel upozorní', async ({ page }) => {
  const username = await registerDm(page, 'ruleset')
  seedHajos(username)

  await page.goto('/campaigns')
  await page.getByRole('link', { name: /Testovací kampaň \(seed\)/ }).click()
  const campaignId = page.url().split('/campaigns/')[1]!
  await expect(page.getByTestId('ruleset-badge')).toHaveText('Pravidla 2014')

  // 2014: martial arts d6, ki
  await page.getByRole('region', { name: 'Moje postava' }).getByRole('link', { name: /Hajoš/ }).click()
  await expect(page.getByText(/Martial Arts 1d6/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Ki: použít' })).toBeVisible()
  const nunchaku = page.getByRole('listitem').filter({ hasText: 'Nunchaku' }).filter({ hasText: 'k20' })
  await expect(nunchaku).toContainText('1d8') // homebrew zbraň s kostkou d8 (martial arts d6 je nižší)
  await expect(page.getByRole('listitem').filter({ hasText: 'Unarmed Strike' }).filter({ hasText: 'k20' })).toContainText('1d6')
  await page.goBack()

  // DM přepne pravidla
  await page.getByLabel('Pravidla kampaně').selectOption('2024')
  await expect(page.getByText('Pravidla kampaně změněna')).toBeVisible()
  await expect(page.getByTestId('ruleset-badge')).toHaveText('Pravidla 2024')
  await expectNoHorizontalScroll(page)

  await page.getByRole('region', { name: 'Moje postava' }).getByRole('link', { name: /Hajoš/ }).click()
  await expect(page.getByText(/Martial Arts 1d8/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Focus Points: použít' })).toBeVisible()
  await expect(nunchaku).toContainText('1d8')
  await expect(page.getByRole('listitem').filter({ hasText: 'Unarmed Strike' }).filter({ hasText: 'k20' })).toContainText('1d8') // v 2024 je martial arts kostka vyšší
  await expectNoHorizontalScroll(page)

  // prohlížeč pravidel s vybranou kampaní 2024 upozorní, že data jsou ze SRD 5.1
  await page.goto(`/rules?campaign=${campaignId}`)
  await expect(page.getByTestId('ruleset-notice')).toContainText('SRD 5.1')
  await expectNoHorizontalScroll(page)

  // a zpět na 2014 se všechno vrátí
  await page.goto(`/campaigns/${campaignId}`)
  await page.getByLabel('Pravidla kampaně').selectOption('2014')
  await expect(page.getByTestId('ruleset-badge')).toHaveText('Pravidla 2014')
  await page.goto(`/rules?campaign=${campaignId}`)
  await expect(page.getByTestId('ruleset-notice')).toHaveCount(0)
})
