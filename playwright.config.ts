import path from 'node:path'
import { defineConfig, devices } from '@playwright/test'

/**
 * E2E testy v Chromiu proti PHP API + testovací MySQL (dnd_test) a vlastnímu dev serveru.
 * Vyžadují běžící databázi: npm run db:start.
 *
 * Dva projekty, protože DM hraje na počítači a hráči z telefonu:
 *  - desktop: Chromium, 1440x900 (DM)
 *  - mobile:  Chromium s emulací Pixel 7 (dotyk, úzký displej)
 * Scénář s více uživateli (flow.spec.ts) si DM = desktop a hráče = mobil složí sám.
 *
 * Porty jsou oddělené od běžného vývoje (5173 / 8080), takže testy nepřekážejí.
 * Databáze se při každém běhu smaže a vytvoří znovu.
 */
const WEB_PORT = 5174
const API_PORT = 8182
const testConfig = path.resolve(import.meta.dirname, 'api/config.test.php')

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'cs-CZ',
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'mobile',
      use: { ...devices['Pixel 7'] },
      // Vícerolový scénář řídí oba viewporty sám, stačí ho pustit jednou.
      testIgnore: /flow\.spec\.ts/,
    },
  ],
  webServer: [
    {
      command: `php api/bin/migrate.php --fresh && php -S 127.0.0.1:${API_PORT} -t api api/index.php`,
      url: `http://127.0.0.1:${API_PORT}/health`,
      env: { DND_CONFIG: testConfig },
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `npm run dev -- --host localhost --port ${WEB_PORT} --strictPort`,
      url: `http://localhost:${WEB_PORT}`,
      env: { API_PROXY_TARGET: `http://127.0.0.1:${API_PORT}` },
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
})
