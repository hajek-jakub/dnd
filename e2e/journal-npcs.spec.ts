import { devices, type Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { newContext, registerDm, registerViaUi, uniqueName } from './helpers'

// Přehled NPC v deníku: abecední seznam (jméno, rasa, popis), příběh NPC = zápisy deníku, postavy a NPC z kampaně, skrytá NPC DM.

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

const letters = (page: Page) => page.locator('section[aria-label^="NPC na"] > h2').allTextContents()

test('hráč na telefonu vede přehled NPC a jejich příběh, DM ho vidí na počítači, skrytá NPC hráč nevidí', async ({ page: dm, browser, baseURL, isMobile }) => {
  test.skip(isMobile, 'Dva kontexty si ten test staví sám (DM počítač + hráč telefon).')
  test.setTimeout(150_000)

  await registerDm(dm, 'npcdm')
  const { campaignId, code } = await newCampaign(dm, 'NPC kampaň')
  const phone = await newContext(browser, { ...devices['Pixel 7'], baseURL, locale: 'cs-CZ' })
  const player = await phone.newPage()
  try {
    await registerViaUi(player, { username: uniqueName('hrac'), startPath: `/join/${code}` })
    await expect(player.getByRole('heading', { name: 'NPC kampaň', level: 1 })).toBeVisible()

    // --- prázdný přehled, hráč přidá NPC (jméno, rasa, popis)
    await player.goto(`/campaigns/${campaignId}/journal`)
    await player.getByRole('link', { name: /^NPC/ }).click()
    await expect(player.getByText(/Přehled NPC je prázdný/)).toBeVisible()
    await player.getByRole('button', { name: 'Přidat NPC' }).click()
    let form = player.getByRole('dialog', { name: 'Nové NPC' })
    await expect(form.getByLabel('Kdo NPC uvidí')).toHaveCount(0) // viditelnost nastavuje jen DM
    await form.getByLabel('Jméno').fill('Zelda')
    await form.getByLabel('Rasa').fill('Elf')
    await form.getByLabel('Popis').fill('Léčitelka z **vesnice** pod horami')
    await form.getByRole('button', { name: 'Přidat do přehledu' }).click()
    await expect(player).toHaveURL(/npc=/)
    const detail = player.getByRole('article', { name: 'NPC Zelda' })
    await expect(detail.getByRole('heading', { name: 'Zelda', level: 2 })).toBeVisible()
    await expect(detail.getByText('Elf', { exact: true })).toBeVisible()
    await expect(detail.locator('strong', { hasText: 'vesnice' })).toBeVisible()
    await expect(detail.getByText(/K NPC zatím nejsou žádné zápisy/)).toBeVisible()
    // na telefonu je vidět jen detail; zpět na seznam
    await expect(player.getByLabel('Hledat NPC')).toBeHidden()
    await expectNoHorizontalScroll(player)

    // --- příběh NPC: nový zápis rovnou k NPC
    await detail.getByRole('button', { name: 'Napsat zápis' }).click()
    form = player.getByRole('dialog', { name: 'Nový zápis o Zelda' })
    await expect(form.getByRole('list', { name: 'Vybraná NPC' }).getByText('Zelda')).toBeVisible()
    await form.getByLabel('Nadpis').fill('Zelda nás zachránila')
    await form.getByLabel('Text').fill('Ošetřila Hajoše po boji s **trolem**.')
    await form.getByRole('button', { name: 'Přidat do deníku' }).click()
    await expect(detail.getByRole('heading', { name: /Příběh a zápisy \(1\)/ })).toBeVisible()
    await detail.getByRole('button', { name: /Zelda nás zachránila/ }).click()
    await expect(detail.locator('strong', { hasText: 'trolem' })).toBeVisible()
    await expectNoHorizontalScroll(player)

    // odkaz do deníku: zápis je otevřený a má štítek s NPC, ten vede zpět na NPC
    await detail.getByRole('link', { name: 'Otevřít v deníku' }).click()
    await expect(player).toHaveURL(/journal\?entry=/)
    await expect(player.locator('strong', { hasText: 'trolem' })).toBeVisible()
    await player.getByRole('list', { name: 'NPC a postavy v zápisu' }).getByRole('link', { name: 'Zelda' }).click()
    await expect(player.getByRole('article', { name: 'NPC Zelda' })).toBeVisible()

    // --- nový zápis s vytvořením NPC přímo ve formuláři zápisu
    await player.goto(`/campaigns/${campaignId}/journal`)
    await player.getByRole('button', { name: 'Nový zápis' }).click()
    form = player.getByRole('dialog', { name: 'Nový zápis' })
    await form.getByLabel('Nadpis').fill('Obchodník na rynku')
    await form.getByRole('button', { name: 'Nové NPC' }).click()
    await form.getByLabel('Jméno nového NPC').fill('Kupec Bobo')
    await form.getByLabel('Rasa', { exact: true }).fill('Půlčík')
    await form.getByRole('button', { name: 'Přidat NPC', exact: true }).click()
    await expect(form.getByRole('list', { name: 'Vybraná NPC' }).getByText('Kupec Bobo')).toBeVisible()
    await form.getByRole('button', { name: 'Přidat do deníku' }).click()
    await expect(player.getByRole('button', { name: /Obchodník na rynku/ })).toContainText('1 NPC')

    // hledání v deníku najde zápis i podle jména NPC (bez diakritiky)
    await player.getByLabel('Hledat v deníku').fill('kupec')
    await expect(player.getByRole('button', { name: /Obchodník na rynku/ })).toBeVisible()
    await expect(player.getByRole('button', { name: /Zelda nás zachránila/ })).toHaveCount(0)

    // --- DM na počítači: seznam je abecední, NPC postava z kampaně je v něm sama (s popisem z profilu), DM přidá skryté NPC
    await dm.request.post(`/api/campaigns/${campaignId}/journal/npcs`, { data: { name: 'Alrik', race: 'Člověk' } })
    const tom = await dm.request.post(`/api/campaigns/${campaignId}/characters`, {
      data: { kind: 'npc', name: 'Hostinský Tom', race: 'Halfling', abilityScores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }, levels: [{ classIndex: 'fighter', hpRoll: null }], description: 'Hostinský' },
    })
    expect(tom.ok()).toBeTruthy()
    const tomId = (await tom.json()).character.id as string
    await dm.goto(`/campaigns/${campaignId}/journal/npcs`)
    await expect(dm.getByRole('link', { name: /Zelda/ })).toBeVisible()
    await expect(await letters(dm)).toEqual(['A', 'H', 'K', 'Z'])
    await expect(dm.getByRole('link', { name: /Hostinský Tom/ })).toContainText('Halfling')
    await dm.getByRole('link', { name: /Hostinský Tom/ }).click()
    const tomDetail = dm.getByRole('article', { name: 'NPC Hostinský Tom' })
    await expect(tomDetail.getByText('NPC z kampaně')).toBeVisible()
    await expect(tomDetail.getByRole('link', { name: 'Karta postavy' })).toBeVisible()
    await tomDetail.getByRole('button', { name: 'Upravit' }).click()
    const edit = dm.getByRole('dialog', { name: 'Upravit NPC' })
    await expect(edit.getByLabel('Jméno')).toBeDisabled() // jméno a rasu přebírá postava
    await expect(edit.getByLabel('Popis')).toHaveValue('Hostinský') // popis z profilu postavy
    await edit.getByLabel('Popis').fill('Hostinský u **Zlatého draka**')
    await edit.getByRole('button', { name: 'Uložit' }).click()
    await expect(tomDetail.locator('strong', { hasText: 'Zlatého draka' })).toBeVisible()
    // uložilo se do profilu postavy
    expect((await (await dm.request.get(`/api/characters/${tomId}`)).json()).character.description).toBe('Hostinský u **Zlatého draka**')
    // přiřazení existujícího zápisu k NPC
    await tomDetail.getByRole('button', { name: 'Přiřadit zápis' }).click()
    const assign = dm.getByRole('dialog', { name: 'Přiřadit zápis k Hostinský Tom' })
    await assign.getByLabel(/Obchodník na rynku/).check()
    await assign.getByRole('button', { name: 'Přiřadit vybrané (1)' }).click()
    await expect(tomDetail.getByRole('heading', { name: /Příběh a zápisy \(1\)/ })).toBeVisible()

    await dm.getByRole('button', { name: 'Přidat NPC' }).click()
    const hidden = dm.getByRole('dialog', { name: 'Nové NPC' })
    await hidden.getByLabel('Jméno').fill('Tajný spiklenec')
    await hidden.getByLabel('Kdo NPC uvidí').selectOption('dm')
    await hidden.getByRole('button', { name: 'Přidat do přehledu' }).click()
    await expect(dm.getByRole('article', { name: 'NPC Tajný spiklenec' }).getByText('Vidí jen DM')).toBeVisible()
    await expect(await letters(dm)).toEqual(['A', 'H', 'K', 'T', 'Z'])

    // --- hráč: postavu z kampaně vidí, skryté NPC ne, a vidí zápis, který DM k Tomovi přiřadil
    await player.goto(`/campaigns/${campaignId}/journal/npcs`)
    await expect(player.getByRole('link', { name: /Hostinský Tom/ })).toBeVisible()
    await expect(player.getByText('Tajný spiklenec')).toHaveCount(0)
    await expect(await letters(player)).toEqual(['A', 'H', 'K', 'Z'])
    await expect(player.getByRole('link', { name: /Hostinský Tom/ })).toContainText('1') // počet zápisů
    await player.getByLabel('Hledat NPC').fill('pulcik') // hledání bez diakritiky: Půlčík u Kupce Bobo
    await expect(player.getByRole('link', { name: /Kupec Bobo/ })).toBeVisible()
    await expect(player.getByRole('link', { name: /Zelda/ })).toHaveCount(0)
    await expectNoHorizontalScroll(player)

    // hráč cizí NPC nemění
    await player.getByLabel('Hledat NPC').fill('')
    await player.getByRole('link', { name: /Alrik/ }).click()
    const alrik = player.getByRole('article', { name: 'NPC Alrik' })
    await expect(alrik).toBeVisible()
    await expect(alrik.getByRole('button', { name: 'Upravit' })).toHaveCount(0)
    await expect(alrik.getByRole('button', { name: 'Smazat NPC Alrik' })).toHaveCount(0)
    await alrik.getByRole('link', { name: 'Zpět na seznam NPC' }).click()
    await expect(player.getByLabel('Hledat NPC')).toBeVisible()
  } finally {
    await phone.close()
  }
})

