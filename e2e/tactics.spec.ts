import { spawnSync } from 'node:child_process'
import path from 'node:path'
import AxeBuilder from '@axe-core/playwright'
import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { registerDm } from './helpers'

// Taktiky postavy (tahák do boje): seedovaný Hajoš, štítky cen podle ki a slotů, hody, odečtení ceny, úpravy. Počítač i telefon.

const root = path.resolve(import.meta.dirname, '..')

function seedHajos(username: string): void {
  const res = spawnSync('php', ['api/bin/seed-hajos.php'], {
    cwd: root,
    encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '', DND_CONFIG: path.join(root, 'api/config.test.php'), SEED_OWNER_USERNAME: username },
  })
  expect(res.status, res.stderr + res.stdout).toBe(0)
}

async function openTactics(page: Page, prefix: string): Promise<string> {
  const username = await registerDm(page, prefix)
  seedHajos(username)
  await page.goto('/campaigns')
  await page.getByRole('link', { name: /Testovací kampaň \(seed\)/ }).click()
  await page.getByRole('region', { name: 'Moje postava' }).getByRole('link', { name: /Hajoš/ }).click()
  await expect(page.getByRole('heading', { name: 'Hajoš', level: 1 })).toBeVisible()
  const id = page.url().split('/characters/')[1]!.split(/[/?#]/)[0]!
  await page.getByRole('button', { name: 'Taktiky', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Útoky', level: 2 })).toBeVisible()
  return id
}

async function problems(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = []
    const overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth
    if (overflow > 0) out.push(`stránka jezdí do stran o ${overflow} px`)
    for (const el of document.querySelectorAll<HTMLElement>('main button, main input, main select, main textarea, main summary')) {
      const rect = el.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) continue
      if (el instanceof HTMLInputElement && el.type === 'checkbox') continue
      if (rect.height < 43.5) out.push(`${el.tagName} "${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 30)}" ${Math.round(rect.height)} px`)
    }
    return out
  })
}

async function audit(page: Page, name: string) {
  await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; animation: none !important; }' })
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  const summary = results.violations.map((v) => `${v.id} (${v.impact}): ${v.help} → ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`)
  expect(summary, `Přístupnost: ${name}`).toEqual([])
}

const card = (page: Page, title: string) => page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: title, level: 3, exact: true }) })
const stat = (page: Page, label: string) => page.getByRole('term').filter({ hasText: new RegExp(`^${label}$`) }).locator('xpath=following-sibling::dd[1]')

test('Hajoš: seedované taktiky, klíčová čísla a štítky cen', async ({ page }) => {
  await openTactics(page, 'tact')

  for (const title of ['Útoky', 'Kouzla', 'Ki schopnosti', 'Pasivky a reakce', 'Komba', 'Pravidla']) {
    await expect(page.getByRole('heading', { name: title, level: 2 })).toBeVisible()
  }
  // klíčová čísla z enginu
  await expect(stat(page, 'AC')).toHaveText('16')
  await expect(stat(page, 'Ki')).toHaveText('5/5')
  await expect(stat(page, 'Ki DC')).toHaveText('13')
  await expect(stat(page, 'Spell DC')).toHaveText('14')
  await expect(stat(page, 'Pact sloty 1. ú.')).toHaveText('1/1')

  // útok kopím, štítky a údaje
  const spear = card(page, 'Démonické kopí (hlavní)')
  await expect(spear).toContainText('d20+8')
  await expect(spear).toContainText('1d8+5 + 1d4 fire')
  await expect(spear.getByText('Akce', { exact: true })).toBeVisible()

  // ki ve tmavém štítku, slot v červeném, bonusová akce má vlastní štítek
  const flurry = card(page, 'Flurry of Blows')
  await expect(flurry.locator('[data-cost="ki"]')).toHaveAttribute('data-available', 'true')
  await expect(flurry.getByText('Bonusová akce')).toBeVisible()
  await expect(card(page, 'Hex').locator('[data-cost="slot"]')).toHaveAttribute('data-available', 'true')

  // nejsilnější kombo je zvýrazněné a má rozepsané kroky
  const burst = card(page, 'Maximální burst')
  await expect(burst).toContainText('Nejsilnější')
  await expect(burst.getByRole('listitem').first()).toBeVisible()

  // pravidla jsou rozbalovací
  const rule = page.locator('details').filter({ hasText: '1 slot = 1 kouzlo' })
  await rule.getByText('1 slot = 1 kouzlo').click()
  await expect(rule.getByText('Buď Hex, nebo jiné kouzlo 1. levelu.')).toBeVisible()

  expect(await problems(page)).toEqual([])
  for (const theme of ['light', 'dark'] as const) {
    await page.evaluate((t) => document.documentElement.classList.toggle('dark', t === 'dark'), theme)
    await audit(page, `taktiky (${theme})`)
  }
})

