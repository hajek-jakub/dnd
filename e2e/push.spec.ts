import AxeBuilder from '@axe-core/playwright'
import { expect, test } from './fixtures'
import { registerDm } from './helpers'

// Push notifikace: nastavení v profilu. Skutečné odeslání a příjem ověřují API testy (api-tests/push.test.ts),
// protože headless Chromium se k push službě Googlu nepřipojí.

test('profil: karta push notifikací nabídne zapnutí a ukáže zablokované oprávnění', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(Notification, 'permission', { get: () => 'granted', configurable: true }))
  await registerDm(page, 'push')
  await page.goto('/profile')
  const card = page.getByRole('heading', { name: 'Push notifikace' })
  await expect(card).toBeVisible()
  await expect(page.getByRole('button', { name: /Zapnout push notifikace/ })).toBeVisible()
  await expect(page.getByText('Hody kostkou se nikdy neposílají')).toBeVisible()
  const box = await page.getByRole('button', { name: /Zapnout push notifikace/ }).boundingBox()
  expect(box!.height).toBeGreaterThanOrEqual(44)
})

test('profil: zablokované notifikace ukážou návod, ne tlačítko', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(Notification, 'permission', { get: () => 'denied', configurable: true }))
  await registerDm(page, 'pushden')
  await page.goto('/profile')
  await expect(page.getByText(/zablokované/)).toBeVisible()
  await expect(page.getByRole('button', { name: /Zapnout push notifikace/ })).toHaveCount(0)
})

test('service worker je dostupný a klepnutí na notifikaci přepne aplikaci na danou stránku', async ({ page }) => {
  const sw = await page.request.get('/sw.js')
  expect(sw.status()).toBe(200)
  expect(await sw.text()).toContain('showNotification')

  await registerDm(page, 'pushnav')
  await page.goto('/profile')
  await expect(page.getByRole('heading', { name: 'Push notifikace' })).toBeVisible()
  // service worker pošle otevřené aplikaci cestu z notifikace
  await page.evaluate(() => navigator.serviceWorker.dispatchEvent(new MessageEvent('message', { data: { type: 'navigate', path: '/rules' } })))
  await expect(page).toHaveURL(/\/rules$/)
  // cizí tvar zprávy se ignoruje
  await page.evaluate(() => navigator.serviceWorker.dispatchEvent(new MessageEvent('message', { data: { type: 'navigate', path: 'https://evil.example/' } })))
  await expect(page).toHaveURL(/\/rules$/)
})

// Nabídka při otevření aplikace. Ostatní testy ji mají potlačenou (e2e/fixtures.ts), tady se zapíná zpět (jednou za záložku).
const enablePrompt = () => {
  if (!sessionStorage.getItem('prompt-test')) {
    sessionStorage.setItem('prompt-test', '1')
    localStorage.removeItem('dnd.pushPrompt')
  }
}

test('při otevření aplikace se nabídne zapnutí push; „Později“ ji na pár dní schová, v profilu nepřekáží', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(Notification, 'permission', { get: () => 'default', configurable: true }))
  await page.addInitScript(enablePrompt)
  await registerDm(page, 'pushask')
  const offer = page.getByRole('region', { name: 'Nabídka push notifikací' })
  await expect(offer).toBeVisible()
  await expect(offer.getByRole('button', { name: 'Zapnout' })).toBeVisible()
  for (const name of ['Zapnout', 'Později', 'Nechci']) {
    const box = await offer.getByRole('button', { name }).boundingBox()
    expect(box!.height, name).toBeGreaterThanOrEqual(44)
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(0)

  // přístupnost nabídky ve světlém i tmavém režimu
  for (const dark of [false, true]) {
    await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; animation: none !important; }' })
    await page.evaluate((d) => document.documentElement.classList.toggle('dark', d), dark)
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`), dark ? 'tmavý režim' : 'světlý režim').toEqual([])
  }
  await page.evaluate(() => document.documentElement.classList.remove('dark'))

  // v profilu je nastavení přímo, nabídka tam nepřekáží (přechod bez znovunačtení, to by znovu potlačilo nabídku)
  await page.getByRole('link', { name: 'Profil a nastavení' }).click()
  await expect(page.getByRole('heading', { name: 'Push notifikace' })).toBeVisible()
  await expect(offer).toHaveCount(0)

  await page.getByRole('link', { name: 'Úvodní stránka' }).click()
  await expect(offer).toBeVisible()
  await offer.getByRole('button', { name: 'Později' }).click()
  await expect(offer).toHaveCount(0)
  const until = await page.evaluate(() => localStorage.getItem('dnd.pushPrompt'))
  expect(Number(until)).toBeGreaterThan(Date.now() + 6 * 24 * 3600 * 1000)
})

test('„Nechci“ nabídku vypne nadobro; zablokované oprávnění ji nenabídne vůbec', async ({ page, browser }) => {
  await page.addInitScript(() => Object.defineProperty(Notification, 'permission', { get: () => 'default', configurable: true }))
  await page.addInitScript(enablePrompt)
  await registerDm(page, 'pushno')
  const offer = page.getByRole('region', { name: 'Nabídka push notifikací' })
  await offer.getByRole('button', { name: 'Nechci' }).click()
  await expect(offer).toHaveCount(0)
  expect(await page.evaluate(() => localStorage.getItem('dnd.pushPrompt'))).toBe('never')

  const other = await browser.newPage()
  await other.addInitScript(() => Object.defineProperty(Notification, 'permission', { get: () => 'denied', configurable: true }))
  await other.addInitScript(enablePrompt)
  await registerDm(other, 'pushblk')
  await expect(other.getByRole('heading', { name: 'Moje kampaně' })).toBeVisible()
  await expect(other.getByRole('region', { name: 'Nabídka push notifikací' })).toHaveCount(0)
  await other.close()
})
