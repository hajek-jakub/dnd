import { devices, type Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { newContext, registerDm, registerViaUi, uniqueName } from './helpers'

// Panel DM: DM rozdává na počítači, hráč to na telefonu hned vidí a dostane oznámení.

const fighter = (name: string) => ({
  name,
  abilityScores: { str: 12, dex: 12, con: 12, int: 12, wis: 12, cha: 12 },
  levels: [{ classIndex: 'fighter', hpRoll: null }],
})

async function newCampaign(page: Page, name: string): Promise<{ campaignId: string; code: string }> {
  await page.getByLabel('Název kampaně').fill(name)
  await page.getByRole('button', { name: 'Založit kampaň' }).click()
  await expect(page).toHaveURL(/\/campaigns\//)
  const campaignId = page.url().split('/campaigns/')[1]!
  await page.getByRole('button', { name: /Vytvořit pozvánku/ }).click()
  const code = (await page.locator('code').first().textContent())?.trim() ?? ''
  return { campaignId, code }
}

test('DM rozdá item, XP, bonus a stav; hráč na telefonu dostane oznámení a vidí změny', async ({ page: dm, browser, baseURL, isMobile }) => {
  test.skip(isMobile, 'Dva kontexty si ten test staví sám (DM počítač + hráč telefon).')
  test.setTimeout(120_000)

  await registerDm(dm, 'dmpanel')
  const { campaignId, code } = await newCampaign(dm, 'Panel kampaň')

  const phone = await newContext(browser, { ...devices['Pixel 7'], baseURL, locale: 'cs-CZ' })
  const player = await phone.newPage()
  try {
    await registerViaUi(player, { username: uniqueName('hrac'), startPath: `/join/${code}` })
    const playerChar = (await (await player.request.post(`/api/campaigns/${campaignId}/characters`, { data: fighter('Elfka') })).json()).character.id as string
    await player.goto(`/characters/${playerChar}`)
    await expect(player.getByRole('heading', { name: 'Elfka', level: 1 })).toBeVisible()
    await expect(player.getByRole('button', { name: /^Armor Class: 11/ })).toBeVisible()
    await expect(player.getByRole('link', { name: 'Oznámení' })).toBeVisible()

    // DM otevře panel; hráč tam není pro nic jiného než pro obrazovku DM
    await dm.getByRole('link', { name: 'Panel DM' }).click()
    await expect(dm.getByRole('heading', { name: 'Panel DM' })).toBeVisible()
    const elfka = dm.getByRole('listitem').filter({ hasText: 'Elfka' }).first()
    await expect(elfka).toContainText('AC')
    await expect(dm.getByRole('button', { name: 'Item', exact: true })).toBeDisabled() // bez výběru nejde nic dát

    await dm.getByLabel('Vybrat Elfka').check()

    // item z pravidel
    await dm.getByRole('button', { name: 'Item', exact: true }).click()
    const itemDialog = dm.getByRole('dialog', { name: 'Dát item' })
    await itemDialog.getByLabel('Hledat item').fill('Bag of Holding')
    await itemDialog.getByRole('button', { name: 'Dát Bag of Holding' }).click()
    await expect(dm.getByText('Předáno: Bag of Holding')).toBeVisible()

    // hráč na telefonu uvidí toast i nepřečtené oznámení
    await expect(player.getByText('DM ti dal: Bag of Holding').first()).toBeVisible({ timeout: 45_000 })
    await expect(player.getByTestId('unread-badge')).toHaveText('1')

    // XP
    await dm.getByRole('button', { name: 'XP', exact: true }).click()
    await dm.getByLabel('Kolik XP').fill('150')
    await dm.getByRole('button', { name: 'Dát XP' }).click()
    await expect(dm.getByText('Přidáno 150 XP')).toBeVisible()
    await expect(elfka).toContainText('150 XP')

    // bonus +2 AC do long restu
    await dm.getByRole('button', { name: 'Bonus', exact: true }).click()
    const effect = dm.getByRole('dialog', { name: 'Bonus nebo efekt' })
    await effect.getByLabel('Hodnota').fill('2')
    await effect.getByLabel(/Zdroj/).fill('Shield of Faith')
    await effect.getByLabel('Trvání').selectOption('long_rest')
    await effect.getByRole('button', { name: 'Přidat bonus' }).click()
    await expect(dm.getByText('Bonus přidán')).toBeVisible()
    await expect(elfka.getByRole('list', { name: 'Bonusy' })).toContainText('Shield of Faith')

    // stav
    await dm.getByRole('button', { name: 'Stav', exact: true }).click()
    await dm.getByRole('dialog', { name: 'Stav postavy' }).getByRole('button', { name: 'Nastavit stav' }).click()
    await expect(elfka.getByRole('list', { name: 'Stavy' })).toContainText('Poisoned')

    // zranění
    await dm.getByRole('button', { name: 'Zranění / léčení' }).click()
    await dm.getByLabel('Kolik HP').fill('3')
    await dm.getByRole('button', { name: 'Způsobit zranění' }).click()
    await expect(dm.getByText('Zranění uděleno')).toBeVisible()
    await expect(dm.getByTestId('hp-Elfka')).toHaveText('8') // fighter 10 + CON 1 = 11, po 3 zranění 8

    // hráč vidí bonus s původem, AC 13, stav, a HP
    await player.getByRole('button', { name: 'Armor Class: 13' }).waitFor({ timeout: 45_000 })
    await expect(player.getByText('Shield of Faith')).toBeVisible()
    await expect(player.getByText('do long restu')).toBeVisible()
    await expect(player.getByRole('list', { name: 'Stavy' })).toContainText('Poisoned')
    await expect(player.getByRole('button', { name: 'Zrušit bonus Shield of Faith' })).toHaveCount(0) // hráč bonus zrušit nemůže

    // oznámení v seznamu
    await player.getByRole('link', { name: /Oznámení/ }).click()
    await expect(player.getByRole('heading', { name: 'Oznámení' })).toBeVisible()
    await expect(player.getByText('DM ti dal 150 XP')).toBeVisible()
    await expect(player.getByText('DM ti způsobil 3 zranění')).toBeVisible()
    await expect(player.getByText('DM ti nastavil stav: Poisoned')).toBeVisible()
    await expect(player.getByText('DM ti přidal bonus: +2 AC (Shield of Faith)')).toBeVisible()
    await expect(player.getByTestId('unread-badge')).toHaveCount(0, { timeout: 30_000 }) // otevřením se označí jako přečtené

    // long rest bonus zruší
    await player.goto(`/characters/${playerChar}`)
    await player.getByRole('button', { name: 'Long rest' }).click()
    await player.getByRole('dialog', { name: 'Long rest' }).getByRole('button', { name: 'Dát si long rest' }).click()
    await expect(player.getByRole('button', { name: /^Armor Class: 11/ })).toBeVisible()
    await expect(player.getByText('Shield of Faith')).toHaveCount(0)

    // DM ruší stav a přidá bonus bez expirace, který pak zruší
    await dm.getByLabel('Vybrat Elfka').check()
    await dm.getByRole('button', { name: 'Bonus', exact: true }).click()
    const again = dm.getByRole('dialog', { name: 'Bonus nebo efekt' })
    await again.getByLabel(/Zdroj/).fill('Bless')
    await again.getByRole('button', { name: 'Přidat bonus' }).click()
    await expect(elfka.getByRole('list', { name: 'Bonusy' })).toContainText('Bless')
    await dm.getByRole('button', { name: 'Zrušit bonus Bless u Elfka' }).click()
    await expect(dm.getByText('Bonus zrušen')).toBeVisible()
    await expect(elfka.getByRole('list', { name: 'Bonusy' })).toHaveCount(0)
  } finally {
    await phone.close()
  }
})

test('hráč panel DM nevidí a poznámky DM zůstávají soukromé', async ({ page: dm, browser, baseURL, isMobile }) => {
  test.skip(isMobile, 'Dva kontexty.')
  await registerDm(dm, 'dmpriv')
  const { campaignId, code } = await newCampaign(dm, 'Soukromí')

  const phone = await newContext(browser, { ...devices['Pixel 7'], baseURL, locale: 'cs-CZ' })
  const player = await phone.newPage()
  try {
    await registerViaUi(player, { username: uniqueName('hrac'), startPath: `/join/${code}` })
    await player.goto(`/campaigns/${campaignId}`)
    await expect(player.getByRole('link', { name: 'Panel DM' })).toHaveCount(0)
    await player.goto(`/campaigns/${campaignId}/dm`)
    await expect(player).toHaveURL(new RegExp(`/campaigns/${campaignId}$`)) // přesměrován zpět

    await dm.goto(`/campaigns/${campaignId}/dm`)
    await dm.getByLabel('Nová poznámka').fill('Zrádce je kovář')
    await dm.getByRole('button', { name: 'Uložit poznámku' }).click()
    await expect(dm.getByText('Zrádce je kovář')).toBeVisible()

    const res = await player.request.get(`/api/campaigns/${campaignId}/dm-notes`)
    expect(res.status()).toBe(403)
    expect(await res.text()).not.toContain('kovář')
  } finally {
    await phone.close()
  }
})

test('panel DM jde používat i na telefonu (bez posouvání do stran)', async ({ page }) => {
  await registerDm(page, 'dmphone')
  const { campaignId } = await newCampaign(page, 'Telefon')
  await page.request.post(`/api/campaigns/${campaignId}/characters`, { data: fighter('Tank') })
  await page.request.post(`/api/campaigns/${campaignId}/characters`, { data: fighter('Mág') })

  await page.goto(`/campaigns/${campaignId}/dm`)
  await expect(page.getByRole('heading', { name: 'Panel DM' })).toBeVisible()
  await expect(page.getByLabel('Vybrat Tank')).toBeVisible()

  await page.getByRole('button', { name: 'Vybrat všechny' }).click()
  await expect(page.getByText(/Vybráno:\s*2 z 2/)).toBeVisible()
  await page.getByRole('button', { name: 'Peníze', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Dát peníze' })
  await dialog.getByLabel('GP', { exact: true }).fill('25')
  await dialog.getByRole('button', { name: 'Dát peníze' }).click()
  await expect(page.getByText('Peníze předány')).toBeVisible()

  // rychlé tlačítko HP na kartě
  await page.getByRole('button', { name: 'Tank: −5 HP' }).click()
  await expect(page.getByTestId('hp-Tank')).toHaveText('6')

  // dočasná HP pro vybrané a zrušení stavu jedním klepnutím na štítek
  await page.getByRole('button', { name: 'Dočasná HP', exact: true }).click()
  await page.getByRole('dialog', { name: 'Dočasná HP' }).getByLabel('Kolik dočasných HP').fill('5')
  await page.getByRole('dialog', { name: 'Dočasná HP' }).getByRole('button', { name: 'Nastavit dočasná HP' }).click()
  await expect(page.getByText('Dočasná HP nastavena')).toBeVisible()
  await expect(page.getByRole('listitem').filter({ hasText: 'Tank' }).first()).toContainText('+5 dočasná')
  await page.getByRole('button', { name: 'Stav', exact: true }).click()
  await page.getByRole('dialog', { name: 'Stav postavy' }).getByRole('button', { name: 'Nastavit stav' }).click()
  await expect(page.getByRole('button', { name: 'Zrušit stav Poisoned u Tank' })).toBeVisible()
  await page.getByRole('button', { name: 'Zrušit stav Poisoned u Tank' }).click()
  await expect(page.getByRole('button', { name: 'Zrušit stav Poisoned u Tank' })).toHaveCount(0)

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow, 'stránka nesmí jezdit do stran').toBeLessThanOrEqual(0)

  // peníze skutečně dorazily k oběma
  for (const name of ['Tank', 'Mág']) {
    const list = await (await page.request.get(`/api/campaigns/${campaignId}/characters`)).json()
    const c = list.characters.find((x: { name: string }) => x.name === name)
    expect(c.currency.gp).toBeGreaterThanOrEqual(25)
  }
})

test('peníze v panelu DM: rozdělit rovným dílem, vzít a náhled částky', async ({ page }) => {
  await registerDm(page, 'dmcoins')
  const { campaignId } = await newCampaign(page, 'Pokladna')
  for (const name of ['Aja', 'Bob', 'Cyra']) await page.request.post(`/api/campaigns/${campaignId}/characters`, { data: fighter(name) })
  const wallets = async () => {
    const list = await (await page.request.get(`/api/campaigns/${campaignId}/characters`)).json()
    return Object.fromEntries(list.characters.map((c: { name: string; currency: Record<string, number> }) => [c.name, c.currency]))
  }

  await page.goto(`/campaigns/${campaignId}/dm`)
  await page.getByRole('button', { name: 'Vybrat všechny' }).click()
  await page.getByRole('button', { name: 'Peníze', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Dát peníze' })

  // 10 gp mezi 3: po 3 gp, 3 sp a 3 cp, jeden měďák zůstane
  await dialog.getByLabel('GP', { exact: true }).fill('10')
  await expect(dialog.getByTestId('coin-preview')).toContainText('Každý dostane celou částku: 10 gp')
  await dialog.getByLabel(/Rozdělit rovným dílem/).check()
  await expect(dialog.getByTestId('coin-preview')).toContainText('Každý dostane: 3 gp, 3 sp, 3 cp')
  await expect(dialog.getByTestId('coin-preview')).toContainText('Zbytek 1 cp')
  await dialog.getByLabel('Důvod (nepovinné, uvidí ho hráč v oznámení)').fill('poklad ze sklepa')
  await dialog.getByRole('button', { name: 'Dát peníze' }).click()
  await expect(page.getByText(/Každý dostal 3 gp, 3 sp, 3 cp/)).toBeVisible()
  expect((await wallets()).Bob).toMatchObject({ gp: 3, sp: 3, cp: 3 })

  // vzít 6 gp rozdělených mezi 3 = po 2 gp, drobné se vrací
  await page.getByRole('button', { name: 'Peníze', exact: true }).click()
  const take = page.getByRole('dialog', { name: 'Dát peníze' })
  await take.getByRole('button', { name: 'Vzít', exact: true }).click()
  await take.getByLabel('GP', { exact: true }).fill('6')
  await take.getByLabel(/Rozdělit rovným dílem/).check()
  await expect(take.getByTestId('coin-preview')).toContainText('Každý zaplatí: 2 gp')
  await take.getByRole('button', { name: 'Vzít peníze' }).click()
  await expect(page.getByText(/Každý zaplatil 2 gp/)).toBeVisible()
  expect((await wallets()).Cyra).toMatchObject({ gp: 1, sp: 3, cp: 3 })

  // nikdo nemá dost: chyba a nikomu se nic neodebralo
  await page.getByRole('button', { name: 'Peníze', exact: true }).click()
  const broke = page.getByRole('dialog', { name: 'Dát peníze' })
  await broke.getByRole('button', { name: 'Vzít', exact: true }).click()
  await broke.getByLabel('PP', { exact: true }).fill('5')
  await broke.getByRole('button', { name: 'Vzít peníze' }).click()
  await expect(page.getByText(/Nemá dost peněz/)).toBeVisible()
  expect((await wallets()).Aja).toMatchObject({ gp: 1, sp: 3, cp: 3 })

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow, 'stránka nesmí jezdit do stran').toBeLessThanOrEqual(0)
})
