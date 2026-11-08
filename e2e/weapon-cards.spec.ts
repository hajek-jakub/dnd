import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { registerDm } from './helpers'

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow, 'stránka nesmí jezdit do stran').toBeLessThanOrEqual(0)
}

const fighter = {
  name: 'Filip',
  abilityScores: { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 10 },
  levels: [{ classIndex: 'fighter', hpRoll: null }],
}

/** Fighter s Longswordem z pravidel, sheet otevřený na přehledu. */
async function openFighter(page: Page, prefix: string): Promise<string> {
  await registerDm(page, prefix)
  await page.getByLabel('Název kampaně').fill('Zbraně kampaň')
  await page.getByRole('button', { name: 'Založit kampaň' }).click()
  await expect(page).toHaveURL(/\/campaigns\//)
  const campaignId = page.url().split('/campaigns/')[1]!
  const created = await page.request.post(`/api/campaigns/${campaignId}/characters`, { data: fighter })
  const id = (await created.json()).character.id as string
  const rules = await (await page.request.get('/api/rules?kinds=weapon&q=Longsword')).json()
  const longsword = rules.entries.find((e: { name: string }) => e.name === 'Longsword')
  expect((await page.request.post(`/api/characters/${id}/items`, { data: { ruleId: longsword.id } })).status()).toBe(201)
  await page.goto(`/characters/${id}`)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  return id
}

test('karta útoku: útok a zranění nahoře, Versatile přepíná kostku, opotřebení je sbalené dole', async ({ page }) => {
  await openFighter(page, 'zbr')
  const row = page.getByTestId('attack-row').filter({ hasText: 'Longsword' })
  await expect(row.getByRole('button', { name: /^Longsword: bonus k útoku: \+5\./ })).toBeVisible()
  await expect(row.getByTestId('attack-dice')).toHaveText('1d8')
  await expect(row.getByRole('button', { name: /^Longsword: bonus ke zranění: \+3\./ })).toBeVisible()

  // Útok a zranění jsou nad přepínačem držení i nad opotřebením
  const top = async (name: RegExp | string) => (await row.getByRole('button', { name }).first().boundingBox())!.y
  const attackY = await top(/bonus k útoku/)
  expect(attackY).toBeLessThan(await top('Oběma rukama 1d10'))
  const wear = row.getByTestId('wear-details')
  expect(attackY).toBeLessThan((await wear.boundingBox())!.y)

  await row.getByRole('button', { name: 'Oběma rukama 1d10' }).click()
  await expect(row.getByRole('button', { name: 'Oběma rukama 1d10' })).toHaveAttribute('aria-pressed', 'true')
  await expect(row.getByTestId('attack-dice')).toHaveText('1d10')
  await expect(row.getByRole('button', { name: /Longsword: zranění \(oběma rukama\) \(1d10\+3\)/ })).toBeVisible()
  // volba držení se pamatuje i po obnovení stránky
  await page.reload()
  await expect(page.getByTestId('attack-row').filter({ hasText: 'Longsword' }).getByTestId('attack-dice')).toHaveText('1d10')

  // počítadlo nat 1 je schované, dokud ho hráč nerozbalí
  const details = page.getByTestId('attack-row').filter({ hasText: 'Longsword' }).getByTestId('wear-details')
  await expect(details.getByTestId('nat1')).toBeHidden()
  await details.getByText('Opotřebení: nat 1 0').click()
  await expect(details.getByTestId('nat1')).toBeVisible()
  await details.getByRole('button', { name: 'Nat 1 Longsword: +1' }).click()
  await expect(details.getByText('Opotřebení: nat 1 1')).toBeVisible()
  await expectNoHorizontalScroll(page)

  // v inventáři je útok a zranění vidět rovnou v řádku zbraně
  await page.getByRole('button', { name: 'Inventář', exact: true }).click()
  await expect(page.getByTestId('item-attack')).toHaveText('+5 · 1d8+3 (oběma rukama 1d10)')
  await expectNoHorizontalScroll(page)
})

test('featury: proficiencies z třídy i vlastní, vlastní featura (manévr) se přidá, upraví a smaže', async ({ page }) => {
  await openFighter(page, 'fea')
  await page.getByRole('button', { name: 'Featury', exact: true }).click()

  const profs = page.getByRole('heading', { name: 'Proficiencies' }).locator('xpath=ancestor::*[@data-slot="card"][1]')
  await expect(profs.getByRole('region', { name: 'Zbraně' })).toContainText('Martial Weapons')
  await expect(profs.getByRole('region', { name: 'Zbroj a štíty' })).toContainText('Shields')
  await profs.getByLabel('Druh proficiency').selectOption('tool')
  await profs.getByLabel('Název proficiency').fill("Smith's Tools")
  await profs.getByRole('button', { name: 'Přidat proficiency' }).click()
  await expect(profs.getByRole('region', { name: 'Nástroje a vozidla' })).toContainText("Smith's Tools")
  await expect(profs.getByRole('button', { name: "Odebrat proficiency Smith's Tools" })).toBeVisible()
  await expect(profs.getByRole('button', { name: 'Odebrat proficiency Martial Weapons' })).toHaveCount(0)

  await page.getByRole('button', { name: 'Přidat featuru' }).click()
  const dialog = page.getByRole('dialog', { name: 'Nová featura' })
  await dialog.getByLabel('Název').fill('Trip Attack')
  await dialog.getByLabel('Odkud (nepovinné)').fill('Battle Master: manévr')
  await dialog.locator('#cf-desc').fill('**Trip**: +1d8 ke zranění a STR save, jinak Prone.')
  await dialog.getByRole('button', { name: 'Uložit' }).click()
  const feature = page.getByTestId('custom-feature').filter({ hasText: 'Trip Attack' })
  await expect(feature).toContainText('Battle Master: manévr')

  await page.reload()
  await page.getByRole('button', { name: 'Featury', exact: true }).click()
  await feature.getByText('Trip Attack').click()
  await expect(feature.locator('strong', { hasText: 'Trip' })).toBeVisible()
  await feature.getByRole('button', { name: 'Upravit' }).click()
  await page.getByRole('dialog', { name: 'Upravit featuru' }).getByLabel('Název').fill('Trip Attack II')
  await page.getByRole('dialog', { name: 'Upravit featuru' }).getByRole('button', { name: 'Uložit' }).click()
  await expect(page.getByTestId('custom-feature').filter({ hasText: 'Trip Attack II' })).toBeVisible()

  page.once('dialog', (d) => void d.accept())
  await page.getByRole('button', { name: 'Smazat featuru Trip Attack II' }).click()
  await expect(page.getByTestId('custom-feature')).toHaveCount(0)
  await expectNoHorizontalScroll(page)
})
