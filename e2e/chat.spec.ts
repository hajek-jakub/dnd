import { devices, type Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { newContext, registerDm, registerViaUi, uniqueName } from './helpers'

// Chat: emoji reakce, odpovědi, úprava a smazání zpráv. DM na počítači, hráč na telefonu.

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow, 'stránka nesmí jezdit do stran').toBeLessThanOrEqual(0)
}

async function newCampaign(page: Page, name: string): Promise<{ campaignId: string; code: string }> {
  await page.getByLabel('Název kampaně').fill(name)
  await page.getByRole('button', { name: 'Založit kampaň' }).click()
  await expect(page).toHaveURL(/\/campaigns\//)
  const campaignId = page.url().split('/campaigns/')[1]!
  await page.getByRole('button', { name: /Vytvořit pozvánku/ }).click()
  const code = (await page.locator('code').first().textContent())?.trim() ?? ''
  return { campaignId, code }
}

const log = (page: Page) => page.getByRole('log', { name: 'Zprávy' })
const row = (page: Page, text: string | RegExp) => log(page).locator('[id^="msg-"]').filter({ hasText: text })

async function write(page: Page, text: string) {
  await page.getByLabel('Zpráva', { exact: true }).fill(text)
  await page.getByRole('button', { name: 'Odeslat' }).click()
  await expect(row(page, text)).toBeVisible()
}

test('reakce, odpověď, úprava a smazání zprávy: DM na počítači, hráč na telefonu', async ({ page: dm, browser, baseURL, isMobile }) => {
  test.skip(isMobile, 'Dva kontexty si ten test staví sám (DM počítač + hráč telefon).')
  test.setTimeout(150_000)

  await registerDm(dm, 'chatfeat')
  const { campaignId, code } = await newCampaign(dm, 'Chat funkce')
  const phone = await newContext(browser, { ...devices['Pixel 7'], baseURL, locale: 'cs-CZ' })
  const bob = await phone.newPage()
  try {
    await registerViaUi(bob, { username: uniqueName('bob'), startPath: `/join/${code}` })
    await dm.goto(`/campaigns/${campaignId}/messages`)
    await bob.goto(`/campaigns/${campaignId}/messages`)
    await bob.getByRole('button', { name: /Skupina/ }).click()

    await write(bob, 'Kdo vede dnes hru?')
    await expect(row(dm, 'Kdo vede dnes hru?')).toBeVisible({ timeout: 15_000 })

    // --- reakce jako na Messengeru: jedna bublina s počtem, vlastní emoji, každý jednu reakci
    const pill = (page: Page) => row(page, 'Kdo vede dnes hru?').getByRole('button', { name: /^Reakce \d/ })
    // pořadí reakcí ze stejné sekundy se může lišit, proto obě varianty
    const both = (a: string, b: string) => new RegExp(`^Reakce 2: (${a}, ${b}|${b}, ${a})$`)
    await row(dm, 'Kdo vede dnes hru?').getByRole('button', { name: /^Akce zprávy/ }).click()
    await dm.getByRole('toolbar', { name: 'Akce zprávy' }).getByRole('button', { name: 'Reagovat 👍' }).click()
    await expect(pill(dm)).toHaveAccessibleName('Reakce 1: 👍 1')
    await expect(pill(bob)).toHaveAccessibleName('Reakce 1: 👍 1', { timeout: 15_000 })
    // Bob napíše vlastní emoji
    await row(bob, 'Kdo vede dnes hru?').getByRole('button', { name: /^Akce zprávy/ }).click()
    await bob.getByRole('toolbar', { name: 'Akce zprávy' }).getByRole('button', { name: 'Jiné emoji' }).click()
    const picker = bob.getByRole('dialog', { name: 'Reagovat emoji' })
    await picker.getByLabel('Vlastní emoji').fill('abc')
    await picker.getByRole('button', { name: 'Reagovat', exact: true }).click()
    await expect(picker.getByRole('alert')).toHaveText('Napiš nebo vlož jedno emoji.')
    await picker.getByLabel('Vlastní emoji').fill('🐉')
    await picker.getByRole('button', { name: 'Reagovat', exact: true }).click()
    await expect(picker).toBeHidden()
    await expect(pill(bob)).toHaveAccessibleName(both('👍 1', '🐉 1'))
    await expect(pill(dm)).toHaveAccessibleName(both('👍 1', '🐉 1'), { timeout: 15_000 })
    // jiné emoji z nabídky předchozí reakci nahradí, naposledy použité se pamatuje
    await row(bob, 'Kdo vede dnes hru?').getByRole('button', { name: /^Akce zprávy/ }).click()
    await bob.getByRole('toolbar', { name: 'Akce zprávy' }).getByRole('button', { name: 'Jiné emoji' }).click()
    await expect(picker.getByRole('region', { name: 'Naposledy použité' }).getByRole('button', { name: 'Reagovat 🐉' })).toHaveAttribute('aria-pressed', 'true')
    await picker.getByRole('region', { name: 'Dobrodružství' }).getByRole('button', { name: 'Reagovat 🧙' }).click()
    await expect(pill(bob)).toHaveAccessibleName(both('👍 1', '🧙 1'))
    await expectNoHorizontalScroll(bob)
    // DM v detailu vidí, kdo jak reagoval, a svou reakci odebere
    await expect(pill(dm)).toHaveAccessibleName(both('👍 1', '🧙 1'), { timeout: 15_000 })
    await pill(dm).click()
    const detail = dm.getByRole('dialog', { name: 'Reakce' })
    await expect(detail.getByRole('list', { name: 'Kdo reagoval' }).getByRole('listitem')).toHaveCount(2)
    await detail.getByRole('button', { name: 'Odebrat' }).click()
    await expect(detail).toBeHidden()
    await expect(pill(bob)).toHaveAccessibleName('Reakce 1: 🧙 1', { timeout: 15_000 })
    await expectNoHorizontalScroll(bob)

    // --- DM odpoví na Bobovu zprávu, Bob vidí citaci
    await row(dm, 'Kdo vede dnes hru?').getByRole('button', { name: /^Akce zprávy/ }).click()
    await dm.getByRole('button', { name: 'Odpovědět' }).click()
    await expect(dm.getByRole('status').filter({ hasText: 'Odpovídáš:' })).toBeVisible()
    await write(dm, 'Já, jako vždy')
    await expect(dm.getByRole('status').filter({ hasText: 'Odpovídáš:' })).toHaveCount(0)
    const reply = row(bob, 'Já, jako vždy')
    await expect(reply).toBeVisible({ timeout: 15_000 })
    await expect(reply.getByRole('button', { name: /^Přejít na zprávu od/ })).toContainText('Kdo vede dnes hru?')
    await expectNoHorizontalScroll(bob)

    // --- Bob upraví svou zprávu: změna se ukáže DM i v citaci odpovědi
    await row(bob, 'Kdo vede dnes hru?').first().getByRole('button', { name: /^Akce zprávy/ }).click()
    await expect(bob.getByRole('toolbar', { name: 'Akce zprávy' }).getByRole('button', { name: 'Upravit' })).toBeVisible()
    await expectNoHorizontalScroll(bob)
    await bob.getByRole('button', { name: 'Upravit' }).click()
    await expect(bob.getByLabel('Zpráva', { exact: true })).toHaveValue('Kdo vede dnes hru?')
    await bob.getByLabel('Zpráva', { exact: true }).fill('Kdo vede dnes hru? (v pátek)')
    await bob.getByRole('button', { name: 'Uložit' }).click()
    await expect(row(bob, 'Kdo vede dnes hru? (v pátek)').first()).toContainText('upraveno')
    await expect(row(dm, 'Kdo vede dnes hru? (v pátek)').first()).toContainText('upraveno', { timeout: 15_000 })
    await expect(row(dm, 'Já, jako vždy').getByRole('button', { name: /^Přejít na zprávu od/ })).toContainText('(v pátek)')

    // --- hráč cizí zprávu nemění ani nemaže
    await row(bob, 'Já, jako vždy').getByRole('button', { name: /^Akce zprávy/ }).click()
    const toolbar = bob.getByRole('toolbar', { name: 'Akce zprávy' })
    await expect(toolbar.getByRole('button', { name: 'Odpovědět' })).toBeVisible()
    await expect(toolbar.getByRole('button', { name: 'Upravit' })).toHaveCount(0)
    await expect(toolbar.getByRole('button', { name: 'Smazat' })).toHaveCount(0)
    await bob.getByRole('button', { name: /^Akce zprávy/ }).first().focus()
    await bob.keyboard.press('Escape')

    // --- DM smaže Bobovu zprávu (moderace): text zmizí všem, citace ukáže smazanou zprávu
    dm.once('dialog', (d) => void d.accept())
    await row(dm, 'Kdo vede dnes hru? (v pátek)').first().getByRole('button', { name: /^Akce zprávy/ }).click()
    await dm.getByRole('button', { name: 'Smazat' }).click()
    await expect(dm.getByText('Zpráva byla smazána')).toBeVisible()
    await expect(bob.getByText('Zpráva byla smazána')).toBeVisible({ timeout: 15_000 })
    await expect(bob.getByText('Kdo vede dnes hru? (v pátek)')).toHaveCount(0)
    await expect(row(bob, 'Já, jako vždy').getByRole('button', { name: /^Přejít na zprávu od/ })).toContainText('Smazaná zpráva')
    await expectNoHorizontalScroll(bob)
  } finally {
    await phone.close()
  }
})

test('na počítači Enter odešle zprávu a Shift+Enter dá nový řádek; chat má oddělovač dne', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Enter odesílá jen na počítači s myší; na dotykovém displeji je Enter nový řádek.')
  await registerDm(page, 'chatenter')
  const { campaignId } = await newCampaign(page, 'Enter')
  await page.goto(`/campaigns/${campaignId}/messages`)
  const box = page.getByLabel('Zpráva', { exact: true })
  await box.fill('První řádek')
  await box.press('Shift+Enter')
  await box.pressSequentially('druhý řádek')
  await expect(box).toHaveValue('První řádek\ndruhý řádek')
  await box.press('Enter')
  await expect(row(page, 'druhý řádek')).toBeVisible()
  await expect(box).toHaveValue('')
  await expect(log(page).getByText('Dnes', { exact: true })).toBeVisible()
})
