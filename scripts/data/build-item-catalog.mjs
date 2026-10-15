#!/usr/bin/env node
/**
 * Jednorázově sestaví katalog magických itemů (jen FAKTA, ne popisy) z dvou zdrojů:
 *  - aidedd.org/dnd-filters/magic-items.php  (název, typ, vzácnost, attunement, zdroj, odkaz na stránku itemu)
 *  - app.eventyrgames.com/pricelist           (ceny v gp)
 * Výstup: api/data/extra/item-catalog.json (commitovaný, seed ho načítá na serveru).
 *
 * Použití:
 *   curl -s https://www.aidedd.org/dnd-filters/magic-items.php -o aidedd.html
 *   # Eventyr je JS aplikace: otevři stránku v prohlížeči, ulož text stránky (např. přes Cursor WebFetch) do eventyr.txt
 *   node scripts/data/build-item-catalog.mjs aidedd.html eventyr.txt
 *
 * Popisy z aidedd se záměrně NEkopírují (jsou chráněné); u itemů mimo SRD se ukládá jen odkaz na jejich stránku.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const [aideddFile, eventyrFile] = process.argv.slice(2)
if (!aideddFile || !eventyrFile) {
  console.error('Použití: node scripts/data/build-item-catalog.mjs <aidedd.html> <eventyr.txt>')
  process.exit(1)
}

const entities = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#039;': "'", '&#39;': "'", '&nbsp;': ' ', '&acute;': '´' }
const decode = (s) => s.replace(/&[a-z#0-9]+;/gi, (m) => entities[m] ?? m).replace(/\s+/g, ' ').trim()
const strip = (s) => decode(s.replace(/<[^>]+>/g, ' '))
const normalize = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '')

const RARITIES = ['very rare', 'legendary', 'artifact', 'uncommon', 'common', 'rare']
function firstRarity(text) {
  const t = text.toLowerCase()
  if (/varies/.test(t)) return 'varies'
  let best = null
  let bestPos = Infinity
  for (const r of RARITIES) {
    const m = new RegExp(`(^|[^a-z])${r}([^a-z]|$)`).exec(t)
    if (m && m.index < bestPos) {
      best = r
      bestPos = m.index
    }
  }
  return best
}

function sourceOf(raw) {
  const s = raw.replace(/´/g, "'")
  if (/Dungeon Master's Guide/.test(s)) return { source: 'DMG', srd: /\(SRD\)/.test(s), basicRules: /\(BR\)/.test(s) }
  if (/Xanathar/.test(s)) return { source: 'XGE', srd: false, basicRules: false }
  if (/Tasha/.test(s)) return { source: 'TCE', srd: false, basicRules: false }
  return { source: s.replace(/\s*\((SRD|BR)\)/, '').trim(), srd: /\(SRD\)/.test(s), basicRules: /\(BR\)/.test(s) }
}

// ---------------------------------------------------------------- aidedd
const html = readFileSync(aideddFile, 'utf8')
const rows = html.split('<td class="item">').slice(1)
const catalog = new Map()
for (const chunk of rows) {
  const link = /href="[^"]*om\.php\?vo=([^"]+)"[^>]*>(.*?)<\/a>/s.exec(chunk)
  if (!link) continue
  const cell = (cls) => new RegExp(`<td class="${cls}[^"]*"[^>]*>(.*?)</td>`, 's').exec(chunk)?.[1] ?? ''
  const name = strip(link[2])
  const att = strip(cell('colL'))
  const src = sourceOf(strip(cell('colS')))
  catalog.set(normalize(name), {
    name,
    slug: link[1],
    type: strip(cell('colT')) || null,
    rarity: firstRarity(strip(cell('colR'))) ?? null,
    rarityText: strip(cell('colR')) || null,
    attunement: att !== '' ? true : false,
    attunementNote: att && !/^attunement$/i.test(att) ? att : null,
    source: src.source,
    inSrd: src.srd,
    basicRules: src.basicRules,
    priceGp: null,
    priceNote: null,
  })
}
const aideddCount = catalog.size

// ---------------------------------------------------------------- Eventyr (ceny)
const lines = readFileSync(eventyrFile, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean)
const start = lines.findIndex((l, i) => l === 'Name' && lines.slice(i + 1, i + 4).includes('Value'))
const body = lines.slice(start + 2)
const SOURCE_CODES = { DMG: 'DMG', WGMM: 'WGMM', MGMM: 'MGMM', HGDD: 'HGDD', XGTE: 'XGE', TCOE: 'TCE', Custom: 'Custom' }
const nameRe = /^(.*?)(DMG|WGMM|MGMM|HGDD|XGTE|TCOE|Custom)$/
let priced = 0
let added = 0
for (let i = 0; i < body.length; ) {
  const m = nameRe.exec(body[i] ?? '')
  const typeLine = body[i + 1]
  if (!m || !typeLine || /^(Add Item|Table Style|Download PDF)$/.test(body[i] ?? '')) {
    i++
    continue
  }
  const name = m[1].trim()
  const sourceCode = SOURCE_CODES[m[2]]
  const comma = typeLine.lastIndexOf(',')
  const type = comma > 0 ? typeLine.slice(0, comma).trim() : typeLine
  const rarity = firstRarity(typeLine)
  let j = i + 2
  let priceGp = null
  let priceNote = null
  if (/^No Value$/i.test(body[j] ?? '')) {
    j += 1
  } else if (/^[0-9][0-9,.]*$/.test(body[j] ?? '')) {
    priceGp = Number((body[j] ?? '0').replace(/,/g, ''))
    j += 1
    if (/^\\?\+\s*gp$/i.test(body[j] ?? '')) {
      // cena je "N gp + vzorec": další řádek je celý popis ceny
      priceNote = body[j + 1] ?? null
      j += 2
    } else if (/^gp$/i.test(body[j] ?? '')) {
      j += 1
    }
  }
  i = j

  const key = normalize(name)
  const existing = catalog.get(key)
  if (existing) {
    existing.priceGp = priceGp
    existing.priceNote = priceNote
    if (priceGp !== null) priced++
  } else {
    catalog.set(key, {
      name,
      slug: null,
      type,
      rarity,
      rarityText: null,
      attunement: null,
      attunementNote: null,
      source: sourceCode,
      inSrd: false,
      basicRules: false,
      priceGp,
      priceNote,
    })
    added++
    if (priceGp !== null) priced++
  }
}

const out = [...catalog.values()].sort((a, b) => a.name.localeCompare(b.name))
const target = path.resolve(import.meta.dirname, '../../api/data/extra/item-catalog.json')
writeFileSync(target, JSON.stringify(out, null, 0) + '\n')
console.log(`aidedd: ${aideddCount} itemů, Eventyr: přidáno ${added} nových, cen přiřazeno ${priced}, celkem ${out.length} -> ${path.relative(process.cwd(), target)}`)
