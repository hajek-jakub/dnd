import { devices, type Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { loginViaUi, newContext, PASSWORD, registerDm, registerViaUi, uniqueName } from './helpers'

// Hlavní scénář: DM na počítači, hráč na telefonu (dvě oddělené relace).
// Spouští se v projektu "desktop"; hráčův kontext si vyrobí jako Pixel 7.

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(0)
}

test('DM na počítači pozve hráče, hráč se z telefonu zaregistruje a nevidí nic navíc', async ({ page: dm, browser, baseURL }) => {
  // ---- DM (počítač): registrace, kampaň, pozvánka
  await registerDm(dm)
  await dm.getByLabel('Název kampaně').fill('Ztracený důl')
  await dm.getByRole('button', { name: 'Založit kampaň' }).click()
  await expect(dm.getByRole('heading', { name: 'Ztracený důl' })).toBeVisible()
  await expect(dm.getByText('Dungeon Master').first()).toBeVisible()
  const campaignId = dm.url().split('/campaigns/')[1]!

  await dm.getByRole('button', { name: /Vytvořit pozvánku/ }).click()
  const code = (await dm.locator('code').first().textContent())?.trim() ?? ''
  expect(code).toMatch(/^[A-HJKMNP-Z2-9]{10}$/)

  // ---- Hráč (telefon): otevře odkaz od DM, zaregistruje se a přijme pozvánku
  const phone = await newContext(browser, { ...devices['Pixel 7'], baseURL, locale: 'cs-CZ' })
  const player = await phone.newPage()
  const playerName = uniqueName('hrac')
  try {
    // /join/KOD → přihlášení → registrace (kód je předvyplněný z odkazu) → zpět na pozvánku
    await registerViaUi(player, { username: playerName, startPath: `/join/${code}`, displayName: 'Hráč Pepa' })
    await expectNoHorizontalScroll(player)

    // Registrace s kódem pozvánky hráče rovnou připojila, takže ho join stránka přesměruje do kampaně.
    await expect(player).toHaveURL(new RegExp(`/campaigns/${campaignId}$`))
    await expect(player.getByRole('heading', { name: 'Ztracený důl' })).toBeVisible()
    await expect(player.getByText('Hráč', { exact: true }).first()).toBeVisible()
    await expectNoHorizontalScroll(player)

    // UI hráči nenabízí DM věci.
    await expect(player.getByRole('heading', { name: 'Pozvánky' })).toHaveCount(0)
    await expect(player.getByRole('button', { name: 'Smazat kampaň' })).toHaveCount(0)
    // odejít z kampaně jde až v Profilu, na hlavní stránce kampaně to není
    await expect(player.getByRole('button', { name: /Odejít z kampaně/ })).toHaveCount(0)

    // A přes API (obejití UI) hráč DM věci opravdu nedostane ani neprovede.
    const api = (path: string) => `/api${path}`
    expect((await player.request.get(api(`/campaigns/${campaignId}/invites`))).status()).toBe(403)
    expect((await player.request.get(api(`/campaigns/${campaignId}/dm-notes`))).status()).toBe(403)
    expect((await player.request.post(api(`/campaigns/${campaignId}/invites`), { data: {} })).status()).toBe(403)
    expect((await player.request.patch(api(`/campaigns/${campaignId}`), { data: { name: 'Hacknuto' } })).status()).toBe(403)
    expect((await player.request.delete(api(`/campaigns/${campaignId}`))).status()).toBe(403)

    // ---- DM na počítači vidí nového člena pod zobrazovaným jménem
    await dm.reload()
    await expect(dm.locator('li', { hasText: 'Hráč Pepa' })).toBeVisible()
    await expect(dm.getByRole('heading', { name: 'Ztracený důl' })).toBeVisible()

    // ---- Hráč se odhlásí a znovu přihlásí heslem
    await player.getByRole('link', { name: 'Profil a nastavení' }).click()
    await player.getByRole('button', { name: 'Odhlásit se' }).click()
    await expect(player).toHaveURL(/\/login/)
    await loginViaUi(player, playerName, 'spatneheslo123')
    await expect(player.getByRole('alert')).toContainText('Špatné jméno nebo heslo')
    await player.getByLabel('Heslo').fill(PASSWORD)
    await player.getByRole('button', { name: 'Přihlásit se' }).click()
    // po přihlášení rovnou do (jediné) kampaně, kampaň se nevybírá ručně
    await expect(player.getByRole('heading', { name: 'Ztracený důl', level: 1 })).toBeVisible()

    // ---- Hráč odejde z kampaně (potvrzení v dialogu)
    player.once('dialog', (dialog) => void dialog.accept())
    await player.getByRole('link', { name: 'Profil a nastavení' }).click()
    await player.getByRole('button', { name: 'Odejít z kampaně Ztracený důl' }).click()
    await expect(player).toHaveURL(/\/$/)
    await expect(player.getByText('Ztracený důl')).toHaveCount(0)

    // DM ho po obnovení už v seznamu nemá
    await dm.reload()
    await expect(dm.locator('li', { hasText: 'Hráč Pepa' })).toHaveCount(0)
  } finally {
    await phone.close()
  }
})