test('cena: Použít odečte ki a slot a hodí všechny útoky, bez zdrojů je štítek neaktivní', async ({ page }) => {
  const id = await openTactics(page, 'tactcost')
  const flurry = card(page, 'Flurry of Blows')
  const flurryUse = flurry.getByRole('button', { name: /^Použít Flurry of Blows/ })
  const results = page.getByRole('dialog', { name: 'Hody: Flurry of Blows' })

  // jedno použití = ki −1 a 2 údery, každý s hodem na zásah i zranění
  await flurryUse.click()
  await expect(results.getByTestId('batch-row')).toHaveCount(2)
  await expect(results.getByTestId('batch-hit')).toHaveCount(2)
  await expect(results.getByTestId('batch-damage')).toHaveCount(2)
  await page.keyboard.press('Escape')
  await expect(stat(page, 'Ki')).toHaveText('4/5')

  // zbylé ki se vyčerpá přes API; štítky ki jsou pak neaktivní a tlačítka vypnutá, ostatní ceny to nemění
  await page.request.post(`/api/characters/${id}/adjust`, { data: { ops: [{ op: 'resource', key: 'monk.ki', delta: -4, max: 5 }] } })
  await page.reload()
  await page.getByRole('button', { name: 'Taktiky', exact: true }).click()
  await expect(stat(page, 'Ki')).toHaveText('0/5')
  await expect(flurry.locator('[data-cost="ki"]')).toHaveAttribute('data-available', 'false')
  await expect(flurryUse).toBeDisabled()
  await expect(card(page, 'Hex').locator('[data-cost="slot"]')).toHaveAttribute('data-available', 'true')

  // jediný pact slot: po seslání Hexu jsou neaktivní všechny položky se slotem
  await card(page, 'Hex').getByRole('button', { name: /^Použít Hex/ }).click()
  await expect(stat(page, 'Pact sloty 1. ú.')).toHaveText('0/1')
  await expect(card(page, 'Hex').locator('[data-cost="slot"]')).toHaveAttribute('data-available', 'false')
  await expect(card(page, 'Armor of Agathys').locator('[data-cost="slot"]')).toHaveAttribute('data-available', 'false')
  await expect(card(page, 'Hex').getByRole('button', { name: /^Použít Hex/ })).toBeDisabled()
  expect(await problems(page)).toEqual([])
})

test('kombo hodí všemi kostkami: Maximální burst = 4 zásahy a 4 zranění, ki se odečte a hody jsou v logu', async ({ page }) => {
  const id = await openTactics(page, 'tactburst')
  await page.request.post(`/api/characters/${id}/adjust`, { data: { ops: [{ op: 'concentration', set: 'Hex' }] } })
  await page.reload()
  await page.getByRole('button', { name: 'Taktiky', exact: true }).click()

  const burst = card(page, 'Maximální burst')
  await expect(burst).toContainText('Provede: 2× Démonické kopí (hlavní), 2× Flurry of Blows')
  await expect(burst.getByTestId('combo-rider')).toContainText('Počítá s Hex: +1d6 necrotic')
  await burst.getByRole('button', { name: /^Použít Maximální burst/ }).click()
  const results = page.getByRole('dialog', { name: 'Hody: Maximální burst' })
  await expect(results.getByTestId('batch-row')).toHaveCount(4)
  await expect(results.getByTestId('batch-hit')).toHaveCount(4)
  await expect(results.getByTestId('batch-damage')).toHaveCount(4)
  await expect(results.getByTestId('batch-total')).not.toHaveText('0')
  await page.keyboard.press('Escape')
  await expect(stat(page, 'Ki')).toHaveText('4/5')

  // všech 8 hodů je ve sdíleném logu (výraz zranění má Hex +1d6, protože se soustředí na Hex)
  const rolls = (await (await page.request.get(`/api/campaigns/${(await (await page.request.get(`/api/characters/${id}`)).json()).character.campaignId}/rolls`)).json()).rolls as { label: string; expression: string }[]
  expect(rolls.filter((r) => r.label.includes('Démonické kopí') || r.label.includes('Flurry')).length).toBe(8)
  expect(rolls.some((r) => /1d8\+5\+1d4\+1d6/.test(r.expression))).toBe(true)
})

