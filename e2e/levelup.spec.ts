import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { registerDm } from './helpers'

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow, 'stránka nesmí jezdit do stran').toBeLessThanOrEqual(0)
}

async function openCharacter(page: Page, character: Record<string, unknown>, prefix: string): Promise<string> {
  await registerDm(page, prefix)
  await page.getByLabel('Název kampaně').fill('Level up kampaň')
  await page.getByRole('button', { name: 'Založit kampaň' }).click()
  await expect(page).toHaveURL(/\/campaigns\//)
  const campaignId = page.url().split('/campaigns/')[1]!
  const res = await page.request.post(`/api/campaigns/${campaignId}/characters`, { data: character })
  expect(res.status()).toBe(201)
  const id = (await res.json()).character.id as string
  await page.goto(`/characters/${id}`)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  return id
}

const levels = (cls: string, n: number) => Array.from({ length: n }, () => ({ classIndex: cls, hpRoll: null }))
const next = (page: Page) => page.getByRole('button', { name: 'Pokračovat' }).click()

test('průvodce level upem: wizard 3 → 4 (hod na HP, ASI, nová kouzla, souhrn) a vrácení', async ({ page }) => {
  const id = await openCharacter(page, { name: 'Mág', abilityScores: { str: 10, dex: 14, con: 12, int: 16, wis: 10, cha: 8 }, levels: levels('wizard', 3), state: { hpCurrent: 15 } }, 'lvl')
  await page.getByRole('link', { name: 'Level up' }).click()
  await expect(page.getByRole('heading', { name: 'Level up na level 4' })).toBeVisible()
  await expectNoHorizontalScroll(page)

  // 1. třída: výchozí je současná
  await expect(page.getByLabel('Ve které třídě postoupíš?')).toHaveValue('wizard')
  await next(page)

  // 2. životy: hod kostkou
  await page.getByLabel('Hodit kostkou d6').check()
  await expect(page.getByRole('button', { name: 'Pokračovat' })).toBeDisabled() // bez hodu nejde dál
  await page.getByLabel('Hozená hodnota').fill('6')
  await expect(page.getByRole('status').filter({ hasText: 'Hozeno 6' })).toBeVisible()
  await next(page)

  // 3. featury
  await expect(page.getByText('Ability Score Improvement', { exact: true })).toBeVisible()
  await next(page)

  // 4. vlastnosti: +1 INT, +1 DEX
  await expect(page.getByRole('button', { name: 'Pokračovat' })).toBeDisabled()
  await page.getByRole('button', { name: 'Inteligence: +1' }).click()
  await page.getByRole('button', { name: 'Obratnost: +1' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Rozdáno: 2 / 2' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Síla: +1' })).toBeDisabled() // víc už nejde
  await next(page)

  // 5. kouzla
  await page.getByLabel('Hledat kouzlo').fill('Shield')
  await page.getByRole('button', { name: 'Vybrat Shield', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Vybráno: cantripy 0, kouzla 1' })).toBeVisible()
  await next(page)

  // 6. souhrn
  await expect(page.getByText('Wizard 3 → 4')).toBeVisible()
  await expect(page.getByText('3 → 4 (Wizard 4)')).toBeVisible()
  await expect(page.getByText(/Inteligence \+1, Obratnost \+1/)).toBeVisible()
  await expect(page.getByText('Shield', { exact: true })).toBeVisible()
  await expectNoHorizontalScroll(page)
  await page.getByRole('button', { name: 'Potvrdit level up' }).click()

  // sheet po level upu
  await expect(page).toHaveURL(new RegExp(`/characters/${id}$`))
  await expect(page.getByText('Wizard 4', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Obratnost \(hodnota\): 15/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Inteligence \(hodnota\): 17/ })).toBeVisible()
  await expect(page.getByRole('status', { name: /Sloty 2\. úrovně: 3 z 3/ })).toBeVisible()
  await page.getByRole('button', { name: 'Kouzla', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Kouzla 1. úrovně' }).getByText('Shield')).toBeVisible()

  // historie a vrácení
  await page.getByRole('button', { name: 'Postava', exact: true }).click()
  await expect(page.getByRole('main').getByText('Level 4: Wizard 4')).toBeVisible()
  await expect(page.getByText(/HP: hod 6/)).toBeVisible()
  page.once('dialog', (d) => void d.accept())
  await page.getByRole('button', { name: 'Vrátit poslední level' }).click()
  await expect(page.getByText('Level vrácen')).toBeVisible()
  await expect(page.getByRole('main').getByText('Level 4: Wizard 4')).toHaveCount(0)
  await page.getByRole('button', { name: 'Přehled', exact: true }).click()
  await expect(page.getByText('Wizard 3', { exact: false }).first()).toBeVisible()
  await expect(page.getByRole('button', { name: /^Inteligence \(hodnota\): 16/ })).toBeVisible()
  await page.getByRole('button', { name: 'Kouzla', exact: true }).click()
  await expect(page.getByText('Shield')).toHaveCount(0)
})

test('multiclass: chybějící prerekvizity upozorní, jde je obejít výjimkou, a vznikne pact magic', async ({ page }) => {
  await openCharacter(page, { name: 'Bojovník', abilityScores: { str: 14, dex: 14, con: 12, int: 10, wis: 10, cha: 8 }, levels: levels('fighter', 1), state: { hpCurrent: 12 } }, 'multi')
  await page.getByRole('link', { name: 'Level up' }).click()
  await page.getByLabel('Ve které třídě postoupíš?').selectOption('warlock')

  const alert = page.getByRole('alert').filter({ hasText: 'Prerekvizity multiclassu nejsou splněné' })
  await expect(alert).toBeVisible()
  await expect(alert.getByText('Warlock: CHA 13+ (máš 8)')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Pokračovat' })).toBeDisabled()
  await alert.getByLabel('Přesto pokračovat (výjimku povolil DM)').check()
  await next(page) // životy
  await next(page) // featury (Pact Magic, Otherworldly Patron)
  await expect(page.getByText('Pact Magic', { exact: true })).toBeVisible()
  await next(page) // kouzla
  await next(page) // souhrn
  await expect(page.getByText('Warlock (nová, level 1)')).toBeVisible()
  await expect(page.getByText(/Pact sloty/)).toBeVisible()
  await page.getByRole('button', { name: 'Potvrdit level up' }).click()

  await expect(page.getByText('Fighter 1 / Warlock 1', { exact: true })).toBeVisible()
  await expect(page.getByRole('status', { name: 'Pact sloty: 1 z 1' })).toBeVisible()

  // prerekvizity se kontrolují i pro současné třídy: warlock bez CHA 13 brání dalšímu multiclassu
  await page.getByRole('link', { name: 'Level up' }).click()
  await page.getByLabel('Ve které třídě postoupíš?').selectOption('rogue')
  await expect(page.getByRole('alert').getByText('Warlock: CHA 13+ (máš 8)')).toBeVisible()
})

test('subclass se vybírá při level upu na správném levelu a featury přibudou na sheetu', async ({ page }) => {
  await openCharacter(page, { name: 'Mnich', abilityScores: { str: 10, dex: 16, con: 12, int: 8, wis: 14, cha: 10 }, levels: levels('monk', 2), state: { hpCurrent: 14 } }, 'sub')
  await page.getByRole('link', { name: 'Level up' }).click()
  await next(page) // třída
  await next(page) // HP průměr
  await page.getByLabel(/Vyber subclass/).selectOption('open-hand')
  await expect(page.getByText('Open Hand Technique', { exact: true })).toBeVisible()
  await next(page) // featury -> souhrn (ASI a kouzla se přeskakují)
  await expect(page.getByText('Open Hand', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Potvrdit level up' }).click()

  await expect(page.getByText('Monk 3', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Featury', exact: true }).click()
  await expect(page.getByText('Open Hand Technique', { exact: true })).toBeVisible()
  await expect(page.getByText('Deflect Missiles', { exact: true })).toBeVisible()
})

test('feat místo zvýšení vlastností a ruční doplnění se uloží do historie', async ({ page }) => {
  await openCharacter(page, { name: 'Bojovník', abilityScores: { str: 16, dex: 12, con: 14, int: 8, wis: 10, cha: 10 }, levels: levels('fighter', 3), state: { hpCurrent: 28 } }, 'feat')
  await page.getByRole('link', { name: 'Level up' }).click()
  await next(page)
  await next(page)
  await page.getByLabel('Ruční doplnění (volitelné)').fill('Homebrew: Ohnivá past')
  await next(page)
  await page.getByRole('radio', { name: 'Vybrat feat' }).click()
  await page.getByLabel('Název featu').fill('Moje vlastní schopnost')
  await next(page)
  await expect(page.getByText('Moje vlastní schopnost')).toBeVisible()
  await expect(page.getByText('Homebrew: Ohnivá past')).toBeVisible()
  await page.getByRole('button', { name: 'Potvrdit level up' }).click()

  await expect(page.getByText('Fighter 4', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Featury', exact: true }).click()
  await expect(page.getByText('Moje vlastní schopnost')).toBeVisible()
  await page.getByRole('button', { name: 'Postava', exact: true }).click()
  await expect(page.getByText('Homebrew: Ohnivá past')).toBeVisible()
  await expect(page.getByText(/feat: Moje vlastní schopnost/)).toBeVisible()
})

test('na levelu 20 se Level up nenabízí; tlačítka průvodce jsou dost velká', async ({ page }) => {
  const id = await openCharacter(page, { name: 'Veterán', abilityScores: { str: 18, dex: 12, con: 16, int: 8, wis: 10, cha: 10 }, levels: levels('fighter', 20), state: { hpCurrent: 100 } }, 'max')
  await expect(page.getByRole('link', { name: 'Level up' })).toHaveCount(0)
  await page.goto(`/characters/${id}/levelup`)
  await expect(page).toHaveURL(new RegExp(`/characters/${id}$`)) // přesměrování zpět

})

test('průvodce: žádný horizontální scroll a dotykové prvky dost velké', async ({ page }) => {
  await openCharacter(page, { name: 'Dotyk', abilityScores: { str: 10, dex: 14, con: 12, int: 16, wis: 10, cha: 8 }, levels: levels('wizard', 3) }, 'touch')
  await page.getByRole('link', { name: 'Level up' }).click()
  for (let step = 0; step < 4; step++) {
    await expectNoHorizontalScroll(page)
    const small = await page.evaluate(() => {
      const result: string[] = []
      for (const el of document.querySelectorAll<HTMLElement>('main button, main input, main select, main summary')) {
        const target = el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio') ? (el.closest('label') ?? el) : el
        const rect = target.getBoundingClientRect()
        if (rect.width === 0 || rect.height === 0) continue
        if (rect.height < 43.5) result.push(`${el.tagName} "${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 30)}" ${Math.round(rect.height)}px`)
      }
      return result
    })
    expect(small, `krok ${step + 1}: prvky nižší než 44 px`).toEqual([])
    const nextButton = page.getByRole('button', { name: 'Pokračovat' })
    if (await nextButton.isDisabled()) break
    await nextButton.click()
  }
})
