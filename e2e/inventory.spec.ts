import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { registerDm } from './helpers'

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow, 'stránka nesmí jezdit do stran').toBeLessThanOrEqual(0)
}

/** Založí kampaň a postavu přes API (rychlé) a otevře její sheet. */
async function openCharacter(page: Page, character: Record<string, unknown>, prefix: string): Promise<{ campaignId: string; id: string }> {
  await registerDm(page, prefix)
  await page.getByLabel('Název kampaně').fill('Inventář kampaň')
  await page.getByRole('button', { name: 'Založit kampaň' }).click()
  await expect(page).toHaveURL(/\/campaigns\//)
  const campaignId = page.url().split('/campaigns/')[1]!
  const res = await page.request.post(`/api/campaigns/${campaignId}/characters`, { data: character })
  expect(res.status()).toBe(201)
  const id = (await res.json()).character.id as string
  await page.goto(`/characters/${id}`)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  return { campaignId, id }
}

const wizard3 = {
  name: 'Mág',
  abilityScores: { str: 10, dex: 14, con: 12, int: 16, wis: 10, cha: 8 },
  levels: Array.from({ length: 3 }, () => ({ classIndex: 'wizard', hpRoll: null })),
}

async function addFromRules(page: Page, name: string) {
  await page.getByRole('button', { name: 'Přidat item' }).click()
  const dialog = page.getByRole('dialog', { name: 'Přidat item' })
  await dialog.getByLabel('Hledat item').fill(name)
  await dialog.getByRole('button', { name: `Přidat ${name}`, exact: true }).click()
  await expect(page.getByText(`Přidáno: ${name}`)).toBeVisible()
  await dialog.getByRole('button', { name: 'Zavřít' }).click()
}

test('inventář: itemy z pravidel se promítnou do AC, equip, attunement a efekty s původem', async ({ page }) => {
  await openCharacter(page, wizard3, 'inv')
  await expect(page.getByRole('button', { name: /^Armor Class: 12\./ })).toBeVisible() // 10 + DEX 2

  await page.getByRole('button', { name: 'Inventář', exact: true }).click()
  await addFromRules(page, 'Chain Mail')
  await addFromRules(page, 'Shield')
  await addFromRules(page, 'Ring of Protection')
  await expect(page.getByRole('status', { name: 'Attunement: 0 ze 3' })).toBeVisible()

  const row = (name: string) => page.getByRole('listitem').filter({ hasText: name }).first()
  await row('Chain Mail').getByRole('button', { name: 'Nosit' }).click()
  await row('Shield').getByRole('button', { name: 'Nosit' }).click()
  await page.getByRole('button', { name: 'Přehled', exact: true }).click()
  await expect(page.getByRole('button', { name: /^Armor Class: 18\./ })).toBeVisible() // 16 (bez DEX) + štít 2

  // prsten: nejdřív jen nošený (bez attunementu neplatí), pak attunovaný
  await page.getByRole('button', { name: 'Inventář', exact: true }).click()
  await row('Ring of Protection').getByRole('button', { name: 'Nosit' }).click()
  await page.getByRole('button', { name: 'Přehled', exact: true }).click()
  await expect(page.getByRole('button', { name: /^Armor Class: 18\./ })).toBeVisible()
  await page.getByRole('button', { name: 'Inventář', exact: true }).click()
  await row('Ring of Protection').getByRole('button', { name: 'Attune' }).click()
  await expect(page.getByRole('status', { name: 'Attunement: 1 ze 3' })).toBeVisible()
  await page.getByRole('button', { name: 'Přehled', exact: true }).click()
  await page.getByRole('button', { name: /^Armor Class: 19\./ }).click()
  const detail = page.getByRole('dialog', { name: 'Armor Class' })
  await expect(detail.getByText('Ring of Protection')).toBeVisible() // původ bonusu je vidět
  await expect(detail.getByText('Chain Mail')).toBeVisible()
  await detail.getByRole('button', { name: 'Zavřít' }).click()

  // sundání zbroje vrátí AC
  await page.getByRole('button', { name: 'Inventář', exact: true }).click()
  await row('Chain Mail').getByRole('button', { name: 'Nosím' }).click()
  await page.getByRole('button', { name: 'Přehled', exact: true }).click()
  await expect(page.getByRole('button', { name: /^Armor Class: 15\./ })).toBeVisible() // 10 + DEX 2 + štít 2 + prsten 1
  await expectNoHorizontalScroll(page)
})

test('inventář: vlastní item s efektem, množství, smazání a nosnost se zapnutým pravidlem kampaně', async ({ page }) => {
  const { campaignId, id } = await openCharacter(page, wizard3, 'cust')
  await page.goto(`/campaigns/${campaignId}`)
  await page.getByLabel('Sledovat nosnost a přetížení').check()
  await expect(page.getByLabel('Sledovat nosnost a přetížení')).toBeChecked()
  await page.goto(`/characters/${id}`)
  await expect(page.getByRole('button', { name: /^Rychlost: 30 ft/ })).toBeVisible()

  await page.getByRole('button', { name: 'Inventář', exact: true }).click()
  await page.getByRole('button', { name: 'Přidat item' }).click()
  const dialog = page.getByRole('dialog', { name: 'Přidat item' })
  await dialog.getByRole('tab', { name: 'Vlastní' }).click()
  await dialog.getByLabel('Název').fill('Boty rychlosti')
  await dialog.getByLabel('Váha jednoho kusu (lb)').fill('4')
  await dialog.getByRole('button', { name: 'Přidat efekt' }).click()
  await dialog.getByLabel('Efekt 1: cíl').selectOption('speed')
  await dialog.getByLabel('Efekt 1: hodnota').fill('10')
  await dialog.getByRole('button', { name: 'Přidat item' }).last().click()
  await expect(page.getByText('Item přidán')).toBeVisible()

  const row = page.getByRole('listitem').filter({ hasText: 'Boty rychlosti' }).first()
  await row.getByRole('button', { name: 'Nosit' }).click()
  await page.getByRole('button', { name: 'Přehled', exact: true }).click()
  await expect(page.getByRole('button', { name: /^Rychlost: 40 ft/ })).toBeVisible()

  // těžký náklad: 10 x STR 10 = 100 lb -> přetížení -10 ft
  await page.getByRole('button', { name: 'Inventář', exact: true }).click()
  await page.getByRole('button', { name: 'Přidat item' }).click()
  const second = page.getByRole('dialog', { name: 'Přidat item' })
  await second.getByRole('tab', { name: 'Vlastní' }).click()
  await second.getByLabel('Název').fill('Kámen')
  await second.getByLabel('Váha jednoho kusu (lb)').fill('60')
  await second.getByRole('button', { name: 'Přidat item' }).last().click()
  await expect(page.getByText('Item přidán')).toBeVisible()
  await expect(page.getByText(/přetížený \(−10 ft\)/)).toBeVisible()
  await page.getByRole('button', { name: 'Přehled', exact: true }).click()
  await expect(page.getByRole('button', { name: /^Rychlost: 30 ft/ })).toBeVisible()

  // smazání kamene vrátí rychlost
  await page.getByRole('button', { name: 'Inventář', exact: true }).click()
  const stone = page.getByRole('listitem').filter({ hasText: 'Kámen' }).first()
  await stone.getByText('Podrobnosti').click()
  page.once('dialog', (d) => void d.accept())
  await stone.getByRole('button', { name: 'Smazat' }).click()
  await expect(page.getByRole('listitem').filter({ hasText: 'Kámen' })).toHaveCount(0)
  await expectNoHorizontalScroll(page)
})

test('peníze: úprava, převod mincí a celková hodnota', async ({ page }) => {
  await openCharacter(page, wizard3, 'money')
  await page.getByRole('button', { name: 'Inventář', exact: true }).click()
  await page.getByLabel('Zlaté (gp)').fill('25')
  await page.getByLabel('Stříbrné (sp)').fill('7')
  await page.getByLabel('Měděné (cp)').click() // blur uloží
  await page.reload()
  await page.getByRole('button', { name: 'Inventář', exact: true }).click()
  await expect(page.getByLabel('Zlaté (gp)')).toHaveValue('25')
  await expect(page.getByText('celkem 25,7 gp')).toBeVisible()

  await page.getByRole('button', { name: 'Převést mince' }).click()
  const dialog = page.getByRole('dialog', { name: 'Převést mince' })
  await dialog.getByLabel('Kolik').fill('10')
  await dialog.getByLabel('Z', { exact: true }).selectOption('gp')
  await dialog.getByLabel('Na', { exact: true }).selectOption('sp')
  await expect(dialog.getByText('Vyjde 100 sp za 10 gp.')).toBeVisible()
  await dialog.getByRole('button', { name: 'Převést', exact: true }).click()
  await expect(page.getByLabel('Zlaté (gp)')).toHaveValue('15')
  await expect(page.getByLabel('Stříbrné (sp)')).toHaveValue('107')

  await page.getByRole('button', { name: 'Převést mince' }).click()
  const second = page.getByRole('dialog', { name: 'Převést mince' })
  await second.getByLabel('Kolik').fill('999')
  await second.getByLabel('Z', { exact: true }).selectOption('gp')
  await expect(second.getByText(/nejde převést/)).toBeVisible()
  await expect(second.getByRole('button', { name: 'Převést', exact: true })).toBeDisabled()
})

test('kouzla: přidání, seslání se sloty a upcastem, koncentrace a detail', async ({ page }) => {
  await openCharacter(page, wizard3, 'spell')
  await page.getByRole('button', { name: 'Kouzla', exact: true }).click()

  const add = async (name: string) => {
    await page.getByRole('button', { name: 'Přidat kouzlo' }).click()
    const dialog = page.getByRole('dialog', { name: 'Přidat kouzlo' })
    await dialog.getByLabel('Hledat kouzlo').fill(name)
    await dialog.getByRole('button', { name: `Přidat ${name}`, exact: true }).click()
    await expect(page.getByText(`Přidáno: ${name}`)).toBeVisible()
    await dialog.getByRole('button', { name: 'Zavřít' }).click()
  }
  await add('Fire Bolt')
  await add('Magic Missile')
  await add('Detect Magic')
  await expect(page.getByRole('region', { name: 'Cantripy' }).getByText('Fire Bolt')).toBeVisible()
  await expect(page.getByText('cantripy 1 / 3')).toBeVisible()

  // detail kouzla
  await page.getByRole('region', { name: 'Kouzla 1. úrovně' }).getByRole('button', { name: /^Magic Missile/ }).click()
  const detail = page.getByRole('dialog', { name: 'Magic Missile' })
  await expect(detail.getByText('1 action')).toBeVisible()
  await expect(detail.getByText(/three glowing darts of magical force/)).toBeVisible()
  await detail.getByRole('button', { name: 'Zavřít' }).click()

  // seslání na 1. úrovni
  await page.getByRole('button', { name: 'Seslat Magic Missile' }).click()
  const cast = page.getByRole('dialog', { name: 'Seslat: Magic Missile' })
  await expect(cast.getByLabel(/Slot 1\. úrovně \(zbývá 4\)/)).toBeChecked()
  await cast.getByRole('button', { name: 'Seslat', exact: true }).click()
    await expect(page.getByRole('region', { name: 'Sloty' }).getByText(/1\. úroveň: 3 \/ 4/)).toBeVisible()

  // upcast na 2. úroveň ukáže text pro vyšší úroveň
  await page.getByRole('button', { name: 'Seslat Magic Missile' }).click()
  const upcast = page.getByRole('dialog', { name: 'Seslat: Magic Missile' })
  await upcast.getByLabel(/Slot 2\. úrovně/).check()
  await expect(upcast.getByText('Na vyšší úrovni')).toBeVisible()
  await upcast.getByRole('button', { name: 'Seslat', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Sloty' }).getByText(/2\. úroveň: 1 \/ 2/)).toBeVisible()

  // koncentrace
  await page.getByRole('button', { name: 'Seslat Detect Magic' }).click()
  await page.getByRole('dialog', { name: 'Seslat: Detect Magic' }).getByRole('button', { name: 'Seslat', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Soustředíš se na Detect Magic' })).toBeVisible()
  await page.reload()
  await page.getByRole('button', { name: 'Kouzla', exact: true }).click()
  await expect(page.getByText('Soustředíš se na')).toBeVisible()
  await page.getByRole('button', { name: 'Ukončit koncentraci' }).click()
  await expect(page.getByText('Soustředíš se na')).toHaveCount(0)

  // cantrip nespotřebuje slot
  await page.getByRole('button', { name: 'Seslat Fire Bolt' }).click()
  const bolt = page.getByRole('dialog', { name: 'Seslat: Fire Bolt' })
  await expect(bolt.getByText('Cantripy nespotřebují slot.')).toBeVisible()
  await bolt.getByRole('button', { name: 'Seslat', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Sloty' }).getByText(/1\. úroveň: 3 \/ 4/)).toBeVisible()
  await expectNoHorizontalScroll(page)
})

test('povinný případ: warlock v multiclassu sesílá z pact slotu, který se obnoví na short rest', async ({ page }) => {
  await openCharacter(
    page,
    {
      name: 'Hajoš',
      abilityScores: { str: 10, dex: 16, con: 14, int: 8, wis: 15, cha: 14 },
      levels: [...Array(5).fill({ classIndex: 'monk', hpRoll: null }), { classIndex: 'warlock', hpRoll: null }],
      subclasses: { monk: 'open-hand', warlock: 'fiend' },
    },
    'warlock',
  )
  await page.getByRole('button', { name: 'Kouzla', exact: true }).click()
  await page.getByRole('button', { name: 'Přidat kouzlo' }).click()
  const dialog = page.getByRole('dialog', { name: 'Přidat kouzlo' })
  await dialog.getByLabel('Seznam kouzel třídy').selectOption({ label: 'Warlock' })
  await dialog.getByLabel('Hledat kouzlo').fill('Expeditious Retreat')
  await dialog.getByRole('button', { name: 'Přidat Expeditious Retreat', exact: true }).click()
  await dialog.getByRole('button', { name: 'Zavřít' }).click()

  await page.getByRole('button', { name: 'Seslat Expeditious Retreat' }).click()
  const cast = page.getByRole('dialog', { name: 'Seslat: Expeditious Retreat' })
  // žádné běžné sloty: jediná volba je pact slot 1. úrovně
  await expect(cast.getByLabel(/Pact slot 1\. úrovně \(zbývá 1\)/)).toBeChecked()
  await expect(cast.getByLabel(/^Slot /)).toHaveCount(0)
  await cast.getByRole('button', { name: 'Seslat', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Sloty' }).getByText('Pact (1. úroveň): 0 / 1')).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: 'Soustředíš se na Expeditious Retreat' })).toBeVisible()

  // další seslání už nejde
  await page.getByRole('button', { name: 'Seslat Expeditious Retreat' }).click()
  await expect(page.getByRole('dialog', { name: 'Seslat: Expeditious Retreat' }).getByText('Nemáš žádný volný slot')).toBeVisible()
  await page.getByRole('dialog', { name: 'Seslat: Expeditious Retreat' }).getByRole('button', { name: 'Zavřít' }).click()

  // short rest obnoví pact slot
  await page.getByRole('button', { name: 'Přehled', exact: true }).click()
  await page.getByRole('button', { name: 'Short rest' }).click()
  await page.getByRole('dialog', { name: 'Short rest' }).getByRole('button', { name: 'Dokončit short rest' }).click()
  await page.getByRole('button', { name: 'Kouzla', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Sloty' }).getByText('Pact (1. úroveň): 1 / 1')).toBeVisible()
})

test('záložky Kouzla a Inventář: dotykové prvky dost velké a žádný horizontální scroll', async ({ page }) => {
  await openCharacter(page, wizard3, 'touch')
  for (const tab of ['Kouzla', 'Inventář']) {
    await page.getByRole('button', { name: tab, exact: true }).click()
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
    expect(small, `${tab}: prvky nižší než 44 px`).toEqual([])
  }
})
