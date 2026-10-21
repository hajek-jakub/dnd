import type { Locator, Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { registerDm } from './helpers'

// iPad: na výšku (projekt tablet, 820x1180) i na šířku (tablet-landscape, 1180x820).
// Cíl: místo se využije (bloky vedle sebe), nic nejezdí do stran a dotykové prvky jsou aspoň 44 px.

async function box(locator: Locator) {
  const b = await locator.boundingBox()
  expect(b, 'prvek musí být vidět').toBeTruthy()
  return b!
}

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow, 'stránka nesmí jezdit do stran').toBeLessThanOrEqual(0)
}

test('iPad: sheet, domovská stránka a zprávy využijí šířku', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('tablet'), 'jen pro iPad')
  const landscape = testInfo.project.name === 'tablet-landscape'
  await registerDm(page, 'tablet')
  await page.getByLabel('Název kampaně').fill('iPad')
  await page.getByRole('button', { name: 'Založit kampaň' }).click()
  await expect(page).toHaveURL(/\/campaigns\//)
  const campaignId = page.url().split('/campaigns/')[1]!
  const character = (await (await page.request.post(`/api/campaigns/${campaignId}/characters`, {
    data: {
      name: 'Tabletová',
      race: 'Human',
      abilityScores: { str: 10, dex: 16, con: 14, int: 8, wis: 15, cha: 14 },
      levels: [...Array(5).fill({ classIndex: 'monk', hpRoll: null }), { classIndex: 'warlock', hpRoll: null }],
      subclasses: { monk: 'open-hand', warlock: 'fiend' },
    },
  })).json()).character.id as string

  // Domů: moje postava vlevo, družina vpravo.
  await page.goto(`/campaigns/${campaignId}`)
  await expect(page.getByRole('heading', { name: 'Družina' })).toBeVisible()
  const mine = await box(page.getByRole('region', { name: 'Moje postava' }))
  const party = await box(page.getByRole('heading', { name: 'Družina' }))
  expect(party.x, 'družina je vedle mé postavy').toBeGreaterThan(mine.x + mine.width - 20)
  await expectNoHorizontalScroll(page)

  // Sheet, přehled: životy, útoky a (na šířku) dovednosti vedle sebe.
  await page.goto(`/characters/${character}`)
  await expect(page.getByRole('heading', { name: 'Životy' })).toBeVisible()
  const hp = await box(page.getByRole('heading', { name: 'Životy' }))
  const attacks = await box(page.getByRole('heading', { name: 'Útoky' }))
  const skills = await box(page.getByRole('heading', { name: 'Dovednosti' }))
  expect(attacks.x, 'útoky jsou vedle životů').toBeGreaterThan(hp.x + 250)
  expect(Math.abs(attacks.y - hp.y), 'útoky a životy začínají ve stejné výšce').toBeLessThan(40)
  if (landscape) {
    // Karty se skládají podle výšky, takže dovednosti nejsou napevno ve třetím sloupci; třetí sloupec ale existuje.
    const resources = await box(page.getByRole('heading', { name: 'Zdroje a sloty' }))
    expect(resources.x, 'na šířku jsou tři sloupce').toBeGreaterThan(attacks.x + 250)
    void skills
  } else {
    expect(skills.y, 'na výšku jsou dovednosti pod dvěma sloupci').toBeGreaterThan(attacks.y)
    const first = await box(page.getByRole('button', { name: /^Akrobacie: .* Změnit$/ }))
    const eleventh = await box(page.getByRole('button', { name: /^Medicína: .* Změnit$/ }))
    expect(eleventh.x, 'dovednosti jsou ve dvou sloupcích').toBeGreaterThan(first.x + 250)
  }
  // Režim hodu je v přilepené liště vedle záložek.
  const tabs = await box(page.getByRole('navigation', { name: 'Části karty postavy' }))
  const mode = await box(page.getByRole('group', { name: 'Režim hodu' }).first())
  if (landscape) expect(Math.abs(mode.y - tabs.y), 'režim hodu je v řádku se záložkami').toBeLessThan(30)
  await expectNoHorizontalScroll(page)

  // Záložka Inventář: peníze vedle vybavení.
  await page.getByRole('button', { name: 'Inventář', exact: true }).click()
  const gear = await box(page.getByRole('heading', { name: 'Vybavení' }))
  const money = await box(page.getByRole('heading', { name: 'Peníze' }))
  expect(money.x, 'peníze jsou vedle vybavení').toBeGreaterThan(gear.x + 250)
  await expectNoHorizontalScroll(page)

  // Zprávy: seznam vláken vedle vlákna.
  await page.goto(`/campaigns/${campaignId}/messages`)
  const threads = await box(page.getByRole('navigation', { name: 'Vlákna zpráv' }))
  const thread = await box(page.getByRole('region', { name: /^Vlákno:/ }))
  expect(thread.x, 'vlákno je vedle seznamu vláken').toBeGreaterThan(threads.x + threads.width - 5)
  await expectNoHorizontalScroll(page)

  // Pravidla: seznam vedle detailu.
  await page.goto('/rules')
  const list = await box(page.getByRole('region', { name: 'Seznam pravidel' }))
  const detail = await box(page.getByRole('region', { name: 'Detail' }))
  expect(detail.x, 'detail je vedle seznamu').toBeGreaterThan(list.x + list.width - 5)
  await expectNoHorizontalScroll(page)

  // Panel DM: karty postav ve dvou sloupcích (nebo víc).
  await page.request.post(`/api/campaigns/${campaignId}/characters`, {
    data: { name: 'Druhá', kind: 'npc', abilityScores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }, levels: [{ classIndex: 'fighter', hpRoll: null }] },
  })
  await page.goto(`/campaigns/${campaignId}/dm`)
  const cards = page.getByRole('list', { name: 'Postavy' }).locator(':scope > li')
  await expect(cards).toHaveCount(2)
  const a = await box(cards.nth(0))
  const b = await box(cards.nth(1))
  expect(b.x, 'karty postav jsou vedle sebe').toBeGreaterThan(a.x + a.width - 5)
  await expectNoHorizontalScroll(page)
})
