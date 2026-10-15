import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { registerDm } from './helpers'

// Běží v obou projektech (desktop i mobile): procházeč pravidel musí fungovat na počítači i na telefonu.

const isDesktop = (page: Page) => (page.viewportSize()?.width ?? 0) >= 1024

/** Na telefonu je při otevřeném detailu seznam skrytý, takže se nejdřív vrátíme na seznam. */
async function backToList(page: Page) {
  if (!isDesktop(page)) await page.getByRole('link', { name: 'Zpět na seznam' }).click()
}

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow, 'stránka nesmí jezdit do stran').toBeLessThanOrEqual(0)
}

test('stránka O aplikaci je veřejná a obsahuje atribuci SRD 5.1', async ({ page }) => {
  await page.goto('/about')
  await expect(page.getByRole('heading', { name: 'O aplikaci' })).toBeVisible()
  await expect(page.getByText('System Reference Document 5.1')).toBeVisible()
  await expect(page.getByRole('link', { name: /creativecommons.org\/licenses\/by\/4.0/ })).toBeVisible()
  await expectNoHorizontalScroll(page)
})

test('kouzla: hledání, detail a (podle displeje) rozložení seznam + detail', async ({ page }) => {
  await registerDm(page, 'rules')
  await page.getByRole('link', { name: 'Pravidla' }).click()
  await expect(page.getByRole('heading', { name: 'Pravidla a obsah' })).toBeVisible()
  await expect(page.getByText(/387 záznamů/)).toBeVisible()
  await expectNoHorizontalScroll(page)

  await page.getByRole('searchbox', { name: 'Hledat podle názvu' }).fill('fireball')
  const fireball = page.getByRole('link', { name: /^Fireball Level 3/ })
  await expect(fireball).toBeVisible()
  await expect(page.getByText(/2 záznamy/)).toBeVisible() // Fireball + Delayed Blast Fireball

  await fireball.click()
  const detail = page.getByRole('article')
  await expect(detail.getByRole('heading', { name: 'Fireball' })).toBeVisible()
  await expect(detail.getByText('1 action')).toBeVisible()
  await expect(detail.getByText('150 feet')).toBeVisible()
  await expect(detail.getByText('V, S, M')).toBeVisible()
  await expect(detail.getByText(/bright streak flashes/)).toBeVisible()
  await expect(detail.getByText('Na vyšší úrovni')).toBeVisible()
  await expectNoHorizontalScroll(page)

  if (isDesktop(page)) {
    // na počítači zůstává seznam vlevo vedle detailu
    await expect(fireball).toBeVisible()
    const listBox = await fireball.boundingBox()
    const detailBox = await detail.boundingBox()
    expect(detailBox!.x).toBeGreaterThan(listBox!.x + listBox!.width - 5)
  } else {
    // na telefonu je při detailu vidět jen detail a tlačítko zpět
    await expect(fireball).toBeHidden()
    await page.getByRole('link', { name: 'Zpět na seznam' }).click()
    await expect(fireball).toBeVisible()
    await expect(page.getByRole('searchbox', { name: 'Hledat podle názvu' })).toHaveValue('fireball')
  }
})

test('kouzla: filtr úrovně, školy a třídy', async ({ page }) => {
  await registerDm(page, 'filtr')
  await page.goto('/rules')
  await page.getByRole('combobox', { name: 'Úroveň' }).selectOption('3')
  await page.getByRole('combobox', { name: 'Třída' }).selectOption('Cleric')
  await expect(page.getByRole('link', { name: /^Revivify/ })).toBeVisible()
  const metas = await page.locator('section[aria-label="Seznam pravidel"] ul li a').allInnerTexts()
  expect(metas.length).toBeGreaterThan(3)
  expect(metas.every((t) => t.includes('Level 3'))).toBe(true)
  await expect(page).toHaveURL(/level=3/)

  // filtry jsou v URL, takže přežijí obnovení stránky
  await page.reload()
  await expect(page.getByRole('combobox', { name: 'Úroveň' })).toHaveValue('3')
  await expect(page.getByRole('link', { name: /^Revivify/ })).toBeVisible()

  await page.getByRole('button', { name: 'Zrušit filtry' }).click()
  await expect(page.getByRole('combobox', { name: 'Úroveň' })).toHaveValue('')
})

