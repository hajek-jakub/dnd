import { devices, type Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { newContext, registerDm, registerViaUi, uniqueName } from './helpers'

// Zprávy: DM na počítači, dva hráči na telefonech. Soukromé a tajné zprávy vidí jen ti, komu patří.

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

async function write(page: Page, text: string) {
  await page.getByLabel('Zpráva', { exact: true }).fill(text)
  await page.getByRole('button', { name: 'Odeslat' }).click()
  await expect(page.getByRole('log', { name: 'Zprávy' }).getByText(text)).toBeVisible()
}

test('skupinový chat, soukromě DM a hráč a tajná zpráva: každý vidí jen svoje', async ({ page: dm, browser, baseURL, isMobile }) => {
  test.skip(isMobile, 'Tři kontexty si ten test staví sám (DM počítač + dva hráči na telefonu).')

  await registerDm(dm, 'chatdm')
  const { campaignId, code } = await newCampaign(dm, 'Chat')

  const phoneA = await newContext(browser, { ...devices['Pixel 7'], baseURL, locale: 'cs-CZ' })
  const phoneB = await newContext(browser, { ...devices['Pixel 7'], baseURL, locale: 'cs-CZ' })
  const bob = await phoneA.newPage()
  const carol = await phoneB.newPage()
  try {
    const bobName = uniqueName('bob')
    const carolName = uniqueName('carol')
    await registerViaUi(bob, { username: bobName, startPath: `/join/${code}` })
    await registerViaUi(carol, { username: carolName, startPath: `/join/${code}` })
    for (const p of [dm, bob, carol]) await p.goto(`/campaigns/${campaignId}/messages`)

    // --- skupina: telefon vidí nejdřív seznam vláken, po kliknutí vlákno
    await expect(bob.getByRole('navigation', { name: 'Vlákna zpráv' })).toBeVisible()
    await bob.getByRole('button', { name: /Skupina/ }).click()
    await write(bob, 'Ahoj všem od Boba')
    await expectNoHorizontalScroll(bob)
    await expect(dm.getByRole('log', { name: 'Zprávy' }).getByText('Ahoj všem od Boba')).toBeVisible({ timeout: 15_000 }) // počítač: skupina je rovnou otevřená
    await carol.getByRole('button', { name: /Skupina/ }).click()
    await expect(carol.getByRole('log', { name: 'Zprávy' }).getByText('Ahoj všem od Boba')).toBeVisible({ timeout: 15_000 })

    // --- soukromě: Bob píše DM, Carol to nevidí
    await bob.getByRole('button', { name: 'Zpět na vlákna' }).click()
    await bob.getByRole('button', { name: /\(DM\)/ }).click()
    await write(bob, 'Bobovo soukromé tajemství')

    // DM vidí nepřečtené u Boba a po otevření konverzaci
    await dm.getByRole('button', { name: new RegExp(bobName) }).click()
    await expect(dm.getByRole('log', { name: 'Zprávy' }).getByText('Bobovo soukromé tajemství')).toBeVisible({ timeout: 15_000 })
    await write(dm, 'Odpověď DM pro Boba')

    await expect(bob.getByRole('log', { name: 'Zprávy' }).getByText('Odpověď DM pro Boba')).toBeVisible({ timeout: 15_000 })

    await carol.getByRole('button', { name: 'Zpět na vlákna' }).click()
    await carol.getByRole('button', { name: /\(DM\)/ }).click()
    await expect(carol.getByRole('log', { name: 'Zprávy' }).getByText('Zatím tu nic není.')).toBeVisible()
    await expect(carol.getByText('Bobovo soukromé tajemství')).toHaveCount(0)
    await expect(carol.getByText('Odpověď DM pro Boba')).toHaveCount(0)

    // --- tajná zpráva pro Boba i Carol (jeden příjemce nestačí)
    await dm.getByRole('button', { name: /Tajné zprávy/ }).click()
    await dm.getByLabel('Zpráva', { exact: true }).fill('Zrádce je kovář')
    await dm.getByRole('checkbox', { name: bobName }).check()
    await expect(dm.getByRole('button', { name: 'Odeslat' })).toBeDisabled()
    await dm.getByRole('checkbox', { name: carolName }).check()
    await dm.getByRole('button', { name: 'Odeslat' }).click()
    await expect(dm.getByRole('log', { name: 'Zprávy' }).getByText('Zrádce je kovář')).toBeVisible()

    // hráči mimo vlákna uvidí odznak nepřečtených v hlavičce a po otevření tajnou zprávu s příjemci
    await carol.goto('/')
    await expect(carol.getByTestId('unread-messages-badge')).toBeVisible({ timeout: 20_000 })
    await carol.goto(`/campaigns/${campaignId}/messages`)
    await carol.getByRole('button', { name: /Tajné zprávy/ }).click()
    const secret = carol.getByRole('log', { name: 'Zprávy' })
    await expect(secret.getByText('Zrádce je kovář')).toBeVisible()
    await expect(secret.getByText(new RegExp(`pro: .*tebe`))).toBeVisible()
    await expect(carol.getByText('Tajné zprávy posílá jen DM')).toBeVisible() // hráč tajnou zprávu napsat nemůže
    await expect(carol.getByLabel('Zpráva', { exact: true })).toHaveCount(0)
    await expectNoHorizontalScroll(carol)

    // přečtená vlákna odznak zruší
    await expect(carol.getByTestId('unread-messages-badge')).toHaveCount(0, { timeout: 20_000 })
  } finally {
    await phoneA.close()
    await phoneB.close()
  }
})

test('zprávy jdou číst a psát i na telefonu (a na počítači) bez posouvání do stran', async ({ page }) => {
  await registerDm(page, 'chatsolo')
  const { campaignId } = await newCampaign(page, 'Sám')
  await page.getByRole('link', { name: /Zprávy/ }).click()
  await expect(page).toHaveURL(new RegExp(`/campaigns/${campaignId}/messages`))
  await expect(page.getByRole('heading', { name: 'Zprávy', level: 1 })).toBeVisible()

  // na telefonu je nejdřív seznam vláken
  const width = page.viewportSize()?.width ?? 0
  if (width < 1024) await page.getByRole('button', { name: /Skupina/ }).click()
  await write(page, 'Poznámka pro sebe <b>tučně?</b>')
  await expect(page.getByRole('log', { name: 'Zprávy' }).locator('b')).toHaveCount(0) // HTML se nevykoná, ukáže se jako text
  await expectNoHorizontalScroll(page)

  // dlouhý nezlomitelný text nerozbije rozložení
  await write(page, 'x'.repeat(300))
  await expectNoHorizontalScroll(page)
})

test('společný jazyk: hráči si píšou tak, že to DM ani jiný hráč nevidí', async ({ page: dm, browser, baseURL, isMobile }) => {
  test.skip(isMobile, 'Čtyři kontexty si ten test staví sám (DM počítač + tři hráči na telefonu).')

  await registerDm(dm, 'langdm')
  const { campaignId, code } = await newCampaign(dm, 'Jazyky')
  const contexts = await Promise.all([1, 2, 3].map(() => newContext(browser, { ...devices['Pixel 7'], baseURL, locale: 'cs-CZ' })))
  const [bob, carol, dan] = await Promise.all(contexts.map((c) => c.newPage()))
  try {
    for (const p of [bob!, carol!, dan!]) await registerViaUi(p, { username: uniqueName('hrac'), startPath: `/join/${code}` })
    const character = (p: Page, name: string, languages: string[]) =>
      p.request.post(`/api/campaigns/${campaignId}/characters`, {
        data: {
          name,
          abilityScores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
          levels: [{ classIndex: 'fighter', hpRoll: null }],
          extraProficiencies: languages.map((l) => `Language: ${l}`),
        },
      })
    const bobChar = (await (await character(bob!, 'Bob', [])).json()).character.id as string
    await character(carol!, 'Carol', ['Orc'])
    await character(dan!, 'Dan', ['Elvish'])

    // Bob zatím žádný jazyk nemá, v Zprávách se mu k tomu ukáže nápověda
    await bob!.goto(`/campaigns/${campaignId}/messages`)
    await expect(bob!.getByText(/Znáš s jiným hráčem společný jazyk/)).toBeVisible()
    await expect(bob!.getByRole('button', { name: /Orc/ })).toHaveCount(0)

    // jazyk si přidá na sheetu (Postava → Jazyky)
    await bob!.goto(`/characters/${bobChar}`)
    await bob!.getByRole('button', { name: 'Postava', exact: true }).click()
    await bob!.getByLabel('Přidat jazyk').selectOption('Orc')
    await bob!.getByRole('button', { name: 'Přidat', exact: true }).click()
    await expect(bob!.getByRole('list', { name: 'Znám jazyky' }).getByText('Skřetí (Orc)')).toBeVisible()
    await expect(bob!.getByRole('button', { name: 'Odebrat jazyk Orc' })).toBeVisible()

    // vlákno v jazyce Orc je jen u Boba a Carol; Dan (jiný jazyk) a DM ho nemají
    await bob!.goto(`/campaigns/${campaignId}/messages`)
    await carol!.goto(`/campaigns/${campaignId}/messages`)
    await dan!.goto(`/campaigns/${campaignId}/messages`)
    await dm.goto(`/campaigns/${campaignId}/messages`)
    await bob!.getByRole('button', { name: /Orc/ }).click()
    await write(bob!, 'Dnes večer přepadneme karavanu')
    await expectNoHorizontalScroll(bob!)

    await carol!.getByRole('button', { name: /Orc/ }).click({ timeout: 15_000 })
    await expect(carol!.getByRole('log', { name: 'Zprávy' }).getByText('Dnes večer přepadneme karavanu')).toBeVisible({ timeout: 15_000 })
    await write(carol!, 'Rozumím, jdu s tebou')
    await expect(bob!.getByRole('log', { name: 'Zprávy' }).getByText('Rozumím, jdu s tebou')).toBeVisible({ timeout: 15_000 })

    for (const outsider of [dan!, dm]) {
      await expect(outsider.getByRole('button', { name: /Orc/ })).toHaveCount(0)
      await expect(outsider.getByText('Dnes večer přepadneme karavanu')).toHaveCount(0)
      const res = await outsider.request.get(`/api/campaigns/${campaignId}/messages`)
      expect(await res.text()).not.toContain('přepadneme karavanu')
    }
  } finally {
    await Promise.all(contexts.map((c) => c.close()))
  }
})
