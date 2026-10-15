import type { Page } from '@playwright/test'
import { makePng } from '../test-utils/png'
import { expect, test } from './fixtures'
import { registerDm } from './helpers'

// Běží v obou projektech (desktop i mobile): character sheet musí jít ovládat myší i prstem.

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow, 'stránka nesmí jezdit do stran').toBeLessThanOrEqual(0)
}

async function newCampaign(page: Page): Promise<string> {
  await page.getByLabel('Název kampaně').fill('Sheet kampaň')
  await page.getByRole('button', { name: 'Založit kampaň' }).click()
  await expect(page).toHaveURL(/\/campaigns\//)
  return page.url().split('/campaigns/')[1]!
}

test('vytvoření postavy, klikání HP, přepis hodnoty, odpočinek a featury', async ({ page }) => {
  await registerDm(page, 'sheet')
  await newCampaign(page)
  await page.getByRole('link', { name: 'Nová postava' }).click()

  await page.getByLabel('Jméno postavy').fill('Hajoš')
  await page.getByLabel('Rasa').fill('Human')
  await page.getByLabel('Třída', { exact: true }).selectOption('monk')
  await page.getByLabel('Level', { exact: true }).selectOption('5')
  await page.getByLabel('Subclass').selectOption('open-hand')
  await page.getByRole('button', { name: 'Standardní sada' }).click()
  await page.getByLabel(/^Obratnost/).fill('16')
  await page.getByLabel(/^Moudrost/).fill('15')
  await page.getByLabel(/^Odolnost/).fill('13')
  await page.getByLabel(/Akrobacie/).check()
  await page.getByRole('button', { name: 'Vytvořit postavu' }).click()

  // sheet
  await expect(page.getByRole('heading', { name: 'Hajoš', level: 1 })).toBeVisible()
  await expect(page.getByText('Human · Monk 5')).toBeVisible()
  await expectNoHorizontalScroll(page)

  // AC mnicha: 10 + DEX 3 + WIS 2
  await expect(page.getByRole('button', { name: /^Armor Class: 15/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Proficiency bonus: \+3/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Rychlost: 40 ft/ })).toBeVisible() // Unarmored Movement +10

  // HP: d8 + CON(+1) = 9, další 4 levely průměr 5 + 1 = 6  -> 33. Klik se projeví hned.
  await expect(page.getByRole('status', { name: 'Životy: 33 z 33' })).toBeVisible()
  await page.getByRole('button', { name: 'Poškození 5' }).click()
  await expect(page.getByRole('status', { name: 'Životy: 28 z 33' })).toBeVisible()
  await page.getByRole('button', { name: 'Léčení 1' }).click()
  await expect(page.getByRole('status', { name: 'Životy: 29 z 33' })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('status', { name: 'Životy: 29 z 33' })).toBeVisible() // uloženo na serveru

  // ki: 5 z 5, použít 2
  await expect(page.getByRole('status', { name: 'Ki: 5 z 5' })).toBeVisible()
  await page.getByRole('button', { name: 'Ki: použít' }).click()
  await page.getByRole('button', { name: 'Ki: použít' }).click()
  await expect(page.getByRole('status', { name: 'Ki: 3 z 5' })).toBeVisible()

  // ruční přepis AC a návrat k výpočtu
  await page.getByRole('button', { name: /^Armor Class: 15/ }).click()
  const dialog = page.getByRole('dialog', { name: 'Armor Class' })
  await expect(dialog.getByText('Unarmored Defense: základ')).toBeVisible()
  await dialog.getByLabel('Přepsat hodnotu').fill('20')
  await dialog.getByRole('button', { name: 'Přepsat', exact: true }).click()
  await expect(page.getByRole('button', { name: /^Armor Class: 20 \(přepsáno ručně\)/ })).toBeVisible()
  await page.getByRole('button', { name: /^Armor Class: 20/ }).click()
  await page.getByRole('dialog', { name: 'Armor Class' }).getByRole('button', { name: /Vrátit k výpočtu \(15\)/ }).click()
  await expect(page.getByRole('button', { name: /^Armor Class: 15\. Zobrazit detail/ })).toBeVisible()

  // short rest: utratit kostku a obnovit ki
  await page.getByRole('button', { name: 'Short rest' }).click()
  const rest = page.getByRole('dialog', { name: 'Short rest' })
  await rest.getByRole('button', { name: 'Utratit d8' }).click()
  await expect(rest.getByText(/d8: hozeno/)).toBeVisible()
  await rest.getByRole('button', { name: 'Dokončit short rest' }).click()
  await expect(page.getByRole('status', { name: 'Ki: 5 z 5' })).toBeVisible()

  // long rest: plné HP
  await page.getByRole('button', { name: 'Poškození 5' }).click()
  await page.getByRole('button', { name: 'Long rest' }).click()
  await page.getByRole('dialog', { name: 'Long rest' }).getByRole('button', { name: 'Dát si long rest' }).click()
  await expect(page.getByRole('status', { name: 'Životy: 33 z 33' })).toBeVisible()

  // featury z SRD
  await page.getByRole('button', { name: 'Featury', exact: true }).click()
  await expect(page.getByText('Extra Attack', { exact: true })).toBeVisible()
  await expect(page.getByText('Open Hand Technique', { exact: true })).toBeVisible()
  await page.getByText('Stunning Strike', { exact: true }).click()
  await expect(page.getByText(/must succeed on a Constitution saving throw or be stunned/i)).toBeVisible()
  await expectNoHorizontalScroll(page)
})

test('povinný případ: Monk 5 (Open Hand) / Warlock 1 (Fiend) se na sheetu spočítá podle pravidel', async ({ page }) => {
  await registerDm(page, 'hajos')
  const campaignId = await newCampaign(page)
  const res = await page.request.post(`/api/campaigns/${campaignId}/characters`, {
    data: {
      name: 'Hajoš',
      race: 'Human',
      abilityScores: { str: 10, dex: 16, con: 14, int: 8, wis: 15, cha: 14 },
      levels: [...Array(5).fill({ classIndex: 'monk', hpRoll: null }), { classIndex: 'warlock', hpRoll: null }],
      subclasses: { monk: 'open-hand', warlock: 'fiend' },
      skillProficiencies: { stealth: 2, perception: 1 },
    },
  })
  expect(res.status()).toBe(201)
  const id = (await res.json()).character.id as string
  await page.goto(`/characters/${id}`)

  await expect(page.getByText('Human · Monk 5 / Warlock 1')).toBeVisible()
  await expect(page.getByRole('button', { name: /^Proficiency bonus: \+3/ })).toBeVisible()
  await expect(page.getByRole('status', { name: 'Ki: 5 z 5' })).toBeVisible()
  await expect(page.getByText('Martial Arts 1d6')).toBeVisible()
  await expect(page.getByRole('button', { name: /^Rychlost: 40 ft/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Armor Class: 15/ })).toBeVisible()
  await expect(page.getByText('2 útoky na akci')).toBeVisible()

  // pact slot 1. úrovně, žádné běžné sloty
  await expect(page.getByText('Pact Magic (obnova na short rest)')).toBeVisible()
  await expect(page.getByRole('status', { name: 'Pact sloty: 1 z 1' })).toBeVisible()
  await expect(page.getByText('Spell sloty (zbývající / celkem)')).toHaveCount(0)
  await expect(page.getByText('Žádné běžné sloty · Pact Magic: 1× 1. úrovně')).toBeVisible()

  // spell save DC warlocka z CHA: 8 + 3 + 2
  const warlock = page.getByRole('region', { name: 'Sesílání: Warlock' })
  await expect(warlock.getByRole('button', { name: /^Warlock: Spell save DC: 13/ })).toBeVisible()
  await expect(warlock.getByText('(CHA)')).toBeVisible()
  await expect(page.getByRole('region', { name: 'Sesílání: Monk' })).toHaveCount(0)

  // použití a obnova pact slotu přes short rest
  await page.getByRole('button', { name: 'Použít pact slot' }).click()
  await expect(page.getByRole('status', { name: 'Pact sloty: 0 z 1' })).toBeVisible()
  await page.getByRole('button', { name: 'Short rest' }).click()
  await page.getByRole('dialog', { name: 'Short rest' }).getByRole('button', { name: 'Dokončit short rest' }).click()
  await expect(page.getByRole('status', { name: 'Pact sloty: 1 z 1' })).toBeVisible()

  // featury
  await page.getByRole('button', { name: 'Featury', exact: true }).click()
  for (const feature of ['Extra Attack', 'Stunning Strike', 'Open Hand Technique', 'Pact Magic', "Dark One's Blessing"]) {
    await expect(page.getByText(feature, { exact: true }).first()).toBeVisible()
  }
  await expectNoHorizontalScroll(page)
})

test('fotka postavy: nahrání, ořez, zobrazení v seznamu kampaně a odstranění', async ({ page }) => {
  await registerDm(page, 'foto')
  const campaignId = await newCampaign(page)
  const res = await page.request.post(`/api/campaigns/${campaignId}/characters`, {
    data: { name: 'Fotogenická', abilityScores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }, levels: [{ classIndex: 'fighter', hpRoll: null }] },
  })
  const id = (await res.json()).character.id as string
  await page.goto(`/characters/${id}`)
  await page.getByRole('button', { name: 'Postava', exact: true }).click()

  await page.getByLabel('Vybrat fotku postavy').setInputFiles({ name: 'foto.png', mimeType: 'image/png', buffer: Buffer.from(makePng(400, 300, [30, 120, 220])) })
  const dialog = page.getByRole('dialog', { name: 'Ořez fotky' })
  await expect(dialog.getByLabel('Přiblížení')).toBeVisible()
  await dialog.getByLabel('Přiblížení').fill('2')
  await dialog.getByRole('button', { name: 'Použít fotku' }).click()
  await expect(page.getByText('Fotka nahrána')).toBeVisible()

  const avatar = page.getByRole('img', { name: 'Fotka postavy Fotogenická' }).first()
  await expect(avatar).toBeVisible()
  await expect.poll(() => avatar.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(512)

  // v seznamu postav v kampani
  await page.goto(`/campaigns/${campaignId}`)
  const listAvatar = page.getByRole('region', { name: 'Moje postava' }).getByRole('img', { name: 'Fotka postavy Fotogenická' })
  await expect(listAvatar).toBeVisible()
  await expect.poll(() => listAvatar.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(512)

  // odstranění
  await page.goto(`/characters/${id}`)
  await page.getByRole('button', { name: 'Postava', exact: true }).click()
  await page.getByRole('button', { name: 'Odstranit' }).click()
  await expect(page.getByRole('img', { name: /Fotka postavy/ })).toHaveCount(0)
})

test('layout sheetu: žádný horizontální scroll a dotykové prvky dost velké', async ({ page }) => {
  await registerDm(page, 'layout')
  const campaignId = await newCampaign(page)
  const res = await page.request.post(`/api/campaigns/${campaignId}/characters`, {
    data: { name: 'Layout', abilityScores: { str: 10, dex: 14, con: 12, int: 10, wis: 13, cha: 8 }, levels: [...Array(3).fill({ classIndex: 'wizard', hpRoll: null })] },
  })
  const id = (await res.json()).character.id as string
  await page.goto(`/characters/${id}`)
  await expect(page.getByRole('heading', { name: 'Layout', level: 1 })).toBeVisible()
  await expectNoHorizontalScroll(page)

  const small = await page.evaluate(() => {
    const result: string[] = []
    for (const el of document.querySelectorAll<HTMLElement>('main button, main input, main select, main summary')) {
      const rect = el.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) continue
      if (rect.height < 43.5) result.push(`${el.tagName} "${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 30)}" ${Math.round(rect.height)}px`)
    }
    return result
  })
  expect(small, 'prvky nižší než 44 px').toEqual([])

  // wizard 3: běžné sloty 4 / 2
  await expect(page.getByRole('status', { name: 'Sloty 1. úrovně: 4 z 4' })).toBeVisible()
  await expect(page.getByRole('status', { name: 'Sloty 2. úrovně: 2 z 2' })).toBeVisible()
  await page.getByRole('button', { name: 'Použít slot 1. úrovně' }).click()
  await expect(page.getByRole('status', { name: 'Sloty 1. úrovně: 3 z 4' })).toBeVisible()
})
