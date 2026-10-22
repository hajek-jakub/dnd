import AxeBuilder from '@axe-core/playwright'
import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { registerDm } from './helpers'

// Automatické bonusy tříd (Rage, Sneak Attack) a společníci postavy. Počítač i telefon.

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow, 'stránka nesmí jezdit do stran').toBeLessThanOrEqual(0)
}

/** Dotykové prvky aspoň 44 px (jako layout sweep) a přístupnost podle axe ve světlém i tmavém režimu. */
async function expectAccessible(page: Page, name: string) {
  const small = await page.evaluate(() => {
    const out: string[] = []
    for (const el of document.querySelectorAll<HTMLElement>('main button, main input, main select, main textarea')) {
      const rect = el.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) continue
      if (el instanceof HTMLInputElement && el.type === 'checkbox') continue
      if (rect.height < 43.5) out.push(`${el.tagName} "${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 30)}" ${Math.round(rect.height)} px`)
    }
    return out
  })
  expect(small, `Dotykové cíle: ${name}`).toEqual([])
  for (const theme of ['light', 'dark']) {
    await page.evaluate((t) => document.documentElement.classList.toggle('dark', t === 'dark'), theme)
    await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; animation: none !important; }' })
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
    const summary = results.violations.map((v) => `${v.id} (${v.impact}): ${v.help} → ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`)
    expect(summary, `Přístupnost (${theme}): ${name}`).toEqual([])
  }
  await page.evaluate(() => document.documentElement.classList.remove('dark'))
}

/** Založí kampaň a postavu přes API, vybaví ji zbraněmi a otevře její sheet. */
async function openCharacter(
  page: Page,
  prefix: string,
  character: Record<string, unknown>,
  weapons: { name: string; dice: string; type: string; properties: string[]; range?: 'melee' | 'ranged' }[] = [],
): Promise<string> {
  await registerDm(page, prefix)
  await page.getByLabel('Název kampaně').fill('Bonusy tříd')
  await page.getByRole('button', { name: 'Založit kampaň' }).click()
  await expect(page).toHaveURL(/\/campaigns\//)
  const campaignId = page.url().split('/campaigns/')[1]!
  const res = await page.request.post(`/api/campaigns/${campaignId}/characters`, { data: character })
  expect(res.status()).toBe(201)
  const id = (await res.json()).character.id as string
  for (const w of weapons) {
    const item = await page.request.post(`/api/characters/${id}/items`, {
      data: { name: w.name, kind: 'weapon', weapon: { damageDice: w.dice, damageType: w.type, category: 'martial', range: w.range ?? 'melee', properties: w.properties } },
    })
    expect(item.status()).toBe(201)
    await page.request.patch(`/api/characters/${id}/items/${(await item.json()).item.id}`, { data: { equipped: true } })
  }
  await page.goto(`/characters/${id}`)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  return id
}

test('barbar: Rage stojí použití, přidá +2 ke zranění na STR a jde ukončit', async ({ page }) => {
  await openCharacter(
    page,
    'rage',
    { name: 'Borys', abilityScores: { str: 16, dex: 12, con: 14, int: 8, wis: 10, cha: 8 }, levels: Array.from({ length: 5 }, () => ({ classIndex: 'barbarian', hpRoll: null })) },
    [{ name: 'Greataxe', dice: '1d12', type: 'Slashing', properties: ['heavy', 'two-handed'] }],
  )
  const dmg = (bonus: number) => page.getByRole('button', { name: new RegExp(`^Hodit: Greataxe: zranění \\(1d12\\+${bonus}\\)$`) })
  const rage = page.getByTestId('rage-toggle')

  await expect(dmg(3)).toBeVisible()
  await expect(rage).toHaveAttribute('aria-pressed', 'false')
  await expect(rage).toContainText('zbývá 3 z 3')

  await rage.click()
  await expect(rage).toHaveAttribute('aria-pressed', 'true')
  await expect(dmg(5)).toBeVisible() // STR +3 a Rage +2
  await expect(page.getByRole('list', { name: 'Stavy' })).toContainText('Raging')
  await expect(page.getByTestId('condition-impacts')).toContainText('Rage')
  await expectNoHorizontalScroll(page)
  await expectAccessible(page, 'barbar v Rage')

  // po obnovení stránky Rage trvá a použití zůstalo utracené
  await page.reload()
  await expect(page.getByTestId('rage-toggle')).toHaveAttribute('aria-pressed', 'true')
  await expect(dmg(5)).toBeVisible()

  await page.getByTestId('rage-toggle').click()
  await expect(page.getByTestId('rage-toggle')).toHaveAttribute('aria-pressed', 'false')
  await expect(dmg(3)).toBeVisible()
  await expect(page.getByTestId('rage-toggle')).toContainText('zbývá 2 z 3')
})

test('rogue: Sneak Attack se zapíná zvlášť a přidá kostky jen Finesse zbrani', async ({ page }) => {
  await openCharacter(
    page,
    'sneak',
    { name: 'Vika', abilityScores: { str: 8, dex: 16, con: 12, int: 12, wis: 10, cha: 10 }, levels: Array.from({ length: 5 }, () => ({ classIndex: 'rogue', hpRoll: null })) },
    [
      { name: 'Rapier', dice: '1d8', type: 'Piercing', properties: ['finesse'] },
      { name: 'Warhammer', dice: '1d8', type: 'Bludgeoning', properties: ['versatile'] },
    ],
  )
  const sneak = page.getByTestId('rider-sneak-attack')
  await expect(sneak).toContainText('3d6')
  await expect(sneak).toHaveAttribute('aria-pressed', 'false')
  await expect(page.getByRole('button', { name: /^Hodit: Rapier: zranění \(1d8\+3\)$/ })).toBeVisible()

  await sneak.click()
  await expect(sneak).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: /^Hodit: Rapier: zranění \+ Sneak Attack \(1d8\+3\+3d6\)$/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Hodit: Rapier: zranění \+ Sneak Attack \(kritický\) \(1d8\+3\+3d6\)$/ })).toBeVisible()
  // Warhammer nemá Finesse ani dálkový dosah: bez Sneak Attack
  await expect(page.getByRole('button', { name: /^Hodit: Warhammer: zranění \(1d8-1\)$/ })).toBeVisible()
  await expectNoHorizontalScroll(page)
  await expectAccessible(page, 'rogue se Sneak Attack')

  await sneak.click()
  await expect(page.getByRole('button', { name: /^Hodit: Rapier: zranění \(1d8\+3\)$/ })).toBeVisible()
})

