import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { registerDm } from './helpers'

// Setkání v přípravě: DM si v Lootu připraví nestvůru ze SRD (Goblin) s lootem, který z ní padá, pošle ji do boje,
// v Panelu DM goblina zabije a odkaz na kartě ho vrátí k lootu v té správné složce. Na počítači i na telefonu.

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow, 'stránka nesmí jezdit do stran').toBeLessThanOrEqual(0)
}

test('nestvůra ze SRD v přípravě, loot z ní, Do boje a loot padlého nepřítele', async ({ page }) => {
  test.setTimeout(90_000)
  await registerDm(page, 'encdm')
  await page.getByLabel('Název kampaně').fill('Setkání')
  await page.getByRole('button', { name: 'Založit kampaň' }).click()
  await expect(page).toHaveURL(/\/campaigns\//)
  const campaignId = page.url().split('/campaigns/')[1]!
  await page.request.post(`/api/campaigns/${campaignId}/loot/folders`, { data: { name: 'Jeskyně' } })

  await page.goto(`/campaigns/${campaignId}/dm/loot`)
  await page.getByRole('navigation', { name: 'Složky lootu' }).getByRole('button', { name: /^Jeskyně/ }).click()

  // nepřítel z pravidel: hodnoty se doplní ze SRD
  await page.getByRole('button', { name: 'Nepřítel', exact: true }).click()
  const form = page.getByRole('dialog', { name: 'Nový nepřítel: Jeskyně' })
  await form.getByRole('button', { name: 'Z pravidel (nestvůry SRD)' }).click()
  await form.getByLabel('Hledat nestvůru').fill('Goblin')
  await form.getByRole('button', { name: 'Použít Goblin' }).click()
  await expect(form.getByLabel('Jméno')).toHaveValue('Goblin')
  await expect(form.getByLabel('Max HP')).toHaveValue('7')
  await expect(form.getByLabel('AC')).toHaveValue('15')
  await expect(form.getByLabel('Název').first()).toHaveValue('Scimitar')
  await form.getByLabel('Kusů').fill('2')
  await form.getByRole('button', { name: 'Uložit' }).click()
  await expect(form).toBeHidden()

  const enemy = page.getByTestId('loot-enemy-Goblin')
  await expect(enemy.getByText('2× Goblin')).toBeVisible()
  await expect(enemy.getByText('CR 1/4 · AC 15 · HP 7 · Scimitar +4 (1d6+2)')).toBeVisible()

  // zlato, které z goblinů padá
  await enemy.getByRole('button', { name: 'Přidat zlato, které padá z: Goblin' }).click()
  const gold = page.getByRole('dialog', { name: 'Zlato: Jeskyně' })
  await expect(gold.getByLabel('Padá z nepřítele')).toHaveValue(/.+/)
  await gold.getByLabel('Název (nepovinné)').fill('Měšce goblinů')
  await gold.locator('#loot-coin-sp').fill('12')
  await gold.getByRole('button', { name: 'Přidat do lootu' }).click()
  await expect(enemy.getByRole('list', { name: 'Loot z: Goblin' }).getByText('Měšce goblinů')).toBeVisible()
  await expectNoHorizontalScroll(page)

  // do boje
  await enemy.getByRole('button', { name: 'Do boje: 2× Goblin' }).click()
  await expect(page.getByText(/Do boje: Goblin 1, Goblin 2/)).toBeVisible()

  await page.goto(`/campaigns/${campaignId}/dm`)
  const card = page.getByTestId('enemy-Goblin 1')
  await expect(card.getByTestId('enemy-loot-Goblin 1')).toContainText('Loot, který z něj padá:')
  await expect(card.getByTestId('enemy-loot-Goblin 1')).toContainText('Měšce goblinů: 12 sp')
  await card.getByLabel('Goblin 1: kolik HP').fill('7')
  await card.getByRole('button', { name: 'Goblin 1: zranit' }).click()
  await expect(card.getByText('Padl', { exact: true })).toBeVisible()
  await expect(card.getByTestId('enemy-loot-Goblin 1')).toContainText('Padl, loot k rozdání:')
  await expectNoHorizontalScroll(page)

  // odkaz otevře Loot rovnou ve složce goblinů
  await card.getByRole('link', { name: 'Rozdat v Lootu' }).click()
  await expect(page).toHaveURL(new RegExp(`/campaigns/${campaignId}/dm/loot\\?folder=`))
  await expect(page.getByRole('heading', { name: 'Jeskyně', level: 2 })).toBeVisible()
  await expect(page.getByTestId('loot-enemy-Goblin').getByText('Měšce goblinů')).toBeVisible()
})
