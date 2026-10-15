import { devices, type Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { newContext, registerDm, registerViaUi, uniqueName } from './helpers'

// Deník: DM píše zápisy podle témat, hráč na telefonu je čte a vidí, co je nové; soukromé zápisky vidí jen jejich autor.

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

test('DM píše zápisy do deníku, hráč na telefonu je čte, vidí nové a píše si soukromé zápisky', async ({ page: dm, browser, baseURL, isMobile }) => {
  test.skip(isMobile, 'Dva kontexty si ten test staví sám (DM počítač + hráč telefon).')
  test.setTimeout(120_000)

  await registerDm(dm, 'jrnldm')
  const { campaignId, code } = await newCampaign(dm, 'Deníková')
  const phone = await newContext(browser, { ...devices['Pixel 7'], baseURL, locale: 'cs-CZ' })
  const player = await phone.newPage()
  try {
    await registerViaUi(player, { username: uniqueName('hrac'), startPath: `/join/${code}` })
    await expect(player.getByRole('heading', { name: 'Deníková', level: 1 })).toBeVisible()
    await new Promise((r) => setTimeout(r, 1100)) // "nové" se počítá od vstupu do kampaně, na sekundy

    // --- DM: nový zápis pro všechny (připnutý) a jeden jen pro sebe
    await dm.goto(`/campaigns/${campaignId}/journal`)
    await expect(dm.getByText(/V deníku zatím nic není/)).toBeVisible()
    await dm.getByRole('button', { name: 'Nový zápis' }).click()
    let form = dm.getByRole('dialog')
    await form.getByLabel('Téma').fill('Příběh')
    await form.getByLabel('Nadpis').fill('Co víme o Zrádci')
    await form.getByLabel('Text').fill('**Zrádce** je kovář.\n\n- viděl ho Bob\n- ukradl *Amulet*')
    await form.getByLabel('Připnout nahoru (důležité)').check()
    await form.getByRole('button', { name: 'Přidat do deníku' }).click()
    await expect(dm.getByRole('region', { name: 'Připnuté zápisy' }).getByText('Co víme o Zrádci')).toBeVisible()

    await dm.getByRole('button', { name: 'Nový zápis' }).click()
    form = dm.getByRole('dialog')
    await form.getByLabel('Téma').fill('Místa')
    await form.getByLabel('Nadpis').fill('DM přehled jeskyně')
    await form.getByLabel('Kdo zápis uvidí').selectOption('dm')
    await form.getByRole('button', { name: 'Přidat do deníku' }).click()
    await expect(dm.getByText('DM přehled jeskyně')).toBeVisible()

    // --- hráč na telefonu: odznak nových v dolní liště, zápis nahoře, DM-only zápis nevidí
    await player.goto(`/campaigns/${campaignId}`)
    const nav = player.getByTestId('bottom-nav')
    await expect(nav.getByTestId('unread-journal-badge')).toHaveText('1', { timeout: 40_000 })
    await nav.getByRole('link', { name: /Deník/ }).click()
    await expect(player.getByRole('heading', { name: 'Deník', level: 1 })).toBeVisible()
    const pinned = player.getByRole('region', { name: 'Připnuté zápisy' })
    await expect(pinned.getByText('Co víme o Zrádci')).toBeVisible()
    await expect(pinned.getByText('nové')).toBeVisible()
    await expect(player.getByText('DM přehled jeskyně')).toHaveCount(0)
    // nový zápis je rozbalený a formátovaný (tučné písmo a odrážky, žádné HTML)
    await expect(pinned.locator('strong', { hasText: 'Zrádce' })).toBeVisible()
    await expect(pinned.getByText('viděl ho Bob')).toBeVisible()
    await expectNoHorizontalScroll(player)
    // po otevření deníku odznak zmizí
    await expect(nav.getByTestId('unread-journal-badge')).toHaveCount(0, { timeout: 40_000 })

    // --- hráč si píše soukromý zápisek, DM ho nevidí
    await player.getByRole('button', { name: 'Můj zápisek' }).click()
    form = player.getByRole('dialog')
    await expect(form.getByText('Soukromý zápisek: uvidíš ho jen ty, ani DM ne.')).toBeVisible()
    await expect(form.getByLabel('Kdo zápis uvidí')).toHaveCount(0)
    await form.getByLabel('Téma').fill('Moje úvahy')
    await form.getByLabel('Nadpis').fill('Je zrádce opravdu kovář?')
    await form.getByRole('button', { name: 'Přidat do deníku' }).click()
    await expect(player.getByText('Je zrádce opravdu kovář?')).toBeVisible()
    await dm.reload()
    await expect(dm.getByText('Co víme o Zrádci')).toBeVisible()
    await expect(dm.getByText('Je zrádce opravdu kovář?')).toHaveCount(0)

    // --- hledání a témata
    await player.getByLabel('Hledat v deníku').fill('kovář')
    await expect(player.getByText('Co víme o Zrádci')).toBeVisible() // text zápisu
    await expect(player.getByText('Je zrádce opravdu kovář?')).toBeVisible()
    await player.getByLabel('Hledat v deníku').fill('neexistuje')
    await expect(player.getByText('Nic nenalezeno.')).toBeVisible()
    await player.getByLabel('Hledat v deníku').fill('')
    await player.getByRole('group', { name: 'Témata' }).getByRole('button', { name: 'Moje úvahy' }).click()
    await expect(player.getByText('Co víme o Zrádci')).toHaveCount(0)
    await expect(player.getByText('Je zrádce opravdu kovář?')).toBeVisible()

    // --- hráč cizí zápis nemění; DM svůj upraví (hráči se zase ukáže jako nový)
    await player.getByRole('group', { name: 'Témata' }).getByRole('button', { name: 'Vše' }).click()
    await player.getByRole('button', { name: /Co víme o Zrádci/ }).click()
    await expect(player.getByRole('button', { name: 'Upravit' })).toHaveCount(0)
    await dm.getByRole('button', { name: /Co víme o Zrádci/ }).click()
    await dm.getByRole('button', { name: 'Upravit' }).click()
    await dm.getByRole('dialog').getByLabel('Nadpis').fill('Co víme o Zrádci (aktualizace)')
    await dm.getByRole('dialog').getByRole('button', { name: 'Uložit' }).click()
    await expect(dm.getByText('Co víme o Zrádci (aktualizace)')).toBeVisible()
  } finally {
    await phone.close()
  }
})

test('deník jde číst a psát na telefonu i na počítači bez posouvání do stran', async ({ page }) => {
  await registerDm(page, 'jrnlsolo')
  const { campaignId } = await newCampaign(page, 'Solo deník')
  await page.request.post(`/api/campaigns/${campaignId}/journal`, { data: { topic: 'Příběh', title: 'Velmi dlouhý nadpis zápisu '.repeat(4), body: 'x'.repeat(400) + '\n\nhttps://example.com/' + 'a'.repeat(120), pinned: true } })
  await page.getByTestId('bottom-nav').getByRole('link', { name: /Deník/ }).click()
  await expect(page.getByRole('heading', { name: 'Deník', level: 1 })).toBeVisible()
  await page.getByRole('button', { name: /Velmi dlouhý nadpis/ }).click()
  await expectNoHorizontalScroll(page)
})
