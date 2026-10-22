import { devices, type Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { newContext, registerDm, registerViaUi, uniqueName } from './helpers'

// Plánování session: hráč na telefonu označí dny, DM na počítači vidí, kdy kdo může, zadá termín a hráč ho uvidí na úvodní stránce.

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow, 'stránka nesmí jezdit do stran').toBeLessThanOrEqual(0)
}

const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10)

test('hráč označí dny, DM zadá termín a hráč ho vidí i v oznámeních', async ({ page: dm, browser, baseURL, isMobile }) => {
  test.skip(isMobile, 'Test si staví vlastní kontexty (DM počítač + hráč telefon).')
  test.setTimeout(120_000)

  await registerDm(dm, 'sessdm')
  await dm.getByLabel('Název kampaně').fill('Plánovací')
  await dm.getByRole('button', { name: 'Založit kampaň' }).click()
  await expect(dm).toHaveURL(/\/campaigns\//)
  const campaignId = dm.url().split('/campaigns/')[1]!
  await dm.getByRole('button', { name: /Vytvořit pozvánku/ }).click()
  const code = (await dm.locator('code').first().textContent())?.trim() ?? ''

  const phone = await newContext(browser, { ...devices['Pixel 7'], baseURL, locale: 'cs-CZ' })
  const player = await phone.newPage()
  try {
    await registerViaUi(player, { username: uniqueName('hrac'), startPath: `/join/${code}` })
    await expect(player.getByRole('heading', { name: 'Plánovací', level: 1 })).toBeVisible()

    // --- hráč: na úvodní stránce je karta Další session bez termínu, odkaz vede do kalendáře
    const preview = player.getByTestId('next-session')
    await expect(preview).toContainText('Termín zatím není')
    await preview.getByRole('link', { name: /Kalendář/ }).click()
    await expect(player.getByRole('heading', { name: 'Kalendář', level: 1 })).toBeVisible()
    await expectNoHorizontalScroll(player)

    // označí si dva dny (první dny v měsíci mohou být v minulosti, proto dny podle data)
    const target = inDays(3)
    const other = inDays(4)
    const goTo = async (page: Page, iso: string) => {
      await page.getByTestId('calendar-grid').waitFor()
      for (let i = 0; i < 3; i++) {
        if ((await page.locator(`[data-day="${iso}"]`).count()) > 0 && !(await page.locator(`[data-day="${iso}"]`).evaluate((el) => el.className.includes('opacity-40')))) return
        await page.getByRole('button', { name: 'Další měsíc' }).click()
      }
    }
    for (const iso of [target, other]) {
      await goTo(player, iso)
      await player.locator(`[data-day="${iso}"]`).click()
      await player.getByRole('button', { name: /Mohu hrát tento den/ }).click()
      await expect(player.locator(`[data-day="${iso}"]`)).toHaveAttribute('data-mine', 'true')
    }
    await expect(player.getByTestId('day-count')).toHaveText('1')
    await expectNoHorizontalScroll(player)

    // označení přežije obnovení stránky (je na serveru)
    await player.reload()
    await goTo(player, target)
    await expect(player.locator(`[data-day="${target}"]`)).toHaveAttribute('data-mine', 'true')

    // --- DM na počítači: vidí označené dny hráče, nejlepší dny a zadá termín
    await dm.goto(`/campaigns/${campaignId}/calendar`)
    await expect(dm.getByRole('heading', { name: 'Kalendář', level: 1 })).toBeVisible()
    await expect(dm.getByTestId('best-days')).toContainText('1 z 2')
    await goTo(dm, target)
    await expect(dm.locator(`[data-day="${target}"]`)).toHaveAttribute('data-count', '1')
    await dm.locator(`[data-day="${target}"]`).click()
    await expect(dm.getByTestId('day-members')).toContainText('může')
    await dm.getByRole('button', { name: 'Zadat session na tento den' }).click()
    const dialog = dm.getByRole('dialog', { name: 'Zadat session' })
    await dialog.getByLabel(/Čas/).fill('18:30')
    await dialog.getByLabel(/Poznámka/).fill('U Jakuba doma')
    await dialog.getByRole('button', { name: 'Zadat session' }).click()
    await expect(dm.getByTestId('upcoming-sessions')).toContainText('18:30')
    await expect(dm.getByTestId('upcoming-sessions')).toContainText('U Jakuba doma')
    await expectNoHorizontalScroll(dm)

    // --- hráč: termín je na úvodní stránce a přišlo oznámení
    await player.goto(`/campaigns/${campaignId}`)
    await expect(player.getByTestId('next-session')).toContainText('18:30', { timeout: 40_000 })
    await expect(player.getByTestId('next-session')).toContainText('U Jakuba doma')
    await player.goto('/notifications')
    await expect(player.getByRole('link', { name: /Další session:.*18:30/ })).toBeVisible()
    await player.getByRole('link', { name: /Další session:.*18:30/ }).click()
    await expect(player.getByRole('heading', { name: 'Kalendář', level: 1 })).toBeVisible()

    // hráč nemá tlačítka DM
    await goTo(player, target)
    await player.locator(`[data-day="${target}"]`).click()
    await expect(player.getByRole('button', { name: /Upravit session|Zadat session/ })).toHaveCount(0)

    // --- DM session zruší
    await dm.locator(`[data-day="${target}"]`).click()
    await dm.getByRole('button', { name: 'Upravit session' }).click()
    dm.once('dialog', (d) => void d.accept())
    await dm.getByRole('dialog').getByRole('button', { name: 'Zrušit session' }).click()
    await expect(dm.getByTestId('upcoming-sessions')).toHaveCount(0)
  } finally {
    await phone.close()
  }
})
