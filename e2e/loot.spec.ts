import { devices, type Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { newContext, registerDm, registerViaUi, uniqueName } from './helpers'

// Loot a dílna itemů: DM si na počítači připraví složky s itemy (tučný popis, skrytá kletba) a zlatem, rozdá je přetažením
// a zaškrtnutím; hráč na telefonu item uvidí bez kletby, dokud ji DM neodhalí. A AC: magická zbroj s výběrem základu.

const fighter = (name: string, extra: Record<string, unknown> = {}) => ({
  name,
  abilityScores: { str: 14, dex: 12, con: 12, int: 10, wis: 10, cha: 10 },
  levels: [{ classIndex: 'fighter', hpRoll: null }],
  ...extra,
})

async function newCampaign(page: Page, name: string): Promise<{ campaignId: string; code: string }> {
  await page.getByLabel('Název kampaně').fill(name)
  await page.getByRole('button', { name: 'Založit kampaň' }).click()
  await expect(page).toHaveURL(/\/campaigns\//)
  const campaignId = page.url().split('/campaigns/')[1]!
  await page.getByRole('button', { name: /Vytvořit pozvánku/ }).click()
  const code = (await page.locator('code').first().textContent())?.trim() ?? ''
  return { campaignId, code }
}

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow, 'stránka nesmí jezdit do stran').toBeLessThanOrEqual(0)
}