test('kombo s Hexem jde použít i bez Hexu: bez slotu se kouzlo nesešle a zranění je bez bonusu', async ({ page }) => {
  const id = await openTactics(page, 'tactnohex')
  await page.request.post(`/api/characters/${id}/adjust`, { data: { ops: [{ op: 'pact', delta: 1, max: 1 }] } })
  await page.reload()
  await page.getByRole('button', { name: 'Taktiky', exact: true }).click()
  await expect(stat(page, 'Pact sloty 1. ú.')).toHaveText('0/1')

  const opener = card(page, 'Otevření s Hexem')
  await expect(opener.getByRole('button', { name: /^Použít Otevření s Hexem:/ })).toBeDisabled()
  await opener.getByRole('button', { name: /^Použít Otevření s Hexem bez kouzla Hex/ }).click()
  const results = page.getByRole('dialog', { name: 'Hody: Otevření s Hexem bez kouzla Hex' })
  await expect(results.getByTestId('batch-row')).toHaveCount(2)
  await page.keyboard.press('Escape')
  const character = (await (await page.request.get(`/api/characters/${id}`)).json()).character
  expect(character.state.concentration).toBeNull()
  const rolls = (await (await page.request.get(`/api/campaigns/${character.campaignId}/rolls`)).json()).rolls as { label: string; expression: string }[]
  const spear = rolls.filter((r) => r.label.includes('Démonické kopí') && /d8/.test(r.expression))
  expect(spear.length).toBe(2)
  expect(spear.every((r) => !r.expression.includes('1d6'))).toBe(true)
  // kombo, které Hex nesesílá, druhé tlačítko nemá
  await expect(card(page, 'Maximální burst').getByRole('button', { name: /bez kouzla/ })).toHaveCount(0)
})

test('střelba z kuše ubírá šípy, bez šípů je útok vypnutý; spotřebovatelné itemy mají Použít', async ({ page }) => {
  const id = await openTactics(page, 'tactammo')
  const crossbow = card(page, 'Kuše')
  await expect(crossbow.getByTestId('ammo-badge')).toContainText('Crossbow bolt: 20 ks')
  await crossbow.getByRole('button', { name: /^Použít Kuše/ }).click()
  await expect(page.getByRole('dialog', { name: 'Hody: Kuše' }).getByTestId('batch-row')).toHaveCount(1)
  await page.keyboard.press('Escape')
  await expect(crossbow.getByTestId('ammo-badge')).toContainText('Crossbow bolt: 19 ks')

  // šipky: Extra Attack = 2 hody a 2 šipky
  await card(page, 'Šipka (dart)').getByRole('button', { name: /^Použít Šipka/ }).click()
  await expect(page.getByRole('dialog', { name: 'Hody: Šipka (dart)' }).getByTestId('batch-row')).toHaveCount(2)
  await page.keyboard.press('Escape')
  await expect(card(page, 'Šipka (dart)').getByTestId('ammo-badge')).toContainText('Dart: 7 ks')

  // došly šípy
  const bolts = (await (await page.request.get(`/api/characters/${id}`)).json()).character.items.find((i: { name: string }) => i.name === 'Crossbow bolt')
  await page.request.post(`/api/characters/${id}/adjust`, { data: { ops: [{ op: 'item', itemId: bolts.id, delta: -19 }] } })
  await page.reload()
  await page.getByRole('button', { name: 'Taktiky', exact: true }).click()
  await expect(card(page, 'Kuše').getByTestId('ammo-badge')).toContainText('Crossbow bolt: 0 ks')
  await expect(card(page, 'Kuše').getByRole('button', { name: /^Použít Kuše/ })).toBeDisabled()

  // v inventáři má spotřebovatelný item tlačítko Použít
  await page.getByRole('button', { name: 'Inventář', exact: true }).click()
  const torch = page.getByRole('listitem').filter({ hasText: /^Torch/ }).first()
  await torch.getByRole('button', { name: /^Podrobnosti:/ }).click()
  await torch.getByRole('button', { name: /^Použít Torch/ }).click()
  await expect(torch).toContainText('×7')
})

