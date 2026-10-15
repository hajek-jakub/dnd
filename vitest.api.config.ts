import { defineConfig } from 'vitest/config'

// API testy: běží proti skutečnému PHP API a testovací MySQL (dnd_test), bez prohlížeče.
// Vyžadují běžící databázi (npm run db:start). PHP server a čistou DB si globalSetup připraví sám.
export default defineConfig({
  test: {
    name: 'api',
    environment: 'node',
    include: ['api-tests/**/*.test.ts'],
    globalSetup: ['./api-tests/global-setup.ts'],
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
})
