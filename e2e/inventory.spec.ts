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

  // prsten: postava ho má u sebe, ale bez attunementu neplatí; nosit se nemusí (jen zbraně a zbroj)
  await page.getByRole('button', { name: 'Inventář', exact: true }).click()
  await expect(row('Ring of Protection').getByRole('button', { name: 'Nosit' })).toHaveCount(0)
  await expect(row('Ring of Protection').getByTestId('not-worn')).toHaveText(/bonusy platí až po attunementu/)
  await expect(page.getByRole('region', { name: 'Zbraně a zbroj' }).getByRole('listitem')).toHaveCount(2)
  await expect(page.getByRole('region', { name: 'Magické předměty' })).toContainText('Ring of Protection')
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

test('inventář: vlastní item s efektem, množství a smazání', async ({ page }) => {
  await openCharacter(page, wizard3, 'cust')
  await expect(page.getByRole('button', { name: /^Rychlost: 30 ft/ })).toBeVisible()

  await page.getByRole('button', { name: 'Inventář', exact: true }).click()
  await page.getByRole('button', { name: 'Přidat item' }).click()
  const dialog = page.getByRole('dialog', { name: 'Přidat item' })
  await dialog.getByRole('tab', { name: 'Vlastní' }).click()
  await dialog.getByLabel('Název').fill('Boty rychlosti')
  await dialog.getByRole('button', { name: 'Přidat efekt' }).click()
  await dialog.getByLabel('Efekt 1: cíl').selectOption('speed')
  await dialog.getByLabel('Efekt 1: hodnota').fill('10')
  await dialog.getByRole('button', { name: 'Přidat item' }).last().click()
  await expect(page.getByText('Item přidán')).toBeVisible()

  // bonus platí rovnou, nic se nenasazuje
  const row = page.getByRole('listitem').filter({ hasText: 'Boty rychlosti' }).first()
  await expect(row.getByRole('button', { name: /Nosit|u sebe/ })).toHaveCount(0)
  await page.getByRole('button', { name: 'Přehled', exact: true }).click()
  await expect(page.getByRole('button', { name: /^Rychlost: 40 ft/ })).toBeVisible()

  // další item bez efektu rychlost nemění
  await page.getByRole('button', { name: 'Inventář', exact: true }).click()
  await page.getByRole('button', { name: 'Přidat item' }).click()
  const second = page.getByRole('dialog', { name: 'Přidat item' })
  await second.getByRole('tab', { name: 'Vlastní' }).click()
  await second.getByLabel('Název').fill('Kámen')
  await second.getByRole('button', { name: 'Přidat item' }).last().click()
  await expect(page.getByText('Item přidán')).toBeVisible()
  await page.getByRole('button', { name: 'Přehled', exact: true }).click()
  await expect(page.getByRole('button', { name: /^Rychlost: 40 ft/ })).toBeVisible()

  // smazání itemu
  await page.getByRole('button', { name: 'Inventář', exact: true }).click()
  const stone = page.getByRole('listitem').filter({ hasText: 'Kámen' }).first()
  await stone.getByRole('button', { name: /^Podrobnosti:/ }).click()
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
  // blur uloží; před obnovením stránky se počká na odpověď serveru, jinak by reload zrušil rozeslaný požadavek
  await Promise.all([page.waitForResponse((r) => r.request().method() === 'PATCH' && /\/characters\//.test(r.url())), page.getByLabel('Měděné (cp)').click()])
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

  // pact slot došel: zbývá jen seslání bez slotu (kouzlo z rasy nebo předmětu)
  await page.getByRole('button', { name: 'Seslat Expeditious Retreat' }).click()
  const again = page.getByRole('dialog', { name: 'Seslat: Expeditious Retreat' })
  await expect(again.getByLabel(/^Pact slot/)).toHaveCount(0)
  await expect(again.getByLabel(/^Bez slotu \(kouzlo z rasy/)).toBeChecked()
  await again.getByRole('button', { name: 'Zavřít' }).click()

  // short rest obnoví pact slot
  await page.getByRole('button', { name: 'Přehled', exact: true }).click()
  await page.getByRole('button', { name: 'Short rest' }).click()
  await page.getByRole('dialog', { name: 'Short rest' }).getByRole('button', { name: 'Dokončit short rest' }).click()
  await page.getByRole('button', { name: 'Kouzla', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Sloty' }).getByText('Pact (1. úroveň): 1 / 1')).toBeVisible()
})

test('kouzlo bez slotu (Drow Magic): rogue bez slotů ho sešle, hlídaný počet se spotřebuje a long rest ho obnoví', async ({ page }) => {
  await openCharacter(page, { name: 'Robinn', abilityScores: { str: 10, dex: 16, con: 8, int: 13, wis: 12, cha: 16 }, levels: Array.from({ length: 6 }, () => ({ classIndex: 'rogue', hpRoll: null })) }, 'drow')
  await page.getByRole('button', { name: 'Kouzla', exact: true }).click()
  await page.getByRole('button', { name: 'Přidat kouzlo' }).click()
  const dialog = page.getByRole('dialog', { name: 'Přidat kouzlo' })
  await dialog.getByLabel('Seznam kouzel třídy').selectOption({ label: 'Mimo třídu (rasa, item, ...)' })
  await dialog.getByLabel('Hledat kouzlo').fill('Faerie Fire')
  await dialog.getByRole('button', { name: 'Přidat Faerie Fire', exact: true }).click()
  await expect(page.getByText('Přidáno: Faerie Fire')).toBeVisible()
  await dialog.getByRole('button', { name: 'Zavřít' }).click()

  // bez slotů jde seslat bez slotu (dřív bylo tlačítko Seslat vypnuté)
  await page.getByRole('button', { name: 'Seslat Faerie Fire' }).click()
  const cast = page.getByRole('dialog', { name: 'Seslat: Faerie Fire' })
  await expect(cast.getByLabel(/^Bez slotu \(kouzlo z rasy/)).toBeChecked()
  await expect(cast.getByLabel(/^Slot /)).toHaveCount(0)
  // hlídat 1× za long rest
  await cast.getByRole('button', { name: /Hlídat počet seslání bez slotu/ }).click()
  await cast.getByLabel('Kolikrát').fill('1')
  await cast.getByLabel('Obnoví').selectOption('long')
  await cast.getByRole('button', { name: 'Uložit' }).click()
  await expect(cast.getByLabel('Bez slotu (zbývá 1 z 1, obnova: long rest)')).toBeChecked()
  await cast.getByRole('button', { name: 'Seslat', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Soustředíš se na Faerie Fire' })).toBeVisible()

  // použití došlo: seslat už nejde
  await page.getByRole('button', { name: 'Seslat Faerie Fire' }).click()
  await expect(cast.getByText('Použití bez slotu došla (obnova: long rest) a nemáš ani volný slot.')).toBeVisible()
  await expect(cast.getByRole('button', { name: 'Seslat', exact: true })).toBeDisabled()
  await cast.getByRole('button', { name: 'Zavřít' }).click()
  await page.reload()
  await page.getByRole('button', { name: 'Přehled', exact: true }).click()
  await expect(page.getByText('Faerie Fire (bez slotu)')).toBeVisible() // počítadlo je i mezi zdroji

  // long rest použití vrátí
  await page.getByRole('button', { name: 'Long rest' }).click()
  await page.getByRole('dialog', { name: 'Long rest' }).getByRole('button', { name: 'Dát si long rest' }).click()
  await page.getByRole('button', { name: 'Kouzla', exact: true }).click()
  await page.getByRole('button', { name: 'Seslat Faerie Fire' }).click()
  await expect(cast.getByLabel('Bez slotu (zbývá 1 z 1, obnova: long rest)')).toBeChecked()
  await expectNoHorizontalScroll(page)
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

test('utratit peníze: rozmění zlatý na drobné, zapíše poznámku a nepustí platbu bez peněz', async ({ page }) => {
  const { id } = await openCharacter(page, { ...wizard3, name: 'Hospodský host' }, 'spend')
  await page.request.patch(`/api/characters/${id}`, { data: { currency: { cp: 0, sp: 0, ep: 0, gp: 3, pp: 0 } } })
  await page.reload()
  await page.getByRole('button', { name: 'Inventář', exact: true }).click()
  await expect(page.getByLabel('Zlaté (gp)')).toHaveValue('3')

  await page.getByRole('button', { name: 'Utratit', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Utratit peníze' })
  await dialog.getByLabel('Stříbrné (sp)').fill('5')
  await dialog.getByLabel('Za co (nepovinné)').fill('Pivo u barmana')
  await expect(dialog.getByText('Zaplatíš 5 sp.')).toBeVisible()
  await dialog.getByRole('button', { name: 'Zaplatit' }).click()
  await expect(page.getByText('Utraceno 5 sp: Pivo u barmana')).toBeVisible()
  // ze 3 gp zbyly 2 gp a 5 sp drobných
  await expect(page.getByLabel('Zlaté (gp)')).toHaveValue('2')
  await expect(page.getByLabel('Stříbrné (sp)')).toHaveValue('5')

  // víc, než má: upozornění a tlačítko je neaktivní
  await page.getByRole('button', { name: 'Utratit', exact: true }).click()
  const again = page.getByRole('dialog', { name: 'Utratit peníze' })
  await again.getByLabel('Zlaté (gp)').fill('10')
  await expect(again.getByRole('alert')).toContainText('Nemáš dost peněz')
  await expect(again.getByRole('button', { name: 'Zaplatit' })).toBeDisabled()
  await expectNoHorizontalScroll(page)
})

test('náboje: Wand of Wonder má počítadlo v inventáři i v přehledu, dobití hodí kostkou, long rest dobíjí', async ({ page }) => {
  await openCharacter(page, { ...wizard3, name: 'Hůlkař' }, 'charges')
  await page.getByRole('button', { name: 'Inventář', exact: true }).click()
  await addFromRules(page, 'Wand of Wonder')
  const wand = page.getByRole('listitem').filter({ hasText: 'Wand of Wonder' }).first()
  const charges = (n: number, max = 7) => page.getByRole('status', { name: `Náboje Wand of Wonder: ${n} z ${max}` })
  await expect(charges(7)).toBeVisible()
  await expect(wand.getByText('obnova 1d6+1 za úsvitu')).toBeVisible()
  await expect(wand.getByRole('button', { name: 'Dobít Wand of Wonder' })).toBeDisabled() // plná

  await wand.getByRole('button', { name: 'Použít náboj: Wand of Wonder' }).click()
  await wand.getByRole('button', { name: 'Použít náboj: Wand of Wonder' }).click()
  await expect(charges(5)).toBeVisible()
  await page.reload()
  await page.getByRole('button', { name: 'Inventář', exact: true }).click()
  await expect(charges(5)).toBeVisible()
  await expectNoHorizontalScroll(page)

  // přehled: sekce Náboje itemů ve Zdrojích a slotech
  await page.getByRole('button', { name: 'Přehled', exact: true }).click()
  const section = page.getByRole('region', { name: 'Náboje itemů' })
  await section.getByRole('button', { name: 'Vrátit náboj: Wand of Wonder' }).click()
  await expect(charges(6)).toBeVisible()
  // chybí jeden náboj, hod 1d6+1 vrátí vždy právě jeden
  await section.getByRole('button', { name: 'Dobít Wand of Wonder' }).click()
  await expect(page.getByText(/^Dobité náboje: Wand of Wonder \+1 \(hod 1d6\+1 = [2-7]\)$/)).toBeVisible()
  await expect(charges(7)).toBeVisible()

  // long rest dobije spotřebované
  await section.getByRole('button', { name: 'Použít náboj: Wand of Wonder' }).click()
  await expect(charges(6)).toBeVisible()
  await page.getByRole('button', { name: 'Long rest' }).click()
  const rest = page.getByRole('dialog', { name: 'Long rest' })
  await expect(rest.getByText('Dobijí se náboje: Wand of Wonder')).toBeVisible()
  await rest.getByRole('button', { name: 'Dát si long rest' }).click()
  await expect(charges(7)).toBeVisible()

  // úprava: jiné maximum a obnova všech, pak bez nábojů
  await page.getByRole('button', { name: 'Inventář', exact: true }).click()
  await wand.getByRole('button', { name: /^Podrobnosti:/ }).click()
  await wand.getByRole('button', { name: 'Upravit' }).click()
  const form = page.getByRole('dialog', { name: 'Upravit: Wand of Wonder' })
  await form.getByLabel('Počet nábojů').fill('3')
  await form.getByLabel('Obnova (za úsvitu)').fill('all')
  await form.getByRole('button', { name: 'Uložit' }).click()
  await expect(charges(3, 3)).toBeVisible()
  await expect(wand.getByText('obnova všech za úsvitu')).toBeVisible()
  await wand.getByRole('button', { name: 'Upravit' }).click()
  await form.getByLabel('Počet nábojů').fill('')
  await form.getByRole('button', { name: 'Uložit' }).click()
  await expect(wand.getByTestId('item-charges')).toHaveCount(0)
})

test('inventář: skupiny podle druhu, hledání, množství a použití přímo v řádku', async ({ page }) => {
  const { id } = await openCharacter(page, wizard3, 'invgroups')
  const items = [
    { name: 'Dýka', kind: 'weapon', weapon: { damageDice: '1d4', damageType: 'Piercing', category: 'simple', range: 'melee', properties: ['Finesse'] } },
    { name: 'Lektvar léčení', kind: 'potion', quantity: 2, consumable: true },
    { name: 'Plášť ochrany', kind: 'wondrous', requiresAttunement: true, effects: [{ target: 'ac', value: 1 }] },
    { name: 'Lano', kind: 'other' },
    { name: 'Pochodeň', kind: 'other', quantity: 5, consumable: true },
    { name: 'Křesadlo', kind: 'other' },
    { name: 'Deka', kind: 'other' },
    { name: 'Čutora', kind: 'other' },
  ]
  for (const data of items) expect((await page.request.post(`/api/characters/${id}/items`, { data })).ok()).toBeTruthy()
  await page.goto(`/characters/${id}?tab=inventory`)

  const group = (name: string) => page.getByRole('region', { name })
  await expect(group('Zbraně a zbroj')).toContainText('Dýka')
  await expect(group('Magické předměty')).toContainText('Plášť ochrany')
  await expect(group('Spotřební').getByRole('listitem')).toHaveCount(2)
  await expect(group('Ostatní vybavení').getByRole('listitem')).toHaveCount(4)
  await expect(page.getByRole('button', { name: /u sebe/i })).toHaveCount(0)

  // lektvar: Použít přímo v řádku, po posledním „Došlo“
  const potion = page.getByRole('listitem').filter({ hasText: 'Lektvar léčení' })
  await potion.getByRole('button', { name: 'Použít Lektvar léčení (−1 ks)' }).click()
  await expect(potion).toContainText('×1')
  await potion.getByRole('button', { name: 'Použít Lektvar léčení (−1 ks)' }).click()
  await expect(potion.getByRole('button', { name: 'Použít Lektvar léčení (−1 ks)' })).toHaveText('Došlo')

  // množství v podrobnostech
  const rope = page.getByRole('listitem').filter({ hasText: 'Lano' })
  await rope.getByRole('button', { name: 'Podrobnosti: Lano' }).click()
  await expect(rope.getByRole('button', { name: 'Podrobnosti: Lano' })).toHaveAttribute('aria-expanded', 'true')
  await rope.getByRole('button', { name: '+1 ks' }).click()
  await expect(rope).toContainText('×2')

  // hledání bez diakritiky
  await page.getByLabel('Hledat v inventáři').fill('cutora')
  await expect(page.getByRole('listitem').filter({ hasText: 'Čutora' })).toBeVisible()
  await expect(page.getByRole('listitem').filter({ hasText: 'Dýka' })).toHaveCount(0)
  await page.getByLabel('Hledat v inventáři').fill('nic takového')
  await expect(page.getByText('Nic takového postava nemá.')).toBeVisible()
  await expectNoHorizontalScroll(page)
})
