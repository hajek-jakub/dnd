import { devices } from '@playwright/test'
import { expect, test } from './fixtures'
import { newContext, registerDm, registerViaUi, uniqueName } from './helpers'

// Předávání itemů a peněz mezi hráči: DM na počítači, hráč na telefonu.

const base = (name: string) => ({
  name,
  abilityScores: { str: 12, dex: 12, con: 12, int: 12, wis: 12, cha: 12 },
  levels: [{ classIndex: 'fighter', hpRoll: null }],
})

test('item a peníze se předají mezi postavami, příjemce je uvidí a limity platí', async ({ page: dm, browser, baseURL }) => {
  await registerDm(dm, 'xfer')
  await dm.getByLabel('Název kampaně').fill('Předávání')
  await dm.getByRole('button', { name: 'Založit kampaň' }).click()
  await expect(dm).toHaveURL(/\/campaigns\//)
  const campaignId = dm.url().split('/campaigns/')[1]!
  await dm.getByRole('button', { name: /Vytvořit pozvánku/ }).click()
  const code = (await dm.locator('code').first().textContent())?.trim() ?? ''

  const dmChar = (await (await dm.request.post(`/api/campaigns/${campaignId}/characters`, { data: base('Dárce') })).json()).character.id as string
  await dm.request.post(`/api/characters/${dmChar}/items`, { data: { name: 'Magická dýka', kind: 'weapon', quantity: 3, weapon: { damageDice: '1d4', category: 'simple', range: 'melee', properties: ['Finesse'] } } })
  await dm.request.patch(`/api/characters/${dmChar}`, { data: { currency: { cp: 0, sp: 0, ep: 0, gp: 50, pp: 0 } } })

  const phone = await newContext(browser, { ...devices['Pixel 7'], baseURL, locale: 'cs-CZ' })
  const player = await phone.newPage()
  try {
    await registerViaUi(player, { username: uniqueName('hrac'), startPath: `/join/${code}` })
    const playerChar = (await (await player.request.post(`/api/campaigns/${campaignId}/characters`, { data: base('Příjemce') })).json()).character.id as string

    // DM předá 2 ze 3 dýk
    await dm.goto(`/characters/${dmChar}`)
    await dm.getByRole('button', { name: 'Inventář', exact: true }).click()
    const row = dm.getByRole('listitem').filter({ hasText: 'Magická dýka' }).first()
    await row.getByRole('button', { name: /^Podrobnosti:/ }).click()
    await row.getByRole('button', { name: 'Předat' }).click()
    const dialog = dm.getByRole('dialog', { name: 'Předat: Magická dýka' })
    await dialog.getByLabel('Komu').selectOption({ label: 'Příjemce' })
    await dialog.getByLabel(/Kolik kusů/).fill('2')
    await dialog.getByRole('button', { name: 'Předat', exact: true }).click()
    await expect(dm.getByText('Předáno')).toBeVisible()
    await expect(dm.getByRole('listitem').filter({ hasText: 'Magická dýka' }).first()).not.toContainText('×') // zbyl jediný kus

    // hráč na telefonu je vidí
    await player.goto(`/characters/${playerChar}`)
    await player.getByRole('button', { name: 'Inventář', exact: true }).click()
    await expect(player.getByRole('listitem').filter({ hasText: 'Magická dýka' }).first()).toContainText('×2')

    // DM předá peníze, víc než má nejde
    await dm.getByRole('button', { name: 'Předat peníze' }).click()
    const pay = dm.getByRole('dialog', { name: 'Předat peníze' })
    await pay.getByLabel('Komu').selectOption({ label: 'Příjemce' })
    await pay.getByLabel('gp', { exact: true }).fill('60')
    await expect(pay.getByText('Nemáš dost mincí.')).toBeVisible()
    await expect(pay.getByRole('button', { name: 'Předat', exact: true })).toBeDisabled()
    await pay.getByLabel('gp', { exact: true }).fill('20')
    await pay.getByRole('button', { name: 'Předat', exact: true }).click()
    await expect(dm.getByText('Peníze předány')).toBeVisible()
    await expect(dm.getByLabel('Zlaté (gp)')).toHaveValue('30')

    await player.reload()
    await player.getByRole('button', { name: 'Inventář', exact: true }).click()
    await expect(player.getByLabel('Zlaté (gp)')).toHaveValue('20')
  } finally {
    await phone.close()
  }
})
