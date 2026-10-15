import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import path from 'node:path'

export const API_PORT = 8181
const root = path.resolve(import.meta.dirname, '..')
// DND_CONFIG jde přepsat (např. pro ověření proti MariaDB); výchozí je api/config.test.php.
const env = { ...process.env, DND_CONFIG: process.env.DND_CONFIG ?? path.join(root, 'api/config.test.php') }

async function waitForHealth(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url)
      if (res.ok) return
    } catch {
      // server ještě startuje
    }
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error(`PHP server neodpovídá na ${url}`)
}

let server: ChildProcess | undefined

export async function setup() {
  // Čistá testovací databáze + všechny migrace.
  const migrate = spawnSync('php', ['api/bin/migrate.php', '--fresh'], { cwd: root, env, encoding: 'utf8' })
  if (migrate.status !== 0) {
    throw new Error(
      `Migrace testovací DB selhaly. Běží databáze (npm run db:start)?\n${migrate.stdout}\n${migrate.stderr}`,
    )
  }

  server = spawn('php', ['-S', `127.0.0.1:${API_PORT}`, '-t', 'api', 'api/index.php'], {
    cwd: root,
    env,
    stdio: 'ignore',
  })
  await waitForHealth(`http://127.0.0.1:${API_PORT}/health`, 15_000)
}

export async function teardown() {
  server?.kill()
}
