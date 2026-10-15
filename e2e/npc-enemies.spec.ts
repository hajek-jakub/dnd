import { devices, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { expect, test } from './fixtures'
import { newContext, registerDm, registerViaUi, uniqueName } from './helpers'

// NPC (postava DM bez majitele) a nepřátelé (jen pro DM). DM na počítači, hráč na telefonu.

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow, 'stránka nesmí jezdit do stran').toBeLessThanOrEqual(0)
}

const pc = (name: string) => ({
  name,
  abilityScores: { str: 12, dex: 12, con: 12, int: 12, wis: 12, cha: 12 },
  levels: [{ classIndex: 'fighter', hpRoll: null }],
})

test('NPC: DM ho založí v kampani, hráč ho vidí a může mu předat peníze; nepřátele nevidí', async ({ page: dm, browser, baseURL, isMobile }) => {
  test.skip(isMobile, 'Kontexty si ten test staví sám (DM počítač + hráč na telefonu).')
  await registerDm(dm, 'npcdm')
  await dm.getByLabel('Název kampaně').fill('NPC kampaň')
  await dm.getByRole('button', { name: 'Založit kampaň' }).click()
  await expect(dm).toHaveURL(/\/campaigns\//)
  const campaignId = dm.url().split('/campaigns/')[1]!
  await dm.getByRole('button', { name: /Vytvořit pozvánku/ }).click()
  const code = (await dm.locator('code').first().textContent())?.trim() ?? ''

  // DM nemá vlastní postavu: nenabízí se mu "Nová postava", jen NPC
  await expect(dm.getByRole('link', { name: 'Nová postava' })).toHaveCount(0)
  await expect(dm.getByText('V téhle kampani zatím nemáš postavu.')).toHaveCount(0)

  // dvě NPC přes formulář
  for (const name of ['Batan', 'Barman']) {
    await dm.goto(`/campaigns/${campaignId}`)
    await dm.getByRole('link', { name: 'Nové NPC' }).click()
    await expect(dm.getByRole('heading', { name: 'Nové NPC', level: 1 })).toBeVisible()
    await dm.getByLabel('Jméno postavy').fill(name)
    await dm.getByRole('button', { name: 'Vytvořit NPC' }).click()
    await expect(dm.getByRole('heading', { name, level: 1 })).toBeVisible()
    await expect(dm.getByTestId('npc-badge')).toBeVisible()
  }
  const api = await (await dm.request.get(`/api/campaigns/${campaignId}/characters`)).json()
  expect(api.characters.filter((c: { kind: string; ownerId: unknown }) => c.kind === 'npc' && c.ownerId === null)).toHaveLength(2)

  // nepřítel jen pro DM
  await dm.request.post(`/api/campaigns/${campaignId}/enemies`, { data: { name: 'Tajný Goblin', hpMax: 7 } })

  const phone = await newContext(browser, { ...devices['Pixel 7'], baseURL, locale: 'cs-CZ' })
  const player = await phone.newPage()
  try {
    await registerViaUi(player, { username: uniqueName('hrac'), startPath: `/join/${code}` })
    const playerChar = (await (await player.request.post(`/api/campaigns/${campaignId}/characters`, { data: pc('Hrdina') })).json()).character.id as string
    await dm.request.post(`/api/campaigns/${campaignId}/dm/currency`, { data: { characterIds: [playerChar], currency: { gp: 20 } } })

    // hráč vidí NPC v kampani (bez odkazu na sheet) a nevidí žádné nepřátele
    await player.goto(`/campaigns/${campaignId}`)
    await expect(player.getByRole('heading', { name: 'NPC', exact: true })).toBeVisible()
    await expect(player.getByText('Batan')).toBeVisible()
    await expect(player.getByRole('link', { name: /Batan/ })).toHaveCount(0)
    await expect(player.getByRole('link', { name: 'Nové NPC' })).toHaveCount(0)
    await expect(player.getByText('Tajný Goblin')).toHaveCount(0)
    await expectNoHorizontalScroll(player)

    // hráč dá Batanovi 5 gp
    await player.goto(`/characters/${playerChar}`)
    await player.getByRole('button', { name: 'Inventář', exact: true }).click()
    await player.getByRole('button', { name: 'Předat peníze' }).click()
    const pay = player.getByRole('dialog', { name: 'Předat peníze' })
    await expect(pay.getByLabel('Komu').locator('option', { hasText: 'Batan (NPC)' })).toHaveCount(1)
    await pay.getByLabel('Komu').selectOption({ label: 'Batan (NPC)' })
    await pay.locator('#pay-gp').fill('5')
    await pay.getByRole('button', { name: 'Předat', exact: true }).click()
    await expect(player.getByText('Peníze předány')).toBeVisible()

    const list = (await (await dm.request.get(`/api/campaigns/${campaignId}/characters`)).json()).characters as { name: string; currency: { gp: number } }[]
    expect(list.find((c) => c.name === 'Batan')!.currency.gp).toBe(5)

    // stránka nepřátel je jen pro DM: hráče vrátí na kampaň a API mu nic neřekne
    await player.goto(`/campaigns/${campaignId}/enemies`)
    await expect(player).toHaveURL(new RegExp(`/campaigns/${campaignId}$`))
    const res = await player.request.get(`/api/campaigns/${campaignId}/enemies`)
    expect(res.status()).toBe(403)
    expect(await res.text()).not.toContain('Goblin')
  } finally {
    await phone.close()
  }
})

test('nepřátelé: DM přidá goblina, zapisuje HP, hází skrytě a hráč o hodech nic neví', async ({ page, browser, baseURL, isMobile }) => {
  test.skip(isMobile, 'Kontexty si ten test staví sám (DM počítač + hráč na telefonu).')
  await registerDm(page, 'endm')
  await page.getByLabel('Název kampaně').fill('Bitva')
  await page.getByRole('button', { name: 'Založit kampaň' }).click()
  await expect(page).toHaveURL(/\/campaigns\//)
  const campaignId = page.url().split('/campaigns/')[1]!
  await page.getByRole('button', { name: /Vytvořit pozvánku/ }).click()
  const code = (await page.locator('code').first().textContent())?.trim() ?? ''

  await page.goto(`/campaigns/${campaignId}/dm`)
  await page.getByRole('link', { name: 'Nepřátelé', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Nepřátelé', level: 1 })).toBeVisible()

  // dva goblini najednou, s útokem
  await page.getByRole('button', { name: 'Přidat nepřítele' }).click()
  const form = page.getByRole('dialog', { name: 'Přidat nepřítele' })
  await form.getByLabel('Jméno').fill('Goblin')
  await form.getByLabel('Max HP').fill('7')
  await form.getByLabel('AC').fill('15')
  await form.getByLabel('Kusů').fill('2')
  await form.getByRole('button', { name: 'Přidat útok' }).click()
  await form.getByLabel('Název', { exact: true }).fill('Scimitar')
  await form.getByLabel('Útok +').fill('4')
  await form.getByLabel('Zranění', { exact: true }).fill('1d6+2')
  await form.getByRole('button', { name: 'Uložit' }).click()
  await expect(page.getByTestId('enemy-Goblin')).toBeVisible()
  await expect(page.getByTestId('enemy-Goblin 2')).toBeVisible()
  await expect(page.getByTestId('enemy-Goblin 2')).toContainText('Scimitar')

  // životy: tlačítka i vlastní hodnota, na nule padne
  await expect(page.getByTestId('enemy-hp-Goblin')).toHaveText('7')
  await page.getByRole('button', { name: 'Goblin: −5 HP' }).click()
  await expect(page.getByTestId('enemy-hp-Goblin')).toHaveText('2')
  await page.getByLabel('Goblin: kolik HP').fill('10')
  await page.getByRole('button', { name: 'Goblin: zranit' }).click()
  await expect(page.getByTestId('enemy-hp-Goblin')).toHaveText('0')
  await expect(page.getByTestId('enemy-Goblin')).toContainText('Padl')
  await page.getByLabel('Goblin: kolik HP').fill('3')
  await page.getByRole('button', { name: 'Goblin: léčit' }).click()
  await expect(page.getByTestId('enemy-hp-Goblin')).toHaveText('3')
  await expect(page.getByTestId('enemy-Goblin')).not.toContainText('Padl')

  // úprava a smazání
  await page.getByRole('button', { name: 'Upravit Goblin 2' }).click()
  await page.getByRole('dialog', { name: /Upravit: Goblin 2/ }).getByLabel('Jméno').fill('Goblin šaman')
  await page.getByRole('dialog', { name: /Upravit: Goblin 2/ }).getByRole('button', { name: 'Uložit' }).click()
  await expect(page.getByTestId('enemy-Goblin šaman')).toBeVisible()
  page.once('dialog', (d) => void d.accept())
  await page.getByRole('button', { name: 'Smazat Goblin šaman' }).click()
  await expect(page.getByTestId('enemy-Goblin šaman')).toHaveCount(0)
  await expectNoHorizontalScroll(page)

  // hody jsou výchozí skryté: DM vidí výsledek, hráč v logu nic
  await page.getByRole('button', { name: 'Hodit: Goblin: Scimitar zranění', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Hod kostkou' })
  await expect(dialog.getByTestId('roll-result-total')).toBeVisible()
  await expect(dialog).toContainText('1d6+2')
  await page.keyboard.press('Escape')

  const phone = await newContext(browser, { ...devices['Pixel 7'], baseURL, locale: 'cs-CZ' })
  const player = await phone.newPage()
  try {
    await registerViaUi(player, { username: uniqueName('hrac'), startPath: `/join/${code}` })
    const rolls = await (await player.request.get(`/api/campaigns/${campaignId}/rolls`)).text()
    expect(rolls).not.toContain('Scimitar')
    const dmRolls = await (await page.request.get(`/api/campaigns/${campaignId}/rolls`)).text()
    expect(dmRolls).toContain('Scimitar')
  } finally {
    await phone.close()
  }

  // přístupnost stránky nepřátel
  await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; animation: none !important; }' })
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([])
})