test('registrovaný uživatel se připojí pozvánkou přes odkaz a cizinec nevidí cizí kampaň', async ({ page: dm, browser, baseURL }) => {
  await registerDm(dm)
  await dm.getByLabel('Název kampaně').fill('Soukromá')
  await dm.getByRole('button', { name: 'Založit kampaň' }).click()
  await expect(dm).toHaveURL(/\/campaigns\//)
  const campaignId = dm.url().split('/campaigns/')[1]!
  await dm.getByRole('button', { name: /Vytvořit pozvánku/ }).click()
  const code = (await dm.locator('code').first().textContent())?.trim() ?? ''

  const phone = await newContext(browser, { ...devices['Pixel 7'], baseURL, locale: 'cs-CZ' })
  const stranger = await phone.newPage()
  try {
    // Cizinec s účtem (založeným registračním heslem) kampaň nevidí a na adresu nedosáhne.
    await registerDm(stranger, 'cizinec')
    await expect(stranger.getByText('Soukromá')).toHaveCount(0)
    expect((await stranger.request.get(`/api/campaigns/${campaignId}`)).status()).toBe(404)
    await stranger.goto(`/campaigns/${campaignId}`)
    await expect(stranger.getByRole('heading', { name: 'Moje kampaně' })).toBeVisible()

    // S odkazem od DM se přihlášený cizinec připojí tlačítkem.
    await stranger.goto(`/join/${code}`)
    await expect(stranger.getByText('Pozvánka do kampaně')).toBeVisible()
    await expect(stranger.getByText('Soukromá')).toBeVisible()
    await stranger.getByRole('button', { name: 'Připojit se jako hráč' }).click()
    await expect(stranger).toHaveURL(new RegExp(`/campaigns/${campaignId}$`))
    await expect(stranger.getByText('Hráč', { exact: true }).first()).toBeVisible()
  } finally {
    await phone.close()
  }
})

test('neplatný kód pozvánky ukáže srozumitelnou chybu', async ({ page }) => {
  await registerDm(page, 'kod')
  await page.goto('/join/AAAAAAAAAA')
  await expect(page.getByText('Pozvánka nejde použít')).toBeVisible()
})

test('registrace se špatným kódem se nepovede a vysvětlí proč', async ({ page }) => {
  await page.goto('/register')
  await page.getByLabel('Kód pozvánky nebo registrační heslo').fill('spatny-kod')
  await page.getByLabel('Přihlašovací jméno').fill(uniqueName('x'))
  await page.getByLabel('Heslo', { exact: true }).fill(PASSWORD)
  await page.getByRole('button', { name: 'Vytvořit účet' }).click()
  await expect(page.getByRole('alert')).toContainText('není platné')
  await expect(page).toHaveURL(/\/register/)
})

test('homebrew: DM vytvoří kouzlo, hráč na telefonu ho vidí, cizinec ne; DM ho upraví a smaže', async ({ page: dm, browser, baseURL }) => {
  await registerDm(dm, 'hbdm')
  await dm.getByLabel('Název kampaně').fill('Homebrew kampaň')
  await dm.getByRole('button', { name: 'Založit kampaň' }).click()
  await expect(dm).toHaveURL(/\/campaigns\//)
  const campaignId = dm.url().split('/campaigns/')[1]!
  await dm.getByRole('button', { name: /Vytvořit pozvánku/ }).click()
  const code = (await dm.locator('code').first().textContent())?.trim() ?? ''

  // DM: Pravidla -> vybere kampaň -> nové kouzlo
  await dm.getByRole('link', { name: 'Pravidla' }).click()
  await dm.getByLabel('Homebrew z kampaně').selectOption({ label: 'Homebrew kampaň' })
  await dm.getByRole('link', { name: 'Nové kouzlo' }).click()
  const form = dm.getByRole('region', { name: 'Detail' }) // seznam vlevo má vlastní filtry Úroveň a Škola
  await form.getByLabel('Název', { exact: true }).fill('Ohnivý šíp')
  await form.getByLabel('Úroveň').selectOption('2')
  await form.getByLabel('Škola').selectOption('Evocation')
  await form.getByLabel('Doba seslání').fill('1 action')
  await form.getByLabel('Dosah').fill('60 feet')
  await form.getByLabel('Třídy (oddělené čárkou)').fill('Wizard, Sorcerer')
  await form.getByLabel('Popis', { exact: true }).fill('Vystřelíš šíp z ohně.')
  await form.getByRole('button', { name: 'Uložit' }).click()
  const detail = dm.getByRole('article')
  await expect(detail.getByRole('heading', { name: 'Ohnivý šíp' })).toBeVisible()
  await expect(detail.getByText('Homebrew', { exact: true })).toBeVisible()
  await expect(detail.getByText('60 feet')).toBeVisible()

  // Hráč na telefonu se připojí a homebrew uvidí v seznamu kampaně
  const phone = await newContext(browser, { ...devices['Pixel 7'], baseURL, locale: 'cs-CZ' })
  const player = await phone.newPage()
  const stranger = await newContext(browser, { ...devices['Pixel 7'], baseURL, locale: 'cs-CZ' })
  const outsider = await stranger.newPage()
  try {
    await registerViaUi(player, { username: uniqueName('hbhrac'), startPath: `/join/${code}` })
    await expect(player).toHaveURL(new RegExp(`/campaigns/${campaignId}$`))
    await player.goto(`/rules?g=spells&campaign=${campaignId}&scope=homebrew`)
    await expect(player.getByRole('link', { name: /^Ohnivý šíp/ })).toBeVisible()
    await player.getByRole('link', { name: /^Ohnivý šíp/ }).click()
    await expect(player.getByRole('article').getByRole('heading', { name: 'Ohnivý šíp' })).toBeVisible()
    // hráč cizí homebrew nemůže upravit
    await expect(player.getByRole('link', { name: 'Upravit' })).toHaveCount(0)
    await expectNoHorizontalScroll(player)

    // Cizinec: kampaň v nabídce není, homebrew nevidí ani přes URL
    await registerDm(outsider, 'hbcizi')
    await outsider.goto(`/rules?g=spells&campaign=${campaignId}&q=${encodeURIComponent('Ohnivý šíp')}`)
    await expect(outsider.getByText(/0 záznamů/)).toBeVisible()
    await expect(outsider.getByRole('link', { name: /^Ohnivý šíp/ })).toHaveCount(0)
    const apiRes = await outsider.request.get(`/api/campaigns/${campaignId}/homebrew`)
    expect([404, 405]).toContain(apiRes.status())

    // DM upraví a smaže
    await detail.getByRole('link', { name: 'Upravit' }).click()
    await dm.getByLabel('Název', { exact: true }).fill('Ohnivý šíp II')
    await dm.getByRole('button', { name: 'Uložit' }).click()
    await expect(detail.getByRole('heading', { name: 'Ohnivý šíp II' })).toBeVisible()
    dm.once('dialog', (dialog) => void dialog.accept())
    await detail.getByRole('button', { name: 'Smazat' }).click()
    await expect(dm.getByRole('link', { name: /^Ohnivý šíp/ })).toHaveCount(0)
  } finally {
    await phone.close()
    await stranger.close()
  }
})
