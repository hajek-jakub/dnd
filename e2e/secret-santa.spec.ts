import { spawnSync } from 'node:child_process'
import AxeBuilder from '@axe-core/playwright'
import path from 'node:path'
import { devices, type Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { newContext, registerDm, registerViaUi, uniqueName } from './helpers'

// Secret Santa: po vylosování se hráči na telefonu hned po otevření aplikace ukáže bedna, otevře ji a dozví se, komu dává dárek.

const root = path.resolve(import.meta.dirname, '..')
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10)

async function expectAccessible(page: Page, name: string) {
  // přechody barev by axe změřil v půlce animace
  await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; animation: none !important; }' })
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`), name).toEqual([])
}

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow, 'stránka nesmí jezdit do stran').toBeLessThanOrEqual(0)
}

test('hráč po otevření aplikace otevře bednu a uvidí, komu dává dárek; DM ji odloží', async ({ page: dm, browser, baseURL, isMobile }) => {
  test.skip(isMobile, 'Test si staví vlastní kontexty (DM počítač + hráči na telefonu).')
  test.setTimeout(120_000)

  const dmName = await registerDm(dm, 'santadm')
  await dm.getByLabel('Název kampaně').fill('Mirabilis zkouška')
  await dm.getByRole('button', { name: 'Založit kampaň' }).click()
  await expect(dm).toHaveURL(/\/campaigns\//)
  const campaignId = dm.url().split('/campaigns/')[1]!.split('/')[0]!
  await dm.getByRole('button', { name: /Vytvořit pozvánku/ }).click()
  const code = (await dm.locator('code').first().textContent())?.trim() ?? ''

  const phone = await newContext(browser, { ...devices['Pixel 7'], baseURL, locale: 'cs-CZ' })
  const other = await newContext(browser, { ...devices['Pixel 7'], baseURL, locale: 'cs-CZ' })
  const player = await phone.newPage()
  const player2 = await other.newPage()
  try {
    const p1 = uniqueName('santa')
    const p2 = uniqueName('santa')
    await registerViaUi(player, { username: p1, startPath: `/join/${code}` })
    await registerViaUi(player2, { username: p2, startPath: `/join/${code}` })

    const res = spawnSync('php', ['api/bin/secret-santa.php', `--campaign=${campaignId}`, `--until=${inDays(20)}`, `@${dmName}`, `@${p1}`, `@${p2}`], {
      cwd: root,
      encoding: 'utf8',
      env: { PATH: process.env.PATH ?? '', DND_CONFIG: path.join(root, 'api/config.test.php') },
    })
    expect(res.status, res.stderr).toBe(0)

    // --- hráč: bedna se ukáže sama po otevření aplikace
    await player.goto('/')
    const dialog = player.getByTestId('secret-santa-dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText(`${p1}, komu letos dáš dárek ty?`)
    await dialog.getByRole('button', { name: 'Otevřít bednu' }).click()
    await expect(dialog.getByText('Losuje se…')).toBeVisible()
    await expectNoHorizontalScroll(player)
    const receiver = dialog.getByTestId('secret-santa-receiver')
    await expect(receiver).toBeVisible({ timeout: 15_000 })
    const name = (await receiver.textContent())?.trim()
    expect([dmName, p2]).toContain(name)
    await expectAccessible(player, 'výsledek losování')
    await dialog.getByRole('button', { name: 'Hotovo' }).click()
    await expect(dialog).toBeHidden()

    // na úvodní stránce kampaně zůstane, komu dává; po znovuotevření už se bedna sama neukáže
    await expect(player.getByTestId('secret-santa-card-receiver')).toHaveText(name!)
    await player.reload()
    await expect(player.getByTestId('secret-santa-card-receiver')).toHaveText(name!)
    await expect(player.getByTestId('secret-santa-dialog')).toBeHidden()
    await expectNoHorizontalScroll(player)
    await expectAccessible(player, 'karta na úvodu')

    // --- DM: bednu zavře bez otevření, karta ho vyzve a v téže kartě prohlížeče se bedna nevnucuje znovu
    await dm.goto(`/campaigns/${campaignId}`)
    const dmDialog = dm.getByTestId('secret-santa-dialog')
    await expect(dmDialog).toBeVisible()
    await dmDialog.getByRole('button', { name: 'Zavřít' }).click()
    await expect(dmDialog).toBeHidden()
    await expect(dm.getByTestId('secret-santa-card')).toContainText('Ještě nevíš, komu dáváš dárek.')
    // událost close nativního dialogu přijde až po skrytí, odložení se uloží v ní
    await expect.poll(() => dm.evaluate(() => sessionStorage.getItem('dnd.santaLater') ?? '')).toMatch(/[0-9a-f-]{36}/)
    await dm.reload()
    await expect(dm.getByTestId('secret-santa-card')).toBeVisible()
    await expect(dm.getByTestId('secret-santa-dialog')).toBeHidden()

    // --- druhý hráč (omezený pohyb): dozví se hned a nikdo nemá sám sebe
    await player2.emulateMedia({ reducedMotion: 'reduce' })
    await player2.goto('/')
    const d2 = player2.getByTestId('secret-santa-dialog')
    await d2.getByRole('button', { name: 'Otevřít bednu' }).click()
    const name2 = (await d2.getByTestId('secret-santa-receiver').textContent())?.trim()
    expect([dmName, p1]).toContain(name2)
    expect(name2).not.toBe(name)
  } finally {
    await phone.close()
    await other.close()
  }
})
