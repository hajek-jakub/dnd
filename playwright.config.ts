import { defineConfig, devices } from '@playwright/test'

// Lokální klíče (stejné, jaké používá dev server), aby je mohly číst i testy.
try {
  process.loadEnvFile('.env.development.local')
} catch {
  // soubor chybí: testy použijí výchozí hodnoty
}

/**
 * E2E testy v Chromiu proti lokálnímu Supabase (npm run db:start) a dev serveru.
 *
 * Dva projekty, protože DM hraje na počítači a hráči z telefonu:
 *  - desktop: Chromium, 1440x900 (DM)
 *  - mobile:  Chromium s emulací Pixel 7 (dotyk, úzký displej)
 * Scénáře s více uživateli (flow.spec.ts) si DM = desktop a hráče = mobil složí samy.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:5173',
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
  webServer: {
    command: 'npm run dev -- --host localhost --port 5173 --strictPort',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
})
