import { devices, type Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { newContext, registerDm, registerViaUi, uniqueName } from './helpers'

// Kostky: klik na dovednost, útok nebo zranění hodí na serveru, výsledek ukáže toast a sdílený log; výhoda, skrytý hod, volný hod.

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

const rollWindow = (page: Page) => page.getByRole('dialog', { name: 'Hod kostkou' })

/** Počká, až kostky dosednou a ukáže se součet; vrátí okno s hodem. */
async function settled(page: Page) {
  const dialog = rollWindow(page)
  await expect(dialog.getByTestId('roll-result-total')).toBeVisible()
  return dialog
}

async function closeRoll(page: Page) {
  await page.keyboard.press('Escape')
  await expect(rollWindow(page)).toHaveCount(0)
}

const log = (page: Page) => page.getByRole('region', { name: 'Log hodů' })

test('hody ze sheetu a volný hod: server losuje, log je sdílený, výhoda a skrytý hod fungují', async ({ page: dm, browser, baseURL, isMobile }) => {
  test.skip(isMobile, 'Tři kontexty si ten test staví sám (DM počítač + dva hráči na telefonu).')
  test.setTimeout(150_000)

  await registerDm(dm, 'dicedm')
  const { campaignId, code } = await newCampaign(dm, 'Kostky')

  const phoneA = await newContext(browser, { ...devices['Pixel 7'], baseURL, locale: 'cs-CZ' })
  const phoneB = await newContext(browser, { ...devices['Pixel 7'], baseURL, locale: 'cs-CZ' })
  const bob = await phoneA.newPage()
  const carol = await phoneB.newPage()
  try {
    await registerViaUi(bob, { username: uniqueName('bob'), startPath: `/join/${code}` })
    await registerViaUi(carol, { username: uniqueName('carol'), startPath: `/join/${code}` })
    const created = await bob.request.post(`/api/campaigns/${campaignId}/characters`, {
      data: { name: 'Bořek', abilityScores: { str: 16, dex: 14, con: 12, int: 10, wis: 10, cha: 10 }, levels: [{ classIndex: 'fighter', hpRoll: null }], skillProficiencies: { athletics: 1 } },
    })
    const charId = (await created.json()).character.id as string
    const item = await bob.request.post(`/api/characters/${charId}/items`, {
      data: { name: 'Plamenný meč', kind: 'weapon', weapon: { damageDice: '1d8', damageType: 'Slashing', category: 'martial', range: 'melee', properties: [], magicBonus: 1, extraDamage: [{ dice: '1d4', type: 'Fire' }] } },
    })
    await bob.request.patch(`/api/characters/${charId}/items/${(await item.json()).item.id}`, { data: { equipped: true } })

    // --- klik na dovednost: okno s točící se kostkou, pak hozené číslo a součet (ne toast)
    await bob.goto(`/characters/${charId}`)
    await expect(bob.getByRole('heading', { name: 'Bořek', level: 1 })).toBeVisible()
    await bob.getByRole('button', { name: /^Hodit: Athletics \(1d20\+5\)$/ }).click() // STR +3, proficiency +2
    await expect(rollWindow(bob).locator('[data-die="20"][data-state="rolling"]')).toBeVisible() // kostka se točí, než dorazí server
    let win = await settled(bob)
    await expect(win.getByText('Athletics', { exact: true })).toBeVisible()
    await expect(win.locator('[data-die="20"][data-state="landed"]')).toHaveCount(1)
    const natural = Number(await win.locator('[data-die="20"] text').first().textContent())
    expect(Number(await win.getByTestId('roll-result-total').getAttribute('data-total'))).toBe(natural + 5)
    await expectNoHorizontalScroll(bob)
    await closeRoll(bob)

    // --- útok a zranění zbraní: +1 magie, +1d4 fire; kritický zásah zdvojí kostky
    await bob.getByRole('button', { name: /^Hodit: Plamenný meč: útok \(1d20\+6\)$/ }).click() // STR 3 + prof 2 + magie 1
    await settled(bob)
    await closeRoll(bob)
    await bob.getByRole('button', { name: /^Hodit: Plamenný meč: zranění \(1d8\+4\+1d4\)$/ }).click()
    win = await settled(bob)
    await expect(win.locator('[data-die]')).toHaveCount(2) // d8 a d4
    await closeRoll(bob)
    await bob.getByRole('button', { name: /^Hodit: Plamenný meč: zranění \(kritický\) \(1d8\+4\+1d4\)$/ }).click()
    win = await settled(bob)
    await expect(win.locator('[data-die]')).toHaveCount(4) // 2d8 a 2d4
    await expect(win.getByText('Kritický zásah: kostky jsou zdvojené')).toBeVisible()
    await closeRoll(bob)

    // --- výhoda: ukážou se oba hody a ten horší je zahozený
    await bob.getByRole('button', { name: 'Výhoda', exact: true }).click()
    await bob.getByRole('button', { name: /^Hodit: Iniciativa/ }).click()
    win = await settled(bob)
    await expect(win.getByTestId('attempt')).toHaveCount(2)
    await expect(win.getByText(/zahozeno/)).toBeVisible()
    await expect(win.getByText(/platí/)).toBeVisible()
    await closeRoll(bob)
    await bob.getByRole('button', { name: 'Normálně' }).click()

    // --- "Hodit znovu" hodí stejný výraz
    await bob.getByRole('button', { name: /^Hodit: Athletics/ }).click()
    await settled(bob)
    await rollWindow(bob).getByRole('button', { name: 'Hodit znovu' }).click()
    win = await settled(bob)
    await expect(win.getByText('1d20+5', { exact: false }).first()).toBeVisible()
    await closeRoll(bob)

    // --- log: otevření panelu kostek, vidí všechno, co hodil
    await bob.getByRole('button', { name: 'Kostky', exact: true }).click()
    const bobDock = bob.getByRole('dialog', { name: 'Kostky' })
    const bobLog = log(bob)
    await expect(bobLog.getByText(/Athletics/).first()).toBeVisible()
    await expect(bobLog.getByText(/Plamenný meč · Plamenný meč: útok|Plamenný meč: útok/)).toBeVisible()
    await expect(bobLog.getByText(/\(kritický\)/).first()).toBeVisible()
    await expect(bobLog.getByText(/výhoda: /)).toBeVisible()
    // zranění s kritem má kostky zdvojené: 2d8 a 2d4 (v rozpisu 4 hody v hranatých závorkách)
    await expect(bobLog.getByText(/1d8\+4\+1d4 \(kritický\)/)).toBeVisible()

    // --- volný hod a rychlá kostka
    await bobDock.getByLabel('Vlastní hod').fill('2d6+3')
    await bobDock.getByRole('button', { name: 'Hodit', exact: true }).click()
    win = await settled(bob)
    await expect(win.locator('[data-die="6"]')).toHaveCount(2)
    await closeRoll(bob)
    await expect(bobLog.getByText(/^2d6\+3 · /)).toBeVisible()
    await bobDock.getByRole('button', { name: 'Hodit d20' }).click()
    await settled(bob)
    await closeRoll(bob)
    await bobDock.getByLabel('Vlastní hod').fill('abc')
    await bobDock.getByRole('button', { name: 'Hodit', exact: true }).click()
    await expect(bob.getByText('Výraz neumím přečíst', { exact: false })).toBeVisible()
    await expect(rollWindow(bob)).toHaveCount(0) // chybný výraz okno s hodem zavře

    // --- skrytý hod: vidí ho Bob a DM, Carol ne
    await bobDock.getByRole('button', { name: 'Skrytý hod (vidí jen DM)' }).click()
    await expect(bobDock.getByRole('button', { name: 'Skrytý hod (vidí jen DM)' })).toHaveAttribute('aria-pressed', 'true')
    await bobDock.getByLabel('Vlastní hod').fill('1d100')
    await bobDock.getByRole('button', { name: 'Hodit', exact: true }).click()
    win = await settled(bob)
    await expect(win.getByText(/skrytý hod/)).toBeVisible()
    await closeRoll(bob)
    await expect(bobLog.getByText(/skrytý/).first()).toBeVisible()

    // --- DM na počítači: vidí veřejné hody i skrytý hod hráče
    await dm.goto(`/campaigns/${campaignId}`)
    await dm.getByRole('button', { name: 'Kostky', exact: true }).click()
    const dmLog = log(dm)
    await expect(dmLog.getByText(/Athletics/).first()).toBeVisible({ timeout: 15_000 })
    await expect(dmLog.getByText(/1d100/)).toBeVisible()
    await expect(dmLog.getByText(/Bořek/).first()).toBeVisible() // hod za postavu nese jméno postavy

    // --- Carol: veřejné hody ano, skrytý ne; za cizí postavu hodit nemůže (na cizím sheetu nemá tlačítka)
    await carol.goto(`/campaigns/${campaignId}`)
    await carol.getByRole('button', { name: 'Kostky', exact: true }).click()
    const carolLog = log(carol)
    await expect(carolLog.getByText(/Athletics/).first()).toBeVisible({ timeout: 15_000 })
    await expect(carolLog.getByText(/1d100/)).toHaveCount(0)
    await expectNoHorizontalScroll(carol)
  } finally {
    await phoneA.close()
    await phoneB.close()
  }
})

test('panel kostek jde použít na telefonu i na počítači (volný hod, bez posouvání do stran)', async ({ page }) => {
  await registerDm(page, 'dicesolo')
  await newCampaign(page, 'Solo kostky')
  await page.getByRole('button', { name: 'Kostky', exact: true }).click()
  await page.getByRole('button', { name: 'Hodit d20' }).click()
  const win = await settled(page)
  await expectNoHorizontalScroll(page)
  const shown = Number(await win.getByTestId('roll-result-total').getAttribute('data-total'))
  await closeRoll(page)
  await expect(log(page).getByTestId('roll-total').first()).toHaveText(/^\d+$/)
  expect(Number(await log(page).getByTestId('roll-total').first().textContent())).toBe(shown) // okno ukázalo totéž, co je v logu
  const total = Number(await log(page).getByTestId('roll-total').first().textContent())
  expect(total).toBeGreaterThanOrEqual(1)
  expect(total).toBeLessThanOrEqual(20)
  await expectNoHorizontalScroll(page)
})

test('Hex na cíli: ke zranění se přidá 1d6 necrotic a jde to vypnout pro jiného protivníka', async ({ page }) => {
  await registerDm(page, 'dicehex')
  const { campaignId } = await newCampaign(page, 'Hex')
  const char = (await (await page.request.post(`/api/campaigns/${campaignId}/characters`, {
    data: { name: 'Čaroděj', abilityScores: { str: 16, dex: 10, con: 12, int: 10, wis: 10, cha: 16 }, levels: [{ classIndex: 'warlock', hpRoll: null }] },
  })).json()).character.id as string
  const item = await page.request.post(`/api/characters/${char}/items`, { data: { name: 'Meč', kind: 'weapon', weapon: { damageDice: '1d8', damageType: 'Slashing', category: 'martial', range: 'melee', properties: [] } } })
  await page.request.patch(`/api/characters/${char}/items/${(await item.json()).item.id}`, { data: { equipped: true } })

  // bez soustředění na Hex se nic nepřidává
  await page.goto(`/characters/${char}`)
  await expect(page.getByRole('button', { name: /^Hodit: Meč: zranění \(1d8\+3\)$/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /Cíl je pod kouzlem/ })).toHaveCount(0)

  // po seslání Hexu (soustředění) se zapne přídavek 1d6 necrotic
  await page.request.patch(`/api/characters/${char}`, { data: { state: { concentration: 'Hex' } } })
  await page.reload()
  const toggle = page.getByRole('button', { name: /Cíl je pod kouzlem Hex/ })
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByText('+ 1d6 necrotic (hex)').first()).toBeVisible()
  await page.getByRole('button', { name: /^Hodit: Meč: zranění \+ Hex \(1d8\+3\+1d6\)$/ }).click()
  const win = await settled(page)
  await expect(win.locator('[data-die]')).toHaveCount(2) // d8 a d6 z Hexu
  await closeRoll(page)
  await page.getByRole('button', { name: /^Hodit: Meč: zranění \+ Hex \(kritický\) \(1d8\+3\+1d6\)$/ }).click()
  await expect((await settled(page)).locator('[data-die]')).toHaveCount(4)
  await closeRoll(page)

  // jiný protivník: přídavek se vypne
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  await expect(page.getByRole('button', { name: /^Hodit: Meč: zranění \(1d8\+3\)$/ })).toBeVisible()
  await expectNoHorizontalScroll(page)

  // vypnutý Hex i zvolená výhoda vydrží zavření a znovuotevření aplikace (a Hex je vypnutý i v Taktikách)
  await page.getByRole('button', { name: 'Výhoda', exact: true }).click()
  await page.reload()
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  await expect(page.getByRole('button', { name: 'Výhoda', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.goto(`/characters/${char}?tab=tactics`)
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  await toggle.click()
  await page.goto(`/characters/${char}`)
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
})
