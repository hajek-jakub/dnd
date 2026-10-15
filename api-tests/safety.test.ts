import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { Client, PASSWORD, expectStatus, registerUser } from './client'

const root = path.resolve(import.meta.dirname, '..')

// Jednou se omylem smazala ostrá databáze (--fresh s ostrou konfigurací v proměnné prostředí). Tyhle testy hlídají pojistky.
describe('pojistky proti smazání ostré databáze', () => {
  const config = (db: Record<string, unknown>) => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), 'cfg-')), 'config.php')
    writeFileSync(file, `<?php return ['db' => ${JSON.stringify(db).replace(/[{]/g, '[').replace(/[}]/g, ']').replace(/":/g, '"=>')}, 'debug' => true];`)
    return file
  }
  const fresh = (file: string) => spawnSync('php', ['api/bin/migrate.php', '--fresh'], { cwd: root, encoding: 'utf8', env: { PATH: process.env.PATH ?? '', DND_CONFIG: file } })

  it('migrate --fresh odmítne vzdálený databázový server (dřív než se připojí)', () => {
    const res = fresh(config({ host: 'db.example.cz', port: 3306, name: 'dnd_ostra', user: 'x', password: 'x' }))
    expect(res.status).not.toBe(0)
    expect(res.stderr + res.stdout).toContain('vzdáleném serveru')
  })

  it('migrate --fresh odmítne databázi, která se nejmenuje dnd*', () => {
    const res = fresh(config({ host: '127.0.0.1', port: 3307, name: 'cizi_db', user: 'x', password: 'x' }))
    expect(res.status).not.toBe(0)
    expect(res.stderr + res.stdout).toContain('dnd*')
  })

  it('ostrá konfigurace api/config.production.php (pokud existuje) nikdy neprojde --fresh', () => {
    const res = fresh(path.join(root, 'api/config.production.php'))
    expect(res.status).not.toBe(0)
  })
})

describe('reset hesla přes příkazovou řádku', () => {
  const run = (args: string[], password?: string) =>
    spawnSync('php', ['api/bin/set-password.php', ...args], {
      cwd: root,
      encoding: 'utf8',
      env: { PATH: process.env.PATH ?? '', DND_CONFIG: path.join(root, 'api/config.test.php'), ...(password ? { NEW_PASSWORD: password } : {}) },
    })

  it('nastaví nové heslo, staré přestane platit a stará relace se odhlásí', async () => {
    const user = await registerUser('reset')
    expectStatus(await user.client.get('/campaigns'), 200)
    const res = run([user.username], 'nove-heslo-12345')
    expect(res.status, res.stderr).toBe(0)
    expect(res.stdout).toContain('odhlášené')

    expectStatus(await user.client.get('/campaigns'), 401) // původní relace je pryč
    const fresh = new Client()
    expectStatus(await fresh.post('/auth/login', { username: user.username, password: PASSWORD }), 401)
    expectStatus(await fresh.post('/auth/login', { username: user.username, password: 'nove-heslo-12345' }), 200)
  })

  it('odmítne chybějící údaje, krátké heslo a neexistujícího uživatele', () => {
    expect(run([]).status).toBe(2)
    expect(run(['nekdo']).status).toBe(2)
    expect(run(['nekdo'], 'kratke').status).toBe(2)
    expect(run(['neexistuje-' + Date.now()], 'dlouhe-heslo-123').status).toBe(3)
  })
})