test('DM připraví loot ve složkách a rozdá ho; hráč na telefonu vidí tučný popis, kletbu až po odhalení', async ({ page: dm, browser, baseURL, isMobile }) => {
  test.skip(isMobile, 'Dva kontexty si ten test staví sám (DM počítač + hráč telefon).')
  test.setTimeout(150_000)

  await registerDm(dm, 'lootdm')
  const { campaignId, code } = await newCampaign(dm, 'Loot kampaň')

  const phone = await newContext(browser, { ...devices['Pixel 7'], baseURL, locale: 'cs-CZ' })
  const player = await phone.newPage()
  try {
    await registerViaUi(player, { username: uniqueName('hrac'), startPath: `/join/${code}` })
    const elfka = (await (await player.request.post(`/api/campaigns/${campaignId}/characters`, { data: fighter('Elfka') })).json()).character.id as string
    // hráč na stránku lootu nesmí (přesměruje ho to na kampaň)
    await player.goto(`/campaigns/${campaignId}/dm/loot`)
    await expect(player).toHaveURL(new RegExp(`/campaigns/${campaignId}$`))

    // DM: Panel DM → Loot a itemy
    await dm.goto(`/campaigns/${campaignId}/dm`)
    await dm.getByRole('link', { name: 'Loot a itemy' }).click()
    await expect(dm.getByRole('heading', { name: 'Loot a itemy', level: 1 })).toBeVisible()

    // složky: Dungeon → Místnost 1
    await dm.getByRole('button', { name: 'Nová složka' }).first().click()
    await dm.getByRole('dialog', { name: 'Nová složka' }).getByLabel('Název složky').fill('Dungeon')
    await dm.getByRole('dialog', { name: 'Nová složka' }).getByRole('button', { name: 'Založit složku' }).click()
    const tree = dm.getByRole('navigation', { name: 'Složky lootu' })
    await tree.getByRole('button', { name: /^Dungeon/ }).click()
    await dm.getByRole('button', { name: 'Podsložka' }).click()
    await dm.getByRole('dialog', { name: 'Nová složka' }).getByLabel('Název složky').fill('Místnost 1')
    await dm.getByRole('dialog', { name: 'Nová složka' }).getByRole('button', { name: 'Založit složku' }).click()
    await tree.getByRole('button', { name: /^Místnost 1/ }).click()
    await expect(dm.getByText('Dungeon › Místnost 1')).toBeVisible()

    // vlastní zbraň s tučným názvem schopnosti a skrytou kletbou
    await dm.getByRole('button', { name: 'Nový item' }).click()
    const itemDialog = dm.getByRole('dialog', { name: 'Nový item: Dungeon › Místnost 1' })
    await itemDialog.getByRole('tab', { name: 'Vlastní item' }).click()
    await itemDialog.getByLabel('Název').fill('Démonické kopí')
    await itemDialog.getByLabel('Druh').selectOption('weapon')
    const desc = itemDialog.getByLabel(/^Popis/)
    await desc.fill('Ďábelský šepot')
    await desc.press('ControlOrMeta+a')
    await itemDialog.getByRole('button', { name: 'Tučně' }).first().click()
    await expect(desc).toHaveValue('**Ďábelský šepot**')
    // Tlačítko po vložení značek označí obalený text (v requestAnimationFrame); počkat na to, pak kurzor na konec a psát dál.
    await expect.poll(() => desc.evaluate((el: HTMLTextAreaElement) => el.selectionEnd - el.selectionStart)).toBe('Ďábelský šepot'.length)
    await desc.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(el.value.length, el.value.length))
    await desc.pressSequentially(': slyší tě.')
    await expect(desc).toHaveValue('**Ďábelský šepot**: slyší tě.')
    await itemDialog.getByRole('button', { name: 'Náhled' }).first().click()
    await expect(itemDialog.getByTestId('formatting-preview').locator('strong')).toHaveText('Ďábelský šepot')
    await itemDialog.getByRole('button', { name: 'Náhled' }).first().click()
    await itemDialog.getByLabel('Text kletby').fill('Šepot tě nutí útočit na nejbližšího.')
    await itemDialog.getByRole('button', { name: 'Přidat do lootu' }).click()
    await expect(dm.getByText('Přidáno do lootu: Démonické kopí')).toBeVisible()

    // zlato
    await dm.getByRole('button', { name: 'Zlato', exact: true }).click()
    const goldDialog = dm.getByRole('dialog', { name: 'Zlato: Dungeon › Místnost 1' })
    await goldDialog.getByLabel('Název (nepovinné)').fill('Truhla')
    await goldDialog.getByLabel('GP').fill('100')
    await goldDialog.getByRole('button', { name: 'Přidat do lootu' }).click()
    await expect(dm.getByTestId('loot-entry-Truhla')).toBeVisible()
    await expect(tree.getByRole('button', { name: /^Místnost 1/ })).toContainText('2')

    // kopí přetažením na ikonu Elfky, zlato zaškrtnutím a klepnutím; nic se nerozdá, dokud DM neklepne na Rozdat
    await dm.getByTestId('loot-entry-Démonické kopí').dragTo(dm.getByTestId('loot-target-Elfka'))
    await dm.getByLabel('Vybrat Truhla').check()
    await dm.getByTestId('loot-target-Elfka').click()
    const ready = dm.getByRole('list', { name: 'Připraveno k rozdání' })
    await expect(ready).toContainText('Démonické kopí')
    await expect(ready).toContainText('Truhla')
    await expect(dm.getByTestId('loot-target-Elfka')).toContainText('2')
    expect((await (await player.request.get(`/api/characters/${elfka}`)).json()).character.items).toHaveLength(0)

    await dm.getByRole('button', { name: 'Rozdat (2)' }).click()
    await expect(dm.getByText(/Rozdáno: Démonické kopí → Elfka/)).toBeVisible()
    await expect(dm.getByTestId('loot-entry-Démonické kopí')).toContainText('Rozdáno: Elfka')
    await expect(ready).toHaveCount(0)

    // hráč: item s tučným popisem, kletbu nevidí; zlato má
    const sheet = (await (await player.request.get(`/api/characters/${elfka}`)).json()).character
    expect(sheet.currency.gp).toBe(100)
    expect(JSON.stringify(sheet)).not.toContain('Šepot tě nutí')
    await player.goto(`/characters/${elfka}`)
    await player.getByRole('button', { name: 'Inventář', exact: true }).click()
    const row = player.getByRole('listitem').filter({ hasText: 'Démonické kopí' }).first()
    await row.getByText('Podrobnosti').click()
    await expect(row.locator('strong', { hasText: 'Ďábelský šepot' })).toBeVisible()
    await expect(row.getByTestId('curse')).toHaveCount(0)
    await expectNoHorizontalScroll(player)

    // DM kletbu odhalí na sheetu postavy, hráč ji pak vidí
    await dm.goto(`/characters/${elfka}`)
    await dm.getByRole('button', { name: 'Inventář', exact: true }).click()
    const dmRow = dm.getByRole('listitem').filter({ hasText: 'Démonické kopí' }).first()
    await dmRow.getByText('Podrobnosti').click()
    await expect(dmRow.getByTestId('curse')).toContainText('skrytá, hráč ji nevidí')
    await dmRow.getByRole('button', { name: 'Odhalit hráči' }).click()
    await expect(dmRow.getByRole('button', { name: 'Skrýt před hráčem' })).toBeVisible()
    // úprava prokletého itemu ve formuláři (kletba jde jako text, v cache je objekt) nesmí shodit stránku
    await dmRow.getByRole('button', { name: 'Upravit' }).click()
    await dmRow.getByLabel('Poznámky').fill('Našli v hrobce.')
    await dmRow.getByRole('button', { name: 'Uložit' }).click()
    await expect(dmRow.getByTestId('curse')).toContainText('Šepot tě nutí útočit na nejbližšího.')
    await expect(dmRow).toContainText('Našli v hrobce.')
    await player.reload()
    await player.getByRole('button', { name: 'Inventář', exact: true }).click()
    const revealed = player.getByRole('listitem').filter({ hasText: 'Démonické kopí' }).first()
    await revealed.getByText('Podrobnosti').click()
    await expect(revealed.getByTestId('curse')).toContainText('Šepot tě nutí útočit na nejbližšího.')
  } finally {
    await phone.close()
  }
})

