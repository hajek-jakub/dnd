// Ověří, že PRODUKČNÍ build (npm run build) běží pod Content Security Policy z public/.htaccess bez jediného porušení.
// Spustí vlastní PHP API proti testovací DB (dnd_test), `vite preview` a Chromium, projde hlavní stránky a vypíše porušení.
//   npm run build && node scripts/csp-smoke.mjs
import { spawn, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { chromium } from '@playwright/test'

const root = path.resolve(import.meta.dirname, '..')
const csp = /Content-Security-Policy "([^"]+)"/.exec(readFileSync(path.join(root, 'public/.htaccess'), 'utf8'))?.[1]
if (!csp) throw new Error('V public/.htaccess chybí Content-Security-Policy')

// Jen testovací konfigurace, nikdy ostrá (migrate --fresh maže databázi!).
const env = { ...process.env, DND_CONFIG: path.join(root, 'api/config.test.php'), API_PROXY_TARGET: 'http://127.0.0.1:8183' }
const migrate = spawnSync('sh', ['-c', 'php api/bin/migrate.php --fresh && php api/bin/seed.php'], { cwd: root, env, encoding: 'utf8' })
if (migrate.status !== 0) throw new Error(`Příprava testovací DB selhala:\n${migrate.stdout}\n${migrate.stderr}`)

const php = spawn('php', ['-S', '127.0.0.1:8183', '-t', 'api', 'api/index.php'], { cwd: root, env, stdio: 'ignore' })
const preview = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', '4175', '--strictPort'], { cwd: root, env, stdio: 'ignore' })
const stop = () => {
  php.kill()
  preview.kill()
}
process.on('exit', stop)

async function waitFor(url) {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(url)).ok) return
    } catch {
      // ještě startuje
    }
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error(`Neodpovídá: ${url}`)
}
await waitFor('http://127.0.0.1:8183/health')
await waitFor('http://127.0.0.1:4175/')

const browser = await chromium.launch()
const violations = []
let failed = false
try {
  for (const [dark, label] of [[false, 'světlý'], [true, 'tmavý']]) {
    const context = await browser.newContext({ baseURL: 'http://127.0.0.1:4175', viewport: { width: 1280, height: 900 }, extraHTTPHeaders: { 'x-test-ip': `10.9.${dark ? 1 : 2}.7` } })
    await context.addInitScript((isDark) => {
      if (isDark) localStorage.setItem('dnd-theme', 'dark')
      window.addEventListener('securitypolicyviolation', (e) => {
        ;(window.__csp ??= []).push(`${e.violatedDirective} ${e.blockedURI} ${e.sourceFile ?? ''}:${e.lineNumber ?? ''}`)
      })
    }, dark)
    // CSP hlavičku posílá na ostrém serveru Apache; tady ji přidáme k odpovědím s dokumentem (stejná hodnota ze souboru).
    await context.route('**/*', async (route) => {
      try {
        const response = await route.fetch()
        const headers = { ...response.headers() }
        if (route.request().resourceType() === 'document') headers['content-security-policy'] = csp
        await route.fulfill({ response, headers })
      } catch {
        // stránka se zavírá a požadavek už nikoho nezajímá
      }
    })
    const page = await context.newPage()
    page.on('console', (m) => {
      if (/Content Security Policy|violates the following/i.test(m.text())) violations.push(`[${label}] console: ${m.text()}`)
    })
    page.on('pageerror', (e) => violations.push(`[${label}] pageerror: ${e.message}`))

    const username = `csp${Math.random().toString(36).slice(2, 9)}`
    await page.goto('/register')
    await page.getByLabel('Kód pozvánky nebo registrační heslo').fill('test-key')
    await page.getByLabel('Přihlašovací jméno').fill(username)
    await page.getByLabel('Heslo', { exact: true }).fill('tajneheslo123')
    await page.getByRole('button', { name: 'Vytvořit účet' }).click()
    await page.getByRole('heading', { name: 'Moje kampaně' }).waitFor()

    await page.getByLabel('Název kampaně').fill('CSP')
    await page.getByRole('button', { name: 'Založit kampaň' }).click()
    await page.waitForURL(/\/campaigns\//)
    const campaignId = page.url().split('/campaigns/')[1]
    const character = (await (await page.request.post(`/api/campaigns/${campaignId}/characters`, { data: { name: 'Csp', abilityScores: { str: 10, dex: 14, con: 12, int: 10, wis: 13, cha: 8 }, levels: [{ classIndex: 'monk', hpRoll: null }] } })).json()).character.id
    // 1×1 PNG
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')
    const map = (await (await page.request.post(`/api/campaigns/${campaignId}/maps`, { multipart: { name: 'M', image: { name: 'm.png', mimeType: 'image/png', buffer: png } } })).json()).map.id
    await page.request.post(`/api/maps/${map}/pins`, { data: { x: 0, y: 0, title: 'Bod' } })

    for (const url of ['/', `/campaigns/${campaignId}`, `/campaigns/${campaignId}/dm`, `/campaigns/${campaignId}/messages?t=group`, `/campaigns/${campaignId}/maps`, `/campaigns/${campaignId}/maps/${map}`, `/characters/${character}`, '/rules', '/notifications', '/profile']) {
      await page.goto(url)
      await page.waitForLoadState('networkidle')
      if (url.includes('/maps/')) await page.locator('.leaflet-image-layer').waitFor()
    }
    await page.goto(`/characters/${character}`)
    await page.getByRole('button', { name: 'Kostky', exact: true }).click()
    await page.getByRole('button', { name: 'Hodit d20' }).click()
    await page.getByRole('region', { name: 'Log hodů' }).waitFor()

    const isDark = await page.evaluate(() => document.documentElement.classList.contains('dark'))
    if (dark && !isDark) violations.push('[tmavý] vložený skript tmavého režimu byl zablokován (třída dark chybí)')
    for (const v of (await page.evaluate(() => window.__csp ?? []))) violations.push(`[${label}] ${v}`)
    await context.unrouteAll({ behavior: 'ignoreErrors' })
    await context.close()
  }
} catch (e) {
  failed = true
  console.error('Smoke test selhal:', e)
} finally {
  await browser.close()
  stop()
}

if (violations.length > 0 || failed) {
  console.error(`Porušení CSP (${violations.length}):\n - ${violations.join('\n - ')}`)
  process.exit(1)
}
console.log('CSP: žádné porušení, produkční build běží v pořádku ve světlém i tmavém režimu.')
process.exit(0)
