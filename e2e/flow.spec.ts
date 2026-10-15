import { devices, expect, test, type Page } from '@playwright/test'
import { accessToken, login, supabaseEnv, uniqueEmail } from './helpers'

// Hlavní scénář: DM na počítači, hráč na telefonu (dvě oddělené relace).
// Spouští se v projektu "desktop"; hráčův kontext si vyrobí jako Pixel 7.

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(0)
}

test('DM na počítači pozve hráče, hráč se z telefonu připojí a nevidí nic navíc', async ({ page: dm, browser, baseURL }) => {
  const { url, anonKey } = supabaseEnv()
  const rest = (token: string) => ({ apikey: anonKey, Authorization: `Bearer ${token}` })

  // ---- DM (počítač): přihlášení, kampaň, pozvánka
  await login(dm, uniqueEmail('dm'))
  await dm.getByLabel('Název kampaně').fill('Ztracený důl')
  await dm.getByRole('button', { name: 'Založit kampaň' }).click()
  await expect(dm.getByRole('heading', { name: 'Ztracený důl' })).toBeVisible()
  await expect(dm.getByText('Dungeon Master').first()).toBeVisible()
  const campaignUrl = dm.url()

  await dm.getByRole('button', { name: /Vytvořit pozvánku/ }).click()
  const code = (await dm.locator('code').first().textContent())?.trim() ?? ''
  expect(code).toMatch(/^[A-HJKMNP-Z2-9]{10}$/)

  // ---- Hráč (telefon)
  const phone = await browser.newContext({ ...devices['Pixel 7'], baseURL, locale: 'cs-CZ' })
  const player = await phone.newPage()
  try {
    // Přijde přes odkaz od DM, takže se nejdřív musí přihlásit a pak se vrátí na pozvánku.
    await login(player, uniqueEmail('hrac'), `/join/${code}`)
    await expect(player.getByText('Pozvánka do kampaně')).toBeVisible()
    await expect(player.getByText('Ztracený důl')).toBeVisible()
    await expectNoHorizontalScroll(player)

    // Dokud hráč pozvánku nepřijme, přes API nesmí vidět nic z kampaně.
    const token = await accessToken(player)
    for (const table of ['campaigns', 'campaign_members', 'invites', 'characters', 'dm_notes']) {
      const res = await player.request.get(`${url}/rest/v1/${table}?select=*`, { headers: rest(token) })
      expect(res.ok(), `${table}: dotaz musí projít`).toBeTruthy()
      expect(await res.json(), `${table}: cizí kampaň nesmí být vidět`).toEqual([])
    }

    await player.getByRole('button', { name: 'Připojit se jako hráč' }).click()
    await expect(player).toHaveURL(/\/campaigns\//)
    await expect(player.getByRole('heading', { name: 'Ztracený důl' })).toBeVisible()
    await expect(player.getByText('Hráč').first()).toBeVisible()
    await expectNoHorizontalScroll(player)

    // UI hráči nenabízí DM věci.
    await expect(player.getByRole('heading', { name: 'Pozvánky' })).toHaveCount(0)
    await expect(player.getByRole('button', { name: 'Smazat kampaň' })).toHaveCount(0)
    await expect(player.getByRole('button', { name: 'Odejít z kampaně' })).toBeVisible()

    // A přes API (obejití UI) hráč DM věci opravdu nedostane ani neprovede.
    const invites = await player.request.get(`${url}/rest/v1/invites?select=*`, { headers: rest(token) })
    expect(await invites.json(), 'hráč nesmí číst pozvánky').toEqual([])

    const campaignId = campaignUrl.split('/campaigns/')[1]!
    const createInvite = await player.request.post(`${url}/rest/v1/rpc/create_invite`, {
      headers: rest(token),
      data: { p_campaign_id: campaignId },
    })
    expect(createInvite.ok(), 'hráč nesmí vytvářet pozvánky').toBeFalsy()

    const rename = await player.request.patch(`${url}/rest/v1/campaigns?id=eq.${campaignId}`, {
      headers: { ...rest(token), Prefer: 'return=representation', 'Content-Type': 'application/json' },
      data: { name: 'Hacknuto' },
    })
    expect(await rename.json(), 'hráč nesmí kampaň přejmenovat').toEqual([])

    // ---- DM na počítači vidí nového člena
    await dm.reload()
    await expect(dm.locator('li', { hasText: /^hrac/ })).toBeVisible()
    await expect(dm.getByRole('heading', { name: 'Ztracený důl' })).toBeVisible()

    // ---- Hráč odejde z kampaně (potvrzení v dialogu)
    player.once('dialog', (dialog) => void dialog.accept())
    await player.getByRole('button', { name: 'Odejít z kampaně' }).click()
    await expect(player).toHaveURL(/\/$/)
    await expect(player.getByText('Ztracený důl')).toHaveCount(0)

    // DM ho po obnovení už v seznamu nemá
    await dm.reload()
    await expect(dm.locator('li', { hasText: /^hrac/ })).toHaveCount(0)
  } finally {
    await phone.close()
  }
})

test('neplatný kód pozvánky ukáže srozumitelnou chybu', async ({ page }) => {
  await login(page, uniqueEmail('kod'), '/join/AAAAAAAAAA')
  await expect(page.getByText('Pozvánka nejde použít')).toBeVisible()
})
