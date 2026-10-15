import { expect, type APIRequestContext, type Page } from '@playwright/test'

/** Lokální schránka, do které Supabase posílá e-maily (Mailpit). */
const MAILPIT = 'http://127.0.0.1:54324'

export function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.cz`
}

/** Počká na nejnovější e-mail pro adresu a vytáhne z něj přihlašovací odkaz. */
async function magicLinkFor(request: APIRequestContext, email: string): Promise<string> {
  let link: string | undefined
  await expect
    .poll(
      async () => {
        const search = await request.get(`${MAILPIT}/api/v1/search`, {
          params: { query: `to:${email}`, limit: '1' },
        })
        const { messages } = (await search.json()) as { messages: { ID: string }[] }
        const first = messages[0]
        if (!first) return false
        const detail = await request.get(`${MAILPIT}/api/v1/message/${first.ID}`)
        const body = (await detail.json()) as { HTML?: string; Text?: string }
        const text = `${body.HTML ?? ''}\n${body.Text ?? ''}`
        const match = text.match(/https?:\/\/[^\s"'<>]*\/auth\/v1\/verify[^\s"'<>]*/)
        link = match?.[0]?.replace(/&amp;/g, '&')
        return Boolean(link)
      },
      { message: `Přihlašovací e-mail pro ${email} nepřišel`, timeout: 20_000 },
    )
    .toBe(true)
  return link!
}

/** Přihlásí uživatele přes magic link (stejně jako skutečný hráč). */
export async function login(page: Page, email: string, startPath = '/'): Promise<void> {
  await page.goto(startPath)
  await expect(page).toHaveURL(/\/login/)
  await page.getByLabel('E-mail').fill(email)
  await page.getByRole('button', { name: 'Poslat přihlašovací odkaz' }).click()
  await expect(page.getByText('Odkaz je na cestě')).toBeVisible()

  const link = await magicLinkFor(page.request, email)
  await page.goto(link)
}

/** Vrátí přístupový token přihlášeného uživatele ze Supabase session v localStorage. */
export async function accessToken(page: Page): Promise<string> {
  const token = await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.startsWith('sb-') && k.endsWith('-auth-token'))
    if (!key) return null
    return (JSON.parse(localStorage.getItem(key) ?? 'null') as { access_token?: string } | null)?.access_token ?? null
  })
  expect(token, 'v localStorage chybí Supabase session').toBeTruthy()
  return token!
}

/** Rozbalí anon klíč z lokálního .env souboru (stejný, jaký používá aplikace). */
export function supabaseEnv(): { url: string; anonKey: string } {
  return {
    url: process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321',
    anonKey: process.env.VITE_SUPABASE_ANON_KEY ?? '',
  }
}
