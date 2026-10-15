import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

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