test('magické itemy: SRD s popisem, item mimo SRD jen s faktami, cenou a odkazem', async ({ page }) => {
  await registerDm(page, 'items')
  await page.goto('/rules')
  await page.getByRole('button', { name: 'Magické itemy' }).click()
  await page.getByRole('searchbox', { name: 'Hledat podle názvu' }).fill('Bag of Holding')
  await page.getByRole('link', { name: /^Bag of Holding/ }).click()
  const detail = page.getByRole('article')
  await expect(detail.getByRole('heading', { name: 'Bag of Holding' })).toBeVisible()
  await expect(detail.getByText('Uncommon', { exact: true })).toBeVisible()
  await expect(detail.getByText('1 000 gp')).toBeVisible()
  await expect(detail.getByText(/This bag has an interior space/)).toBeVisible()

  // Item z Xanathar's Guide (není v SRD): žádný kopírovaný popis, odkaz na aidedd
  await backToList(page)
  await page.getByRole('searchbox', { name: 'Hledat podle názvu' }).fill('Armor of Gleaming')
  await page.getByRole('link', { name: /^Armor of Gleaming/ }).click()
  await expect(detail.getByRole('heading', { name: 'Armor of Gleaming' })).toBeVisible()
  await expect(detail.getByText('Popis tohoto itemu není součástí SRD')).toBeVisible()
  await expect(detail.getByText('50 gp')).toBeVisible()
  const link = detail.getByRole('link', { name: /Popis na aidedd.org/ })
  await expect(link).toHaveAttribute('href', 'https://www.aidedd.org/dnd/om.php?vo=armor-of-gleaming')
  await expect(link).toHaveAttribute('rel', /noopener/)
  await expect(link).toHaveAttribute('target', '_blank')
  await expectNoHorizontalScroll(page)

  // filtr vzácnosti a původu
  await backToList(page)
  await page.getByRole('searchbox', { name: 'Hledat podle názvu' }).fill('')
  await page.getByRole('combobox', { name: 'Vzácnost' }).selectOption('legendary')
  await page.getByRole('combobox', { name: 'Původ obsahu' }).selectOption('srd')
  await expect(page.getByRole('link', { name: /^Apparatus of the Crab/ })).toBeVisible()
})

test('třídy: Monk a Way of the Open Hand mají popis, featury a tabulky', async ({ page }) => {
  await registerDm(page, 'classes')
  await page.goto('/rules?g=classes')
  await page.getByRole('searchbox', { name: 'Hledat podle názvu' }).fill('Open Hand')
  // hledání se do URL zapisuje se zpožděním; klik dřív by ho přebil zápisem z odloženého hledání
  await expect(page).toHaveURL(/q=Open\+Hand/)
  await page.getByRole('link', { name: /^Open Hand/ }).click()
  const detail = page.getByRole('article')
  await expect(detail.getByRole('heading', { name: 'Open Hand' })).toBeVisible()
  await expect(detail.getByText('Way of the Open Hand')).toBeVisible()

  await page.goto('/rules?g=features&q=Stunning')
  await page.getByRole('link', { name: /^Stunning Strike/ }).click()
  await expect(page.getByRole('article').getByText(/stun/i).first()).toBeVisible()
})

test('na seznamu a v detailu jsou dotykové prvky dost velké', async ({ page }) => {
  await registerDm(page, 'touch')
  await page.goto('/rules')
  await expect(page.getByText(/387 záznamů/)).toBeVisible()
  const small = await page.evaluate(() => {
    const result: string[] = []
    for (const el of document.querySelectorAll<HTMLElement>('main button, main input, main select, main a')) {
      const rect = el.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) continue
      if (rect.height < 43.5) result.push(`${el.tagName} "${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 30)}" ${Math.round(rect.height)}px`)
    }
    return result
  })
  expect(small, 'prvky nižší než 44 px').toEqual([])
})
