import { devices, type Page } from '@playwright/test'
import { makePng } from '../test-utils/png'
import { expect, test } from './fixtures'
import { newContext, registerDm, registerViaUi, uniqueName } from './helpers'

// Mapy: DM nahraje a zveřejní mapu a přidává body na počítači, hráč je vidí na telefonu a píše si soukromé poznámky.

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

async function uploadMap(page: Page, campaignId: string, name: string) {
  await page.goto(`/campaigns/${campaignId}/maps`)
  await page.getByLabel('Název mapy').fill(name)
  await page.getByLabel(/^Obrázek/).setInputFiles({ name: 'mapa.png', mimeType: 'image/png', buffer: Buffer.from(makePng(800, 600, [60, 140, 80])) })
  await page.getByRole('button', { name: 'Nahrát' }).click()
  await expect(page.getByText('Mapa nahrána')).toBeVisible()
}

/** Přidá bod kliknutím doprostřed mapy (dolů a doprava podle `shift`), vyplní formulář a vrátí se do výběru bodu. */
async function addPin(page: Page, addLabel: string, title: string, options: { shift?: number; icon?: string; visibility?: string; viewers?: string[] } = {}) {
  await page.getByRole('button', { name: addLabel }).click()
  const canvas = page.getByTestId('map-canvas')
  await expect(canvas).toHaveAttribute('data-add-mode', 'true')
  // režim přidávání nesmí mapě vzít třídy Leafletu (jinak zmizí obrázek a klepnutí nefunguje)
  await expect(canvas).toHaveClass(/leaflet-container/)
  await expect(canvas).toHaveClass(/leaflet-crosshair/)
  await expect(page.locator('.leaflet-image-layer')).toBeVisible()
  const box = (await canvas.boundingBox())!
  await canvas.click({ position: { x: box.width / 2 + (options.shift ?? 0), y: box.height / 2 + (options.shift ?? 0) } })
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Název').fill(title)
  if (options.icon) await dialog.getByRole('button', { name: options.icon }).click()
  if (options.visibility) await dialog.getByLabel('Kdo bod uvidí').selectOption(options.visibility)
  for (const v of options.viewers ?? []) await dialog.getByRole('checkbox', { name: v }).check()
  await dialog.getByRole('button', { name: /Přidat na mapu|Uložit/ }).click()
  await expect(page.getByRole('heading', { name: title, level: 2 })).toBeVisible()
}

