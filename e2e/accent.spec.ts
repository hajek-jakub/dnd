import AxeBuilder from '@axe-core/playwright'
import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { loginViaUi, randomTestIp, registerDm } from './helpers'

// Barva aplikace v Profilu: patří účtu (jiné zařízení ji dostane po přihlášení), ostatní uživatelé mají svou, kontrast drží.

const primary = (page: Page) => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--primary').trim())
const hue = (value: string) => Number(/oklch\([\d.]+ [\d.]+ ([\d.]+)\)/.exec(value)?.[1] ?? NaN)

test('barva aplikace: předvolba, vlastní barva, po přihlášení na jiném zařízení a návrat na výchozí', async ({ page, browser }) => {
  const username = await registerDm(page, 'accent')
  await page.goto('/profile')
  const group = page.getByRole('group', { name: 'Barva aplikace' })
  const defaultPrimary = await primary(page)

  await group.getByRole('button', { name: 'Druidský les' }).click()
  await expect(group.getByRole('button', { name: 'Druidský les' })).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(async () => hue(await primary(page))).toBeGreaterThan(120)
  expect(hue(await primary(page))).toBeLessThan(160)
  await expect.poll(async () => (await (await page.request.get('/api/auth/me')).json()).user.accent).toBe('#2e7d32')

  await page.reload()
  await expect.poll(async () => hue(await primary(page))).toBeGreaterThan(120)

  // jiné zařízení: barva přijde se účtem
  const other = await browser.newContext({ extraHTTPHeaders: { 'x-test-ip': randomTestIp() } })
  await other.addInitScript(() => localStorage.setItem('dnd.pushPrompt', 'never'))
  const phone = await other.newPage()
  await loginViaUi(phone, username)
  await expect(phone.getByRole('heading', { name: /Moje kampaně|Vítej/ }).first()).toBeVisible()
  await expect.poll(async () => hue(await primary(phone))).toBeGreaterThan(120)
  await other.close()

  // vlastní barva (modrá)
  await page.getByLabel('Vlastní barva').fill('#1e40ff')
  await expect.poll(async () => (await (await page.request.get('/api/auth/me')).json()).user.accent).toBe('#1e40ff')
  expect(hue(await primary(page))).toBeGreaterThan(240)

  // přístupnost v obou režimech s vlastní barvou
  for (const theme of ['light', 'dark'] as const) {
    await page.getByRole('group', { name: 'Motiv' }).getByRole('button', { name: theme === 'dark' ? 'Tmavý' : 'Světlý' }).click()
    await page.addStyleTag({ content: '*{transition:none!important}' })
    await page.mouse.move(0, 0)
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`), theme).toEqual([])
  }
  await page.getByRole('group', { name: 'Motiv' }).getByRole('button', { name: 'Světlý' }).click()

  await group.getByRole('button', { name: 'Krev (výchozí)' }).click()
  await expect.poll(() => primary(page)).toBe(defaultPrimary)
  await expect.poll(async () => (await (await page.request.get('/api/auth/me')).json()).user.accent).toBeNull()
})

test('barva jednoho uživatele se nepřenese na jiného', async ({ page }) => {
  await registerDm(page, 'accentx')
  await page.goto('/profile')
  const defaultPrimary = await primary(page)
  await page.getByRole('group', { name: 'Barva aplikace' }).getByRole('button', { name: 'Paktová fialová' }).click()
  await expect.poll(() => primary(page)).not.toBe(defaultPrimary)
  await page.getByRole('button', { name: 'Odhlásit se' }).click()
  await registerDm(page, 'accenty')
  await expect.poll(() => primary(page)).toBe(defaultPrimary)
})
