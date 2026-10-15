import { expect, test, type Page } from '@playwright/test'
import { login, uniqueEmail } from './helpers'

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
      const rect = el.getBoundingClientRect()
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

test('seznam kampaní a detail kampaně: rozložení podle šířky displeje', async ({ page }, testInfo) => {
  await login(page, uniqueEmail('layout'))
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
  await login(page, uniqueEmail('theme'))
  const html = page.locator('html')
  await page.emulateMedia({ colorScheme: 'light' })
  // Cyklus: systém, světlý, tmavý
  const toggle = page.getByRole('button', { name: /motiv/i })
  await toggle.click() // světlý
  await expect(html).not.toHaveClass(/dark/)
  await toggle.click() // tmavý
  await expect(html).toHaveClass(/dark/)
})