test('DM nahraje a zveřejní mapu, přidá body; hráč na telefonu vidí jen to, co smí, a píše si soukromé poznámky', async ({ page: dm, browser, baseURL, isMobile }) => {
  test.skip(isMobile, 'Dva kontexty si ten test staví sám (DM počítač + hráč telefon).')

  await registerDm(dm, 'mapdm')
  const { campaignId, code } = await newCampaign(dm, 'Mapová kampaň')
  const phone = await newContext(browser, { ...devices['Pixel 7'], baseURL, locale: 'cs-CZ' })
  const player = await phone.newPage()
  try {
    const playerName = uniqueName('hrac')
    await registerViaUi(player, { username: playerName, startPath: `/join/${code}` })

    // --- nahrání: mapa je zprvu skrytá
    await uploadMap(dm, campaignId, 'Vesnice')
    const card = dm.getByRole('listitem').filter({ hasText: 'Vesnice' })
    await expect(card).toContainText('Skrytá před hráči')
    await player.goto(`/campaigns/${campaignId}/maps`)
    await expect(player.getByText('DM zatím žádnou mapu nezveřejnil.')).toBeVisible()
    await expect(player.getByRole('button', { name: /Zveřejnit|Skrýt/ })).toHaveCount(0)
    await expect(player.getByLabel('Název mapy')).toHaveCount(0) // hráč nahrávat nemůže

    // --- zveřejnění
    await card.getByRole('button', { name: 'Zveřejnit' }).click()
    await expect(card).toContainText('Hráči ji vidí')
    await player.reload()
    await expect(player.getByRole('link', { name: /Vesnice/ })).toBeVisible()

    // --- DM přidává body: pro všechny a jen pro sebe
    await dm.getByRole('link', { name: /Vesnice/ }).click()
    await expect(dm.locator('.leaflet-image-layer')).toBeVisible()
    await addPin(dm, 'Přidat bod', 'Hospoda U Draka', { icon: 'Město', visibility: 'all' })
    await addPin(dm, 'Přidat bod', 'Past v lese', { shift: 120, icon: 'Nebezpečí', visibility: 'dm' })
    const dmList = dm.getByRole('region', { name: 'Seznam bodů' })
    await expect(dmList.getByText('Hospoda U Draka')).toBeVisible()
    await expect(dmList.getByText('Past v lese')).toBeVisible()
    await expect(dm.locator('.leaflet-marker-icon')).toHaveCount(2)

    // --- hráč na telefonu: vidí hospodu, past ne
    await player.getByRole('link', { name: /Vesnice/ }).click()
    await expect(player.locator('.leaflet-image-layer')).toBeVisible()
    const playerList = player.getByRole('region', { name: 'Seznam bodů' })
    await expect(playerList.getByText('Hospoda U Draka')).toBeVisible()
    await expect(playerList.getByText('Past v lese')).toHaveCount(0)
    await expect(player.locator('.leaflet-marker-icon')).toHaveCount(1)
    await expectNoHorizontalScroll(player)

    // bod DM hráč nemůže měnit ani smazat
    await playerList.getByRole('button', { name: /Hospoda U Draka/ }).click()
    await expect(player.getByRole('heading', { name: 'Hospoda U Draka', level: 2 })).toBeVisible()
    await expect(player.getByRole('button', { name: 'Upravit' })).toHaveCount(0)
    await expect(player.getByRole('button', { name: /Smazat bod/ })).toHaveCount(0)

    // --- soukromá poznámka hráče: vidí ji jen on
    await addPin(player, 'Přidat poznámku', 'Možná tu je zrádce', { shift: -100 })
    await expect(player.getByText('Soukromá poznámka (vidíš jen ty) · ty')).toBeVisible()
    await expect(player.locator('.leaflet-marker-icon')).toHaveCount(2)
    await dm.reload()
    await expect(dm.getByRole('region', { name: 'Seznam bodů' }).getByText('Možná tu je zrádce')).toHaveCount(0)
    await expect(dm.locator('.leaflet-marker-icon')).toHaveCount(2)

    // poznámku hráč upraví a smaže
    await player.getByRole('button', { name: 'Upravit' }).click()
    await player.getByRole('dialog').getByLabel('Název').fill('Zrádce je kovář')
    await player.getByRole('dialog').getByRole('button', { name: 'Uložit' }).click()
    await expect(player.getByRole('heading', { name: 'Zrádce je kovář', level: 2 })).toBeVisible()
    player.once('dialog', (d) => void d.accept())
    await player.getByRole('button', { name: /Smazat bod/ }).click()
    await expect(player.getByText('Zrádce je kovář')).toHaveCount(0)

    // --- DM mapu skryje: hráč o ní nic neví
    await dm.goto(`/campaigns/${campaignId}/maps`)
    await dm.getByRole('listitem').filter({ hasText: 'Vesnice' }).getByRole('button', { name: 'Skrýt' }).click()
    await player.reload()
    await expect(player.getByText('Mapa nenalezena')).toBeVisible()
  } finally {
    await phone.close()
  }
})

test('mapa jde prohlížet a upravovat na telefonu i na počítači bez posouvání do stran a hlavička zůstává nad mapou', async ({ page }) => {
  await registerDm(page, 'mapsolo')
  const { campaignId } = await newCampaign(page, 'Mapa sám')
  await uploadMap(page, campaignId, 'Podzemí')
  await page.getByRole('link', { name: /Podzemí/ }).click()
  await expect(page.locator('.leaflet-image-layer')).toBeVisible()
  await expectNoHorizontalScroll(page)

  await addPin(page, 'Přidat bod', 'Truhla', { icon: 'Poklad' })
  await expect(page.locator('.leaflet-marker-icon')).toHaveCount(1)

  // přesouvání bodů: zapnutí režimu a tah značky na jiné místo se uloží
  const marker = page.locator('.leaflet-marker-icon').first()
  const before = (await marker.boundingBox())!
  await page.getByRole('button', { name: 'Přesouvat body' }).click()
  await marker.hover()
  await page.mouse.down()
  await page.mouse.move(before.x + before.width / 2 + 60, before.y + before.height / 2 + 40, { steps: 8 })
  await page.mouse.up()
  await page.reload()
  const after = (await page.locator('.leaflet-marker-icon').first().boundingBox())!
  expect(Math.abs(after.x - before.x) + Math.abs(after.y - before.y), 'bod se přesunul').toBeGreaterThan(20)

  // sticky hlavička nesmí zmizet pod mapou (Leaflet má vysoké z-index)
  await page.evaluate(() => window.scrollTo(0, 200))
  const headerOnTop = await page.evaluate(() => document.elementFromPoint(window.innerWidth / 2, 20)?.closest('header') !== null)
  expect(headerOnTop).toBe(true)
  await expectNoHorizontalScroll(page)
})