test('společníci: přidání z pravidel, HP, hody, úprava, další kus a smazání', async ({ page }) => {
  await openCharacter(page, 'comp', {
    name: 'Mág',
    abilityScores: { str: 10, dex: 14, con: 12, int: 16, wis: 10, cha: 8 },
    levels: Array.from({ length: 3 }, () => ({ classIndex: 'wizard', hpRoll: null })),
  })
  const card = page.getByTestId('companions-card')
  await expect(card.getByRole('heading', { name: 'Společníci', level: 2 })).toBeVisible()

  // --- přidání: předvyplnění nestvůrou ze SRD a vlastní úprava
  await card.getByRole('button', { name: 'Přidat' }).click()
  const dialog = page.getByRole('dialog', { name: 'Přidat společníka' })
  await expect(dialog.getByLabel('Iniciativa +')).toHaveCount(0)
  await dialog.getByRole('button', { name: /Z pravidel/ }).click()
  await dialog.getByLabel('Hledat nestvůru').fill('Wolf')
  await dialog.getByRole('button', { name: 'Použít Wolf', exact: true }).click()
  await expect(dialog.getByLabel('Jméno')).toHaveValue('Wolf')
  await dialog.getByLabel('Jméno').fill('Šedák')
  await dialog.getByRole('button', { name: 'Uložit' }).click()
  await expect(dialog).toHaveCount(0)

  const wolf = page.getByTestId('companion-Šedák')
  await expect(wolf).toBeVisible()
  await expect(wolf).toContainText('AC 13')
  await expect(page.getByTestId('companion-hp-Šedák')).toHaveText('11')
  await expectNoHorizontalScroll(page)
  await expectAccessible(page, 'společník')

  // --- HP: zranění až na nulu, pak léčení; hodnota přežije obnovení
  await wolf.getByRole('button', { name: 'Šedák: −5 HP' }).click()
  await expect(page.getByTestId('companion-hp-Šedák')).toHaveText('6')
  await wolf.getByLabel('Šedák: kolik HP').fill('20')
  await wolf.getByRole('button', { name: 'Šedák: zranit' }).click()
  await expect(page.getByTestId('companion-hp-Šedák')).toHaveText('0')
  await expect(wolf).toContainText('Padl')
  await wolf.getByRole('button', { name: 'Šedák: +5 HP' }).click()
  await expect(page.getByTestId('companion-hp-Šedák')).toHaveText('5')
  await page.reload()
  await expect(page.getByTestId('companion-hp-Šedák')).toHaveText('5')

  // --- hod útoku za společníka (okno s kostkou, hod patří postavě)
  await page.getByTestId('companion-Šedák').getByRole('button', { name: /^Hodit: Šedák: Bite útok$/ }).click()
  await expect(page.getByRole('dialog', { name: 'Hod kostkou' }).getByTestId('roll-result-total')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'Hod kostkou' })).toHaveCount(0)

  // --- úprava, další kus, smazání
  await page.getByRole('button', { name: 'Upravit Šedák' }).click()
  const edit = page.getByRole('dialog', { name: /Upravit: Šedák/ })
  await edit.getByLabel('Jméno').fill('Vlk')
  await edit.getByRole('button', { name: 'Uložit' }).click()
  await expect(page.getByTestId('companion-Vlk')).toBeVisible()
  await page.getByRole('button', { name: 'Přidat další: Vlk' }).click()
  await expect(page.getByTestId('companion-Vlk 2')).toBeVisible()
  await expect(page.getByTestId('companion-hp-Vlk 2')).toHaveText('11')

  page.once('dialog', (d) => void d.accept())
  await page.getByRole('button', { name: 'Smazat Vlk 2' }).click()
  await expect(page.getByTestId('companion-Vlk 2')).toHaveCount(0)
  await expect(page.getByTestId('companion-Vlk')).toBeVisible()
  await expectNoHorizontalScroll(page)
})