test('hody z taktik ukážou kostky, s Hexem přibude 1d6', async ({ page }) => {
  await openTactics(page, 'tactroll')
  const spear = card(page, 'Démonické kopí (hlavní)')

  await spear.getByRole('button', { name: /^Hodit: Démonické kopí \(hlavní\): útok/ }).click()
  const dialog = page.getByRole('dialog', { name: 'Hod kostkou' })
  await expect(dialog.getByTestId('roll-result-total')).toBeVisible()
  await expect(dialog).toContainText('1d20+8')
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)

  await spear.getByRole('button', { name: /^Hodit: Démonické kopí \(hlavní\): zranění \(/ }).first().click()
  await expect(dialog.getByTestId('roll-result-total')).toBeVisible()
  await expect(dialog).toContainText('1d8+5+1d4')
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)

  // soustředění na Hex: zásah přidá 1d6 a jde to vypnout
  await page.getByRole('button', { name: 'Přehled', exact: true }).click()
  await page.request.post(`/api/characters/${page.url().split('/characters/')[1]!.split(/[/?#]/)[0]}/adjust`, { data: { ops: [{ op: 'concentration', set: 'Hex' }] } })
  await page.reload()
  await page.getByRole('button', { name: 'Taktiky', exact: true }).click()
  const toggle = page.getByRole('button', { name: /Cíl je pod kouzlem Hex/ })
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  await expect(spear).toContainText('+ 1d6 necrotic (Hex)')
  await spear.getByRole('button', { name: /zranění \+ Hex/ }).first().click()
  await expect(dialog.getByTestId('roll-result-total')).toBeVisible()
  await expect(dialog).toContainText('1d8+5+1d4+1d6')
  await page.keyboard.press('Escape')
  await toggle.click()
  await expect(spear).not.toContainText('Hex)')
})

test('úpravy: přidat, upravit, přeřadit a smazat položky (data zůstanou v DB)', async ({ page }) => {
  const id = await openTactics(page, 'tactedit')
  page.on('dialog', (d) => void d.accept())

  // bez režimu úprav nejsou vidět ovládací prvky
  await expect(page.getByRole('button', { name: /^Smazat / })).toHaveCount(0)
  await page.getByRole('button', { name: 'Upravit taktiky' }).click()

  // přidání pravidla
  await page.getByRole('button', { name: 'Přidat: pravidlo' }).click()
  const form = page.getByRole('dialog', { name: /Přidat: pravidlo/ })
  await form.getByLabel('Název').fill('Moje poučka')
  await form.getByLabel('Text').fill('Vždy nejdřív Hex.')
  await form.getByRole('button', { name: 'Uložit' }).click()
  await expect(page.getByText('Moje poučka')).toBeVisible()

  // přidání útoku s cenou ki
  await page.getByRole('button', { name: 'Přidat: útok' }).click()
  const attack = page.getByRole('dialog', { name: /Přidat: útok/ })
  await attack.getByLabel('Název').fill('Zkušební úder')
  await attack.getByLabel('Útok', { exact: true }).fill('d20+7')
  await attack.getByLabel('Zranění (text)').fill('1d6+4 bludgeoning')
  await attack.getByLabel('Druh ceny').selectOption('ki')
  await attack.getByLabel('Počet ki').selectOption('1')
  await attack.getByRole('button', { name: 'Uložit' }).click()
  const added = card(page, 'Zkušební úder')
  await expect(added.locator('[data-cost="ki"]')).toContainText('1 ki')
  await expect(added.getByRole('button', { name: /Hodit: Zkušební úder: zranění/ }).first()).toBeVisible()

  // úprava názvu
  await added.getByRole('button', { name: 'Upravit Zkušební úder' }).click()
  const edit = page.getByRole('dialog', { name: /Upravit: Zkušební úder/ })
  await edit.getByLabel('Název').fill('Zkušební úder+')
  await edit.getByRole('button', { name: 'Uložit' }).click()
  await expect(card(page, 'Zkušební úder+')).toBeVisible()

  // přeřazení: nově přidaný útok je poslední, posunout nahoru
  const titles = () => page.locator('[data-tactic-kind="attack"] h3').allTextContents()
  const before = await titles()
  expect(before.at(-1)).toBe('Zkušební úder+')
  await card(page, 'Zkušební úder+').getByRole('button', { name: 'Zkušební úder+: posunout výš' }).click()
  await expect.poll(titles).toEqual([...before.slice(0, -2), 'Zkušební úder+', before.at(-2)!])

  expect(await problems(page)).toEqual([])
  await audit(page, 'taktiky v režimu úprav')

  // obnovení stránky: změny jsou uložené na serveru
  await page.reload()
  await page.getByRole('button', { name: 'Taktiky', exact: true }).click()
  await expect(card(page, 'Zkušební úder+')).toBeVisible()
  await expect(page.getByText('Moje poučka')).toBeVisible()

  // smazání
  await page.getByRole('button', { name: 'Upravit taktiky' }).click()
  await page.getByRole('button', { name: 'Smazat Zkušební úder+' }).click()
  await expect(page.getByRole('heading', { name: 'Zkušební úder+', level: 3 })).toHaveCount(0)
  const tactics = (await (await page.request.get(`/api/characters/${id}/tactics`)).json()).tactics as { title: string }[]
  expect(tactics.map((t) => t.title)).not.toContain('Zkušební úder+')
  expect(tactics.map((t) => t.title)).toContain('Moje poučka')
})
