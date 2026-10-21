import { test as base, expect } from '@playwright/test'
import { randomTestIp } from './helpers'

// Každý test se tváří jako jiný klient (X-Test-Ip), aby se testy nehádaly o rate limity.
export const test = base.extend({
  context: async ({ context }, use) => {
    await context.setExtraHTTPHeaders({ 'x-test-ip': randomTestIp() })
    // Nabídka push notifikací při otevření aplikace by měnila rozložení všech testů; vlastní test (push.spec.ts) ji zapíná zpět.
    await context.addInitScript(() => localStorage.setItem('dnd.pushPrompt', 'never'))
    await use(context)
  },
})

export { expect }
