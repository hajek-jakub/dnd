import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { registerDm } from './helpers'

// Běží v obou projektech (desktop i mobile): kontroluje, že rozložení sedí na daném displeji.

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow, 'stránka nesmí jezdit do stran').toBeLessThanOrEqual(0)
}

/** Všechna viditelná tlačítka a pole musí jít na dotykovém displeji trefit prstem (min. 44 px). */
async function expectTouchFriendly(page: Page) {
  const small = await page.evaluate(() => {
    const result: string[] = []
    for (const el of document.querySelectorAll<HTMLElement>('main button, main input, header button, header a')) {
      // Zaškrtávátka a přepínače se ovládají klepnutím na celý popisek, takže se měří popisek.
      const target = el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio') ? (el.closest('label') ?? el) : el
      const rect = target.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) continue
      if (rect.height < 43.5 || rect.width < 43.5) {
        result.push(`${el.tagName} "${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 30)}" ${Math.round(rect.width)}x${Math.round(rect.height)}`)
      }
    }
    return result
  })
  expect(small, 'prvky menší než 44 px').toEqual([])
}

test('přihlašovací stránka se vejde na displej a ovládací prvky jsou dost velké', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Přihlášení' })).toBeVisible()
  await expectNoHorizontalScroll(page)
  await expectTouchFriendly(page)
})

test('registrační stránka se vejde na displej a ovládací prvky jsou dost velké', async ({ page }) => {
  await page.goto('/register')
  await expect(page.getByRole('heading', { name: 'Registrace' })).toBeVisible()
  await expectNoHorizontalScroll(page)
  await expectTouchFriendly(page)
})

test('seznam kampaní a detail kampaně: rozložení podle šířky displeje', async ({ page }, testInfo) => {
  await registerDm(page, 'layout')
  await expect(page.getByRole('heading', { name: 'Moje kampaně' })).toBeVisible()
  await expectNoHorizontalScroll(page)

  const isDesktop = (page.viewportSize()?.width ?? 0) >= 1024
  const listBox = await page.getByRole('heading', { name: 'Moje kampaně' }).boundingBox()
  const formBox = await page.getByText('Nová kampaň', { exact: true }).boundingBox()
  expect(listBox && formBox).toBeTruthy()
  if (isDesktop) {
    expect(formBox!.x, 'na počítači je formulář vedle seznamu').toBeGreaterThan(listBox!.x + 300)
  } else {
    expect(formBox!.y, 'na telefonu je formulář pod seznamem').toBeGreaterThan(listBox!.y)
    expect(Math.abs(formBox!.x - listBox!.x), 'na telefonu je vše v jednom sloupci').toBeLessThan(40)
  }

  await page.getByLabel('Název kampaně').fill(`Layout ${testInfo.project.name}`)
  await page.getByRole('button', { name: 'Založit kampaň' }).click()
  await expect(page).toHaveURL(/\/campaigns\//)
  await expect(page.getByRole('heading', { name: `Layout ${testInfo.project.name}` })).toBeVisible()

  await page.getByRole('button', { name: /Vytvořit pozvánku/ }).click()
  await expect(page.getByText('Platná')).toBeVisible()
  await expectNoHorizontalScroll(page)
  if (!isDesktop) await expectTouchFriendly(page)

  const membersBox = await page.getByRole('heading', { name: 'Členové' }).boundingBox()
  const invitesBox = await page.getByRole('heading', { name: 'Pozvánky' }).boundingBox()
  expect(membersBox && invitesBox).toBeTruthy()
  if (isDesktop) {
    expect(invitesBox!.x, 'na počítači jsou pozvánky ve druhém sloupci').toBeGreaterThan(membersBox!.x + 300)
  } else {
    expect(invitesBox!.y, 'na telefonu jsou pozvánky pod členy').toBeGreaterThan(membersBox!.y)
  }
})

test('tmavý a světlý režim se přepíná', async ({ page }) => {
  await registerDm(page, 'theme')
  const html = page.locator('html')
  await page.emulateMedia({ colorScheme: 'light' })
  // Motiv se volí v Profilu (Podle systému / Světlý / Tmavý)
  await page.getByRole('link', { name: 'Profil a nastavení' }).click()
  const motiv = page.getByRole('group', { name: 'Motiv' })
  await motiv.getByRole('button', { name: 'Světlý' }).click()
  await expect(html).not.toHaveClass(/dark/)
  await motiv.getByRole('button', { name: 'Tmavý' }).click()
  await expect(html).toHaveClass(/dark/)
  await motiv.getByRole('button', { name: 'Podle systému' }).click()
  await expect(html).not.toHaveClass(/dark/) // systém je světlý
})

test('loot a itemy (DM): složky vedle položek na počítači, pod sebou na telefonu, bez scrollu do stran', async ({ page }) => {
  await registerDm(page, 'lootlayout')
  await page.getByLabel('Název kampaně').fill('Loot layout')
  await page.getByRole('button', { name: 'Založit kampaň' }).click()
  await expect(page).toHaveURL(/\/campaigns\//)
  const campaignId = page.url().split('/campaigns/')[1]!
  await page.request.post(`/api/campaigns/${campaignId}/characters`, {
    data: { name: 'Batan s dlouhým jménem', kind: 'npc', abilityScores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }, levels: [{ classIndex: 'fighter', hpRoll: null }] },
  })
  const folder = (await (await page.request.post(`/api/campaigns/${campaignId}/loot/folders`, { data: { name: 'Dungeon' } })).json()).folder.id as string
  await page.request.post(`/api/campaigns/${campaignId}/loot/folders`, { data: { name: 'Místnost s dlouhým názvem, aby se zalomila', parentId: folder } })
  await page.request.post(`/api/campaigns/${campaignId}/loot/entries`, { data: { kind: 'item', item: { name: 'Prsten s hodně dlouhým názvem, který se musí zalomit', kind: 'wondrous', curse: 'Kletba' } } })
  await page.request.post(`/api/campaigns/${campaignId}/loot/entries`, { data: { kind: 'gold', name: 'Truhla', currency: { gp: 100 } } })

  await page.goto(`/campaigns/${campaignId}/dm/loot`)
  await expect(page.getByRole('heading', { name: 'Loot a itemy', level: 1 })).toBeVisible()
  await page.getByLabel('Vybrat Truhla').check()
  await page.getByRole('button', { name: /^Dát vybrané: Batan/ }).click()
  await page.getByRole('button', { name: /^Podrobnosti: Prsten/ }).click()
  await expectNoHorizontalScroll(page)
  await expectTouchFriendly(page)

  const isDesktop = (page.viewportSize()?.width ?? 0) >= 1024
  const tree = await page.getByRole('navigation', { name: 'Složky lootu' }).boundingBox()
  const items = await page.getByRole('list', { name: 'Položky ve složce' }).boundingBox()
  expect(tree && items).toBeTruthy()
  if (isDesktop) {
    expect(items!.x, 'na počítači jsou položky vedle stromu složek').toBeGreaterThan(tree!.x + 200)
  } else {
    expect(items!.y, 'na telefonu jsou položky pod složkami').toBeGreaterThan(tree!.y)
  }
})