test('AC: magická zbroj z pravidel s předvybraným základem změní AC NPC (Batan)', async ({ page }) => {
  test.setTimeout(90_000)
  await registerDm(page, 'acdm')
  const { campaignId } = await newCampaign(page, 'AC kampaň')
  const batan = (await (await page.request.post(`/api/campaigns/${campaignId}/characters`, { data: fighter('Batan', { kind: 'npc' }) })).json()).character.id as string
  await page.goto(`/characters/${batan}`)
  await expect(page.getByRole('button', { name: /^Armor Class: 11\./ })).toBeVisible() // 10 + DEX 1

  await page.getByRole('button', { name: 'Inventář', exact: true }).click()
  await page.getByRole('button', { name: 'Přidat item' }).click()
  const dialog = page.getByRole('dialog', { name: 'Přidat item' })
  await dialog.getByLabel('Hledat item').fill('Dwarven Plate')
  await dialog.getByRole('button', { name: 'Přidat Dwarven Plate', exact: true }).click()
  const step = dialog.getByTestId('item-base-step')
  await expect(step.getByLabel('Základní zbroj')).toHaveValue(/.+/) // předvybraná Plate Armor
  await expect(step.getByLabel('Základní zbroj').locator('option:checked')).toHaveText('Plate Armor')
  await step.getByRole('button', { name: 'Přidat' }).click()
  await expect(page.getByText('Přidáno: Dwarven Plate')).toBeVisible()
  await dialog.getByRole('button', { name: 'Zavřít' }).click()

  // zbroj se rovnou nosí: 18 + magický bonus 2
  await expect(page.getByRole('listitem').filter({ hasText: 'Dwarven Plate' }).first().getByRole('button', { name: 'Nosím' })).toBeVisible()
  await page.getByRole('button', { name: 'Přehled', exact: true }).click()
  await page.getByRole('button', { name: /^Armor Class: 20\./ }).click()
  const detail = page.getByRole('dialog', { name: 'Armor Class' })
  await expect(detail.getByText('Dwarven Plate: magický bonus')).toBeVisible()
  await detail.getByRole('button', { name: 'Zavřít' }).click()

  // obecná Armor, +1 si základ nechá vybrat; vznikne druhá zbroj, kterou postava nenosí → upozornění v detailu AC
  await page.getByRole('button', { name: 'Inventář', exact: true }).click()
  await page.getByRole('button', { name: 'Přidat item' }).click()
  await dialog.getByLabel('Hledat item').fill('Armor, +1')
  await dialog.getByRole('button', { name: 'Přidat Armor, +1', exact: true }).click()
  await expect(step.getByRole('button', { name: 'Přidat' })).toBeDisabled()
  await step.getByLabel('Základní zbroj').selectOption({ label: 'Chain Mail' })
  await step.getByRole('button', { name: 'Přidat' }).click()
  await expect(page.getByText('Přidáno: Armor, +1 (Chain Mail)')).toBeVisible()
  await dialog.getByRole('button', { name: 'Zavřít' }).click()
  await expect(page.getByRole('listitem').filter({ hasText: 'Armor, +1 (Chain Mail)' }).first().getByRole('button', { name: 'Nosit' })).toBeVisible()
  await expectNoHorizontalScroll(page)
})
