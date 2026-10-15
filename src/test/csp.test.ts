// @vitest-environment node
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = path.resolve(import.meta.dirname, '../..')
const html = readFileSync(path.join(root, 'index.html'), 'utf8')
const htaccess = readFileSync(path.join(root, 'public/.htaccess'), 'utf8')

describe('Content Security Policy', () => {
  it('otisk vloženého skriptu v index.html sedí s tím v .htaccess (jinak by se skript zablokoval)', () => {
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
    expect(scripts, 'v index.html má být právě jeden vložený skript').toHaveLength(1)
    const hash = createHash('sha256').update(scripts[0]![1]!).digest('base64')
    expect(htaccess).toContain(`'sha256-${hash}'`)
  })

  it('politika zakazuje cizí skripty, objekty, vkládání do rámců a cizí spojení', () => {
    const csp = /Content-Security-Policy "([^"]+)"/.exec(htaccess)?.[1] ?? ''
    expect(csp).toContain("default-src 'self'")
    expect(csp).toContain("object-src 'none'")
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).toContain("connect-src 'self'")
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/)
    expect(csp).not.toMatch(/script-src[^;]*unsafe-eval/)
    expect(csp).not.toMatch(/https?:\/\//) // žádná cizí doména
  })
})