test('přehled NPC jde číst a psát na telefonu i na počítači bez posouvání do stran', async ({ page }) => {
  await registerDm(page, 'npcsolo')
  const { campaignId } = await newCampaign(page, 'Solo NPC')
  const npc = (await (await page.request.post(`/api/campaigns/${campaignId}/journal/npcs`, { data: { name: 'Velmi dlouhé jméno NPC '.repeat(4).slice(0, 100), race: 'Rasa '.repeat(20).slice(0, 100), description: 'x'.repeat(500) + '\n\nhttps://example.com/' + 'a'.repeat(120) } })).json()).npc.id as string
  await page.request.post(`/api/campaigns/${campaignId}/journal`, { data: { title: 'Zápis s dlouhým názvem '.repeat(3), body: 'Text '.repeat(100), npcIds: [npc] } })
  await page.goto(`/campaigns/${campaignId}/journal/npcs?npc=${npc}`)
  await expect(page.getByRole('heading', { name: 'Deník', level: 1 })).toBeVisible()
  await page.getByRole('button', { name: /Zápis s dlouhým názvem/ }).click()
  await expectNoHorizontalScroll(page)
  await page.getByRole('button', { name: 'Napsat zápis' }).click()
  await expectNoHorizontalScroll(page)
})

test('postavy hráčů jsou v přehledu NPC samy s popisem z profilu: filtr Postavy hráčů je ukáže a smazat je nejde', async ({ page }) => {
  await registerDm(page, 'npcpcs')
  const { campaignId } = await newCampaign(page, 'Postavy v přehledu')
  const created = await page.request.post(`/api/campaigns/${campaignId}/characters`, {
    data: { name: 'Obalatomi', race: 'Tiefling', abilityScores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }, levels: [{ classIndex: 'monk', hpRoll: null }], description: 'Mnich ze sirotčince' },
  })
  expect(created.ok()).toBeTruthy()
  await page.request.post(`/api/campaigns/${campaignId}/journal/npcs`, { data: { name: 'Alrik' } })
  await page.goto(`/campaigns/${campaignId}/journal/npcs`)
  await page.getByRole('group', { name: 'Druh' }).getByRole('button', { name: 'Postavy hráčů' }).click()
  await expect(page.getByRole('link', { name: /Obalatomi/ })).toContainText('postava hráče')
  await expect(page.getByRole('link', { name: /Alrik/ })).toHaveCount(0)
  await page.getByRole('link', { name: /Obalatomi/ }).click()
  const detail = page.getByRole('article', { name: 'NPC Obalatomi' })
  await expect(detail.getByRole('button', { name: 'Upravit' })).toBeVisible()
  await expect(detail.getByRole('button', { name: /Smazat NPC/ })).toHaveCount(0)
  await expect(detail.getByText('Mnich ze sirotčince')).toBeVisible()
})
