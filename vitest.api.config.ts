import path from 'node:path'
import { defineConfig } from 'vitest/config'

// API testy: běží proti skutečnému PHP API a testovací MySQL (dnd_test), bez prohlížeče.
// Vyžadují běžící databázi (npm run db:start). PHP server a čistou DB si globalSetup připraví sám.
export default defineConfig({
  // alias kvůli tomu, že test seedu postavy počítá sheet pravidlovým enginem z frontendu
  resolve: { alias: { '@': path.resolve(import.meta.dirname, './src') } },
  test: {
    name: 'api',
    environment: 'node',
    include: ['api-tests/**/*.test.ts'],
    globalSetup: ['./api-tests/global-setup.ts'],
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
})
