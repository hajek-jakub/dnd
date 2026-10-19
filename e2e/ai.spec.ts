import AxeBuilder from '@axe-core/playwright'
import { devices, type Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { newContext, registerDm, registerViaUi, uniqueName } from './helpers'

// AI pomocník DM proti napodobenému Claude API (scripts/claude-mock.mjs, spouští ho playwright.config.ts).
// DM napíše, co chce připravit, AI dohledá item v pravidlech a navrhne loot; do lootu se dostane až potvrzením.
// Hráč ani DM bez povolení (claude_users v api/config.test.php: jen jména začínající „aidm“) tlačítko nevidí.

const MOCK = 'http://127.0.0.1:8199'

async function newCampaign(page: Page, name: string): Promise<string> {
  await page.getByLabel('Název kampaně').fill(name)
  await page.getByRole('button', { name: 'Založit kampaň' }).click()
  await expect(page).toHaveURL(/\/campaigns\//)
  return page.url().split('/campaigns/')[1]!
}

async function audit(page: Page, name: string, theme: 'light' | 'dark') {
  // Přechody barev by axe změřil v půli animace (stejně jako v a11y.spec.ts).
  await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; animation: none !important; }' })
  await page.evaluate((t) => document.documentElement.classList.toggle('dark', t === 'dark'), theme)
  const results = await new AxeBuilder({ page }).include('dialog[open]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  const summary = results.violations.map((v) => `${v.id} (${v.impact}): ${v.help} → ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`)
  expect(summary, `Přístupnost: ${name}`).toEqual([])
}

test('DM si nechá od AI připravit loot a návrh potvrdí (počítač i telefon)', async ({ page }) => {
  test.setTimeout(90_000)
  await registerDm(page, 'aidm')
  const campaignId = await newCampaign(page, 'AI kampaň')

  const rules = await (await page.request.get('/api/rules?q=Bag%20of%20Holding&kinds=magic_item&scope=srd')).json()
  const bag = rules.entries.find((e: { name: string }) => e.name === 'Bag of Holding').id as string
  const key = uniqueName('e2e')
  await page.request.post(`${MOCK}/__mock/script`, {
    data: {
      key,
      responses: [
        { content: [{ type: 'text', text: 'Hledám.' }, { type: 'tool_use', id: 'tu_1', name: 'search_rules', input: { query: 'Bag of Holding' } }] },
        {
          content: [
            {
              type: 'tool_use',
              id: 'tu_2',
              name: 'propose_loot',
              input: {
                title: 'Loot: Hrobka',
                entries: [
                  { folder: ['Hrobka', 'Místnost 1'], type: 'rule_item', ruleId: bag },
                  { folder: ['Hrobka', 'Místnost 1'], type: 'gold', coins: { gp: 50 }, name: 'Truhla' },
                ],
              },
            },
          ],
        },
        { content: [{ type: 'text', text: 'Návrh je připravený: **Bag of Holding** a 50 gp.' }] },
      ],
    },
  })

  await page.getByRole('button', { name: 'AI pomocník' }).click()
  const panel = page.getByRole('dialog', { name: 'AI pomocník' })
  await expect(panel.getByText('Zkus třeba:')).toBeVisible()
  for (const theme of ['light', 'dark'] as const) await audit(page, `prázdný panel (${theme})`, theme)

  await panel.getByLabel('Zpráva pro AI').fill(`[[mock:${key}]] Připrav hrobku`)
  await panel.getByLabel('Zpráva pro AI').press('Enter')
  await expect(panel.getByText('Hledám v pravidlech: „Bag of Holding“', { exact: true })).toBeVisible()
  const proposal = panel.getByRole('region', { name: 'Návrh: Loot: Hrobka' })
  await expect(proposal.getByText('Hrobka / Místnost 1')).toBeVisible()
  await expect(proposal.getByText('Bag of Holding')).toBeVisible()
  await expect(proposal.getByText('50 gp')).toBeVisible()
  await expect(panel.locator('strong', { hasText: 'Bag of Holding' })).toBeVisible()
  await expect(panel.getByText(/Útrata tento měsíc \$\d+\.\d{2} z \$5\.00/)).toBeVisible()

  // na úzkém displeji nic nejezdí do stran
  const overflow = await panel.evaluate((d) => d.scrollWidth - d.clientWidth)
  expect(overflow).toBeLessThanOrEqual(0)
  for (const theme of ['light', 'dark'] as const) await audit(page, `konverzace s návrhem (${theme})`, theme)

  // nic se nevytvořilo, dokud DM nepotvrdí
  const before = await (await page.request.get(`/api/campaigns/${campaignId}/loot`)).json()
  expect(before.entries).toHaveLength(0)
  await proposal.getByRole('button', { name: 'Vytvořit v lootu' }).click()
  await expect(proposal.getByText('Vytvořeno', { exact: true })).toBeVisible()
  await proposal.getByRole('link', { name: 'Otevřít loot' }).click()
  await expect(page).toHaveURL(new RegExp(`/campaigns/${campaignId}/dm/loot$`))
  await expect(panel).toBeHidden()
  const tree = page.getByRole('navigation', { name: 'Složky lootu' })
  await expect(tree.getByRole('button', { name: /^Hrobka/ })).toBeVisible()

  // po znovuotevření panel pokračuje v poslední konverzaci
  await page.getByRole('button', { name: 'AI pomocník' }).click()
  await expect(panel.getByRole('region', { name: 'Návrh: Loot: Hrobka' }).getByText('Vytvořeno', { exact: true })).toBeVisible()
  await panel.getByRole('button', { name: 'Zavřít' }).click()
  await expect(panel).toBeHidden()
})

test('hráč ani DM bez povolení tlačítko AI nevidí', async ({ page, browser, baseURL, isMobile }) => {
  test.skip(isMobile, 'Telefon hráče si test staví sám.')
  test.setTimeout(90_000)
  await registerDm(page, 'dm')
  await newCampaign(page, 'Bez AI')
  await expect(page.getByRole('link', { name: 'Pravidla' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'AI pomocník' })).toHaveCount(0)

  // povolený DM pozve hráče; hráč na telefonu tlačítko nemá
  const ai = await newContext(browser, { baseURL, locale: 'cs-CZ' })
  const dm = await ai.newPage()
  const phone = await newContext(browser, { ...devices['Pixel 7'], baseURL, locale: 'cs-CZ' })
  const player = await phone.newPage()
  try {
    await registerDm(dm, 'aidm')
    await newCampaign(dm, 'S AI')
    await expect(dm.getByRole('button', { name: 'AI pomocník' })).toBeVisible()
    await dm.getByRole('button', { name: /Vytvořit pozvánku/ }).click()
    const code = (await dm.locator('code').first().textContent())?.trim() ?? ''
    await registerViaUi(player, { username: uniqueName('aidmhrac'), startPath: `/join/${code}` })
    await expect(player.getByRole('link', { name: 'Pravidla' })).toBeVisible()
    await expect(player.getByRole('button', { name: 'AI pomocník' })).toHaveCount(0)
  } finally {
    await ai.close()
    await phone.close()
  }
})
