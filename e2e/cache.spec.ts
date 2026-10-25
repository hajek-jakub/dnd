import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { registerDm, uniqueName } from './helpers'

// Data z API se ukládají v prohlížeči (IndexedDB, src/lib/query-persist.ts): po znovuotevření se stránka ukáže hned,
// i když server ještě neodpověděl. Po odhlášení v prohlížeči nic nezůstane.

const savedUser = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<string | null>((resolve) => {
        const open = indexedDB.open('dnd-cache', 1)
        open.onupgradeneeded = () => open.result.createObjectStore('queries')
        open.onsuccess = () => {
          const req = open.result.transaction('queries').objectStore('queries').get('state')
          req.onsuccess = () => {
            resolve((req.result as { userId?: string } | undefined)?.userId ?? null)
            open.result.close()
          }
          req.onerror = () => resolve(null)
        }
        open.onerror = () => resolve(null)
      }),
  )

test('uložená data: kampaň se po znovuotevření ukáže i bez odpovědi serveru, odhlášení cache smaže', async ({ page }) => {
  await registerDm(page, 'cachedm')
  const name = uniqueName('Kešovaná ')
  await page.getByLabel('Název kampaně').fill(name)
  await page.getByRole('button', { name: 'Založit kampaň' }).click()
  await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible()
  await expect.poll(() => savedUser(page), { timeout: 10_000 }).not.toBeNull()

  // server odpovídá jen na ověření relace, data kampaně nepřijdou
  await page.route(/\/api\/(?!auth\/me)/, () => {})
  await page.reload()
  await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible()
  await page.unrouteAll({ behavior: 'ignoreErrors' })

  await page.goto('/profile')
  await page.getByRole('button', { name: 'Odhlásit se' }).click()
  await expect(page).toHaveURL(/\/login/)
  await expect.poll(() => savedUser(page)).toBeNull()
})
