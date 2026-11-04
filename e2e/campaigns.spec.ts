import { devices, type Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { newContext, registerDm, uniqueName } from './helpers'

// Více kampaní: kdokoli založí kampaň (je v ní DM), pozve existujícího uživatele jménem a ten pozvánku přijme na telefonu.
// Stejný člověk je pak hráčem v jedné kampani a DM ve své, přepíná přepínačem v horní liště (Panel DM a AI jen tam, kde je DM).

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow, 'stránka nesmí jezdit do stran').toBeLessThanOrEqual(0)
}

async function newCampaign(page: Page, name: string): Promise<string> {
  await page.getByLabel('Název kampaně').fill(name)
  await page.getByRole('button', { name: 'Založit kampaň' }).click()
  await expect(page).toHaveURL(/\/campaigns\/[^/]+$/)
  return page.url().split('/campaigns/')[1]!
}

test('pozvání existujícího hráče jménem, přijetí na telefonu a přepínání mezi rolí hráče a DM', async ({ page: dm, browser, baseURL, isMobile }) => {
  test.skip(isMobile, 'Dva kontexty si test staví sám (DM počítač + hráč telefon).')
  test.setTimeout(120_000)
  await registerDm(dm, 'zvdm')
  const campaignId = await newCampaign(dm, 'Zvaná kampaň')
  // nová kampaň bez hráčů ukáže, čím začít
  await expect(dm.getByTestId('start-card')).toBeVisible()

  const phone = await newContext(browser, { ...devices['Pixel 7'], baseURL, locale: 'cs-CZ' })
  const player = await phone.newPage()
  try {
    const playerName = await registerDm(player, 'zvhrac')
    await newCampaign(player, 'Moje vlastní')

    await dm.getByLabel('Pozvat podle přihlašovacího jména').fill('nikdo-takovy')
    await dm.getByRole('button', { name: 'Pozvat', exact: true }).click()
    await expect(dm.getByRole('alert')).toContainText('neexistuje')
    await dm.getByLabel('Pozvat podle přihlašovacího jména').fill(playerName)
    await dm.getByRole('button', { name: 'Pozvat', exact: true }).click()
    await expect(dm.getByRole('region', { name: 'Čekající pozvánky' })).toContainText(playerName)

    // hráč pozvánku uvidí na úvodu (i když má jedinou kampaň, úvod ho nepřesměruje) a v přepínači
    await player.goto('/')
    const invitation = player.getByRole('region', { name: 'Pozvánky do kampaní' })
    await expect(invitation).toContainText('Zvaná kampaň', { timeout: 15_000 })
    await expectNoHorizontalScroll(player)
    await invitation.getByRole('button', { name: 'Přijmout' }).click()
    await expect(player).toHaveURL(new RegExp(`/campaigns/${campaignId}$`))
    await expect(player.getByRole('heading', { name: 'Zvaná kampaň', level: 1 })).toBeVisible()
    const nav = player.getByTestId('bottom-nav')
    await expect(nav.getByRole('link', { name: /Panel DM/ })).toHaveCount(0)
    await expect(player.getByRole('button', { name: 'AI pomocník' })).toHaveCount(0)

    // přepnutí do vlastní kampaně, kde je DM
    await player.getByRole('button', { name: 'Přepnout kampaň (teď Zvaná kampaň)' }).click()
    const switcher = player.getByRole('dialog', { name: 'Moje kampaně' })
    await expect(switcher.getByRole('button', { name: /Zvaná kampaň/ })).toHaveAttribute('aria-current', 'true')
    await expectNoHorizontalScroll(player)
    await switcher.getByRole('button', { name: /Moje vlastní/ }).click()
    await expect(player.getByRole('heading', { name: 'Moje vlastní', level: 1 })).toBeVisible()
    await expect(nav.getByRole('link', { name: /Panel DM/ })).toBeVisible()
    await expect(player.getByRole('button', { name: 'AI pomocník' })).toBeVisible()

    // u DM pozvánka zmizela z čekajících a hráč je mezi členy
    await dm.reload()
    await expect(dm.getByRole('region', { name: 'Čekající pozvánky' })).toHaveCount(0)
    await expect(dm.getByRole('button', { name: new RegExp(`Odebrat hráče ${playerName}`) })).toBeVisible()
    await expect(dm.getByTestId('start-card')).toHaveCount(0)

    // druhá kampaň DM: hráče, se kterým už hraje, pozve jedním klepnutím
    await dm.goto('/campaigns?new=1')
    await expect(dm.getByLabel('Název kampaně')).toBeFocused()
    await newCampaign(dm, `Další ${uniqueName('k')}`)
    await dm.getByRole('button', { name: `Pozvat ${playerName}` }).click()
    await expect(dm.getByRole('region', { name: 'Čekající pozvánky' })).toContainText(playerName)
  } finally {
    await phone.close()
  }
})
