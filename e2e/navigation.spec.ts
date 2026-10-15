import { devices, type Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { newContext, registerDm, registerViaUi, uniqueName } from './helpers'

// Dolní lišta a "aktivní kampaň": hraje se hlavně jedna kampaň, takže se nemusí pokaždé vybírat.

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow, 'stránka nesmí jezdit do stran').toBeLessThanOrEqual(0)
}

async function newCampaign(page: Page, name: string): Promise<string> {
  await page.getByLabel('Název kampaně').fill(name)
  await page.getByRole('button', { name: 'Založit kampaň' }).click()
  await expect(page).toHaveURL(/\/campaigns\//)
  return page.url().split('/campaigns/')[1]!
}

test('dolní lišta je stále vidět a vede do aktivní kampaně; bez kampaně se nezobrazuje', async ({ page }) => {
  await registerDm(page, 'nav')
  // nový uživatel nemá kampaň: ukáže se zakládání a žádná lišta
  await expect(page.getByTestId('bottom-nav')).toHaveCount(0)

  const campaignId = await newCampaign(page, 'První kampaň')
  const nav = page.getByTestId('bottom-nav')
  await expect(nav).toBeVisible()
  const character = (await (await page.request.post(`/api/campaigns/${campaignId}/characters`, { data: { name: 'Navigátor', abilityScores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }, levels: [{ classIndex: 'fighter', hpRoll: null }] } })).json()).character.id as string

  // DM má v liště Panel DM, ne Postavu
  await expect(nav.getByRole('link')).toHaveCount(5)
  for (const name of ['Domů', 'Panel DM', 'Deník', 'Mapy', 'Zprávy']) await expect(nav.getByRole('link', { name: new RegExp(name) })).toBeVisible()

  // lišta zůstává vidět při posouvání a na každé stránce
  for (const [label, url] of [['Panel DM', `/campaigns/${campaignId}/dm`], ['Deník', `/campaigns/${campaignId}/journal`], ['Mapy', `/campaigns/${campaignId}/maps`], ['Zprávy', `/campaigns/${campaignId}/messages`]] as const) {
    await nav.getByRole('link', { name: new RegExp(label) }).click()
    await expect(page).toHaveURL(new RegExp(url.replace(/[/]/g, '\\/')))
    await expect(nav.getByRole('link', { name: new RegExp(label) })).toHaveAttribute('aria-current', 'page')
    const box = await nav.boundingBox()
    const viewport = page.viewportSize()!
    expect(Math.round(box!.y + box!.height), 'lišta je přilepená dole').toBe(viewport.height)
  }
  await page.goto(`/characters/${character}`)
  await page.evaluate(() => window.scrollTo(0, 400))
  await expect(nav).toBeInViewport()
  await expectNoHorizontalScroll(page)

  // úvodní adresa rovnou vede do aktivní kampaně
  await page.goto('/')
  await expect(page).toHaveURL(new RegExp(`/campaigns/${campaignId}$`))
  await expect(page.getByRole('heading', { name: 'První kampaň', level: 1 })).toBeVisible()
})

test('hráč má v liště Postavu (vlastní postava, jinak založení) a lišta si pamatuje poslední kampaň', async ({ page: dm, browser, baseURL, isMobile }) => {
  test.skip(isMobile, 'Dva kontexty si ten test staví sám (DM počítač + hráč telefon).')
  test.setTimeout(120_000)
  await registerDm(dm, 'navdm')
  const first = await newCampaign(dm, 'Hlavní kampaň')
  await dm.getByRole('button', { name: /Vytvořit pozvánku/ }).click()
  const code = (await dm.locator('code').first().textContent())?.trim() ?? ''

  const phone = await newContext(browser, { ...devices['Pixel 7'], baseURL, locale: 'cs-CZ' })
  const player = await phone.newPage()
  try {
    await registerViaUi(player, { username: uniqueName('hrac'), startPath: `/join/${code}` })
    const nav = player.getByTestId('bottom-nav')
    // bez postavy lišta nabízí její vytvoření
    await expect(nav.getByRole('link', { name: 'Nová postava' })).toBeVisible()
    await expect(nav.getByRole('link', { name: /Panel DM/ })).toHaveCount(0)
    await nav.getByRole('link', { name: 'Nová postava' }).click()
    await expect(player.getByRole('heading', { name: 'Nová postava', level: 1 })).toBeVisible()

    const created = await player.request.post(`/api/campaigns/${first}/characters`, { data: { name: 'Hráčova hrdinka', abilityScores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }, levels: [{ classIndex: 'rogue', hpRoll: null }] } })
    const charId = (await created.json()).character.id as string
    await player.goto('/')
    await expect(player).toHaveURL(new RegExp(`/campaigns/${first}$`))
    await expect(nav.getByRole('link', { name: 'Postava', exact: true })).toHaveAttribute('href', `/characters/${charId}`)
    await expect(player.getByRole('region', { name: 'Moje postava' })).toContainText('Hráčova hrdinka')
    await nav.getByRole('link', { name: 'Postava', exact: true }).click()
    await expect(player.getByRole('heading', { name: 'Hráčova hrdinka', level: 1 })).toBeVisible()
    await expectNoHorizontalScroll(player)

    // druhá kampaň: hráč se přihlásí, ruční přepnutí je v Profilu a pamatuje se
    await dm.goto('/campaigns')
    const second = await newCampaign(dm, 'Vedlejší kampaň')
    await dm.getByRole('button', { name: /Vytvořit pozvánku/ }).click()
    const code2 = (await dm.locator('code').first().textContent())?.trim() ?? ''
    await player.goto(`/join/${code2}`)
    await player.getByRole('button', { name: 'Připojit se jako hráč' }).click()
    await expect(player.getByRole('heading', { name: 'Vedlejší kampaň', level: 1 })).toBeVisible()
    await player.goto('/')
    await expect(player).toHaveURL(new RegExp(`/campaigns/${second}$`)) // naposledy otevřená kampaň je aktivní

    await player.getByRole('link', { name: 'Profil a nastavení' }).click()
    await player.getByRole('link', { name: /Hlavní kampaň/ }).click()
    await expect(player).toHaveURL(new RegExp(`/campaigns/${first}$`))
    await player.goto('/')
    await expect(player).toHaveURL(new RegExp(`/campaigns/${first}$`)) // pamatuje se i po návratu na úvod
    await player.goto('/campaigns')
    await expect(player.getByRole('heading', { name: 'Moje kampaně' })).toBeVisible() // seznam všech kampaní zůstává dostupný
  } finally {
    await phone.close()
  }
})
