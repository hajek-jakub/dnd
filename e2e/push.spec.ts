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
