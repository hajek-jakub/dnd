import { expect, type Browser, type BrowserContextOptions, type Page } from '@playwright/test'

export const PASSWORD = 'tajneheslo123'
/** Registrační heslo z api/config.test.php (pro DM / prvního uživatele). */
export const REGISTRATION_KEY = 'test-key'

export function uniqueName(prefix: string): string {
  return `${prefix}${Math.random().toString(36).slice(2, 9)}`
}

/** Náhodná IP pro hlavičku X-Test-Ip: testovací konfigurace API ji bere místo skutečné adresy (rate limity). */
export function randomTestIp(): string {
  return `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${1 + Math.floor(Math.random() * 250)}`
}

/** Nový kontext (např. telefon hráče) s vlastní testovací IP. */
export async function newContext(browser: Browser, options: BrowserContextOptions) {
  return browser.newContext({
    ...options,
    extraHTTPHeaders: { ...options.extraHTTPHeaders, 'x-test-ip': randomTestIp() },
  })
}

/**
 * Zaregistruje uživatele přes formulář (stejně jako skutečný člověk).
 * Z libovolné chráněné adresy se přesměruje na přihlášení, odtud na registraci.
 * Když `code` chybí a adresa je /join/KOD, kód se předvyplní z odkazu.
 */
export async function registerViaUi(
  page: Page,
  options: { username: string; code?: string; startPath?: string; displayName?: string },
): Promise<void> {
  await page.goto(options.startPath ?? '/')
  await expect(page).toHaveURL(/\/login/)
  await page.getByRole('link', { name: 'Zaregistruj se' }).click()
  await expect(page.getByRole('heading', { name: 'Registrace' })).toBeVisible()

  if (options.code !== undefined) await page.getByLabel('Kód pozvánky nebo registrační heslo').fill(options.code)
  await page.getByLabel('Přihlašovací jméno').fill(options.username)
  if (options.displayName) await page.getByLabel('Zobrazované jméno (nepovinné)').fill(options.displayName)
  await page.getByLabel('Heslo', { exact: true }).fill(PASSWORD)
  await page.getByRole('button', { name: 'Vytvořit účet' }).click()
  await expect(page).not.toHaveURL(/\/(register|login)/)
}

/** Zaregistruje nového DM / prvního uživatele pomocí registračního hesla. */
export async function registerDm(page: Page, prefix = 'dm'): Promise<string> {
  const username = uniqueName(prefix)
  await registerViaUi(page, { username, code: REGISTRATION_KEY })
  await expect(page.getByRole('heading', { name: 'Moje kampaně' })).toBeVisible()
  return username
}

export async function loginViaUi(page: Page, username: string, password = PASSWORD): Promise<void> {
  await page.goto('/')
  await expect(page).toHaveURL(/\/login/)
  await page.getByLabel('Jméno').fill(username)
  await page.getByLabel('Heslo').fill(password)
  await page.getByRole('button', { name: 'Přihlásit se' }).click()
}
