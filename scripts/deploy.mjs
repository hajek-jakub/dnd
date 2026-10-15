#!/usr/bin/env node
/**
 * Nasazení na FTP (Endora): frontend (dist/) + PHP API (api/) + databázové migrace.
 *
 *   npm run deploy               # build + nahrání + migrace
 *   npm run deploy -- --dry      # jen ukáže, co by se stalo (nic nenahrává ani nemaže)
 *   npm run deploy -- --skip-build
 *   npm run deploy -- --skip-migrate
 *
 * Údaje se berou z .env.deploy (viz .env.deploy.example) a z api/config.production.php.
 * Oba soubory jsou v .gitignore.
 *
 * Co se nahraje:
 *   dist/*                    -> FTP_REMOTE_DIR/*             (frontend, index.html až nakonec)
 *   api/index.php, .htaccess, src/, migrations/  -> FTP_REMOTE_DIR/api/...
 *   api/config.production.php -> FTP_REMOTE_DIR/api/config.php (přihlašovací údaje k DB a klíče)
 * Co se NEnahraje: api/config.php, config.test.php, config.example.php, bin/, api-tests, e2e, zdrojáky.
 * Pak se na serveru smažou soubory, které v nahrávané sadě nejsou (jen uvnitř FTP_REMOTE_DIR).
 * Nakonec se zavolá POST {SITE_URL}/api/admin/migrate (čekající migrace databáze) a /api/admin/seed (pravidla SRD 5.1).
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { Client } from 'basic-ftp'

const root = path.resolve(import.meta.dirname, '..')
const distDir = path.join(root, 'dist')
const apiDir = path.join(root, 'api')
const prodConfig = path.join(apiDir, 'config.production.php')
const args = new Set(process.argv.slice(2))
const dryRun = args.has('--dry')
const skipBuild = args.has('--skip-build')
const skipMigrate = args.has('--skip-migrate')

// Soubory a složky v kořeni FTP_REMOTE_DIR, které deploy nikdy nesmí smazat (správa hostingu).
const PROTECTED = new Set(['.well-known', 'cgi-bin', '.ftpquota'])

function fail(message) {
  console.error(`\nChyba: ${message}\n`)
  process.exit(1)
}

function loadEnvFile(file) {
  if (!existsSync(file)) return {}
  const out = {}
  for (const rawLine of readFileSync(file, 'utf8').split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    out[key] = value
  }
  return out
}

const env = { ...loadEnvFile(path.join(root, '.env.deploy')), ...process.env }
const host = env.FTP_HOST
const user = env.FTP_USER
const password = env.FTP_PASSWORD
const port = env.FTP_PORT ? Number(env.FTP_PORT) : 21
// FTP_JAILED=true: účet je na serveru zamčený přímo ve složce aplikace (Endora: FTP účet se směrováním
// na _sub/dnd), takže jeho kořen "/" je bezpečný a je to složka, do které se nasazuje.
const jailed = env.FTP_JAILED === 'true'
const remoteDir = jailed ? '' : (env.FTP_REMOTE_DIR || '').replace(/\/+$/, '')
const secure = env.FTP_SECURE ? env.FTP_SECURE !== 'false' : true
const siteUrl = (env.SITE_URL || '').replace(/\/+$/, '')

if (!host || !user || !password) {
  fail('Chybí FTP_HOST, FTP_USER nebo FTP_PASSWORD. Zkopíruj .env.deploy.example do .env.deploy a vyplň ho.')
}
if (!jailed && (!remoteDir || remoteDir === '/')) {
  fail(
    'FTP_REMOTE_DIR musí být konkrétní složka subdomény (např. /_sub/dnd), ne kořen FTP.\n' +
      'Smazání starých souborů by jinak mohlo zasáhnout jiné weby na hostingu.',
  )
}
if (!siteUrl && !skipMigrate) {
  fail('Chybí SITE_URL (např. https://dnd.hajekjakub.cz). Potřebuje ho spuštění migrací. Nebo použij --skip-migrate.')
}

// ---------------------------------------------------------------- kontrola produkční konfigurace API
if (!existsSync(prodConfig)) {
  fail('Chybí api/config.production.php. Zkopíruj api/config.example.php, vyplň údaje k databázi z Endory a nastav vlastní klíče.')
}
const phpRead = spawnSync(
  'php',
  ['-r', 'echo json_encode(require $argv[1]);', prodConfig],
  { encoding: 'utf8' },
)
if (phpRead.status !== 0) {
  fail(`api/config.production.php nejde načíst (je v něm syntaktická chyba?)\n${phpRead.stderr}`)
}
const cfg = JSON.parse(phpRead.stdout)
const problems = []
if (cfg.debug === true) problems.push("'debug' musí být false (jinak by se klientům vypisovaly podrobnosti chyb)")
if (cfg.trust_test_ip_header === true) problems.push("'trust_test_ip_header' musí být vypnuté (dalo by se obejít omezení pokusů)")
if (!cfg.registration_key || ['dev', 'test-key'].includes(cfg.registration_key) || cfg.registration_key.length < 12) {
  problems.push("'registration_key' musí být vlastní tajné heslo o aspoň 12 znacích")
}
if (!cfg.migrate_key || ['dev-migrate', 'test-migrate'].includes(cfg.migrate_key) || cfg.migrate_key.length < 20) {
  problems.push("'migrate_key' musí být dlouhý náhodný řetězec (aspoň 20 znaků)")
}
if (!cfg.db || !cfg.db.name || !cfg.db.user || !cfg.db.password || /^(dnd|dnd_test)$/.test(cfg.db.name)) {
  problems.push("'db' musí obsahovat údaje k databázi z Endory (ne k lokální dnd)")
}
if (JSON.stringify(cfg.db ?? {}).includes('DOPLN_')) {
  problems.push("v 'db' zbývají neuhrazené řádky DOPLN_... (doplň údaje k databázi z administrace Endory)")
}
if (problems.length > 0) {
  fail(`api/config.production.php není připravený na ostrý server:\n  - ${problems.join('\n  - ')}`)
}

if (!skipBuild) {
  console.log('Spouštím build…')
  const build = spawnSync('npm', ['run', 'build'], { cwd: root, stdio: 'inherit' })
  if (build.status !== 0) fail('Build selhal, nic se nenahrává.')
}
if (!existsSync(path.join(distDir, 'index.html'))) {
  fail('dist/index.html neexistuje. Spusť nejdřív npm run build.')
}

// ---------------------------------------------------------------- sestavení seznamu souborů k nahrání
/** Rekurzivně vypíše relativní cesty všech souborů v adresáři. */
function listLocal(dir, prefix = '') {
  const result = []
  for (const name of readdirSync(dir)) {
    const rel = prefix ? `${prefix}/${name}` : name
    const full = path.join(dir, name)
    if (name === '.DS_Store') continue
    if (statSync(full).isDirectory()) result.push(...listLocal(full, rel))
    else result.push(rel)
  }
  return result
}

/** @type {{ local: string, remote: string }[]} */
const uploads = []
for (const rel of listLocal(distDir)) uploads.push({ local: path.join(distDir, rel), remote: rel })

// storage/ obsahuje nahrané soubory (fotky, mapy): nikdy se nenahrává z lokálu a na serveru se nikdy nemaže (viz PRESERVE).
const API_EXCLUDE = [/^config\.php$/, /^config\.example\.php$/, /^config\.test\.php$/, /^config\.production\.php$/, /^bin\//, /^\.gitignore$/, /^storage\/(?!\.htaccess$)/]
// Cesty na serveru, které deploy nikdy nesmí smazat (data nahraná uživateli).
const PRESERVE = [/^api\/storage(\/|$)/]
for (const rel of listLocal(apiDir)) {
  if (API_EXCLUDE.some((re) => re.test(rel))) continue
  uploads.push({ local: path.join(apiDir, rel), remote: `api/${rel}` })
}
uploads.push({ local: prodConfig, remote: 'api/config.php' })

// index.html jde až nakonec, aby návštěvník nikdy neviděl novou stránku bez nových assetů.
uploads.sort((a, b) => Number(a.remote === 'index.html') - Number(b.remote === 'index.html') || a.remote.localeCompare(b.remote))

// ---------------------------------------------------------------- FTP
/** Rekurzivně vypíše relativní cesty souborů a složek na serveru. */
async function listRemote(client, dir, prefix = '') {
  const files = []
  const dirs = []
  for (const item of await client.list(dir)) {
    if (item.name === '.' || item.name === '..') continue
    if (!prefix && PROTECTED.has(item.name)) continue
    const rel = prefix ? `${prefix}/${item.name}` : item.name
    if (item.isDirectory) {
      dirs.push(rel)
      const sub = await listRemote(client, `${dir.replace(/\/+$/, '')}/${item.name}`, rel)
      files.push(...sub.files)
      dirs.push(...sub.dirs)
    } else {
      files.push(rel)
    }
  }
  return { files, dirs }
}

const client = new Client(30_000)
try {
  console.log(`Připojuji se k ${host} jako ${user} (${secure ? 'FTPS' : 'FTP bez šifrování'})…`)
  await client.access({ host, port, user, password, secure, secureOptions: { rejectUnauthorized: false } })

  if (remoteDir) await client.ensureDir(remoteDir)
  const remote = await listRemote(client, remoteDir || '/')

  const uploadSet = new Set(uploads.map((u) => u.remote))
  const staleFiles = remote.files.filter((f) => !uploadSet.has(f) && !PRESERVE.some((re) => re.test(f)))
  const keptDirs = new Set(uploads.flatMap((u) => u.remote.split('/').slice(0, -1).map((_, i, a) => a.slice(0, i + 1).join('/'))))
  const staleDirs = remote.dirs.filter((d) => !keptDirs.has(d) && !PRESERVE.some((re) => re.test(d))).sort((a, b) => b.length - a.length)

  console.log(`\nNahraju ${uploads.length} souborů, smažu ${staleFiles.length} starých souborů v ${remoteDir || '/ (uzamčený FTP účet)'}.`)
  if (dryRun) {
    for (const u of uploads) console.log(`  + ${u.remote}`)
    for (const f of staleFiles) console.log(`  - ${f}`)
    console.log('\n--dry: nic se nezměnilo.')
  } else {
    for (const u of uploads) {
      const remotePath = `${remoteDir}/${u.remote}`
      await client.ensureDir(path.posix.dirname(remotePath))
      await client.cd('/')
      await client.uploadFrom(u.local, remotePath)
      console.log(`  + ${u.remote}`)
    }
    for (const rel of staleFiles) {
      await client.remove(`${remoteDir}/${rel}`)
      console.log(`  - ${rel}`)
    }
    for (const rel of staleDirs) {
      try {
        await client.removeEmptyDir(`${remoteDir}/${rel}`)
      } catch {
        // složka není prázdná nebo ji nejde smazat; nevadí
      }
    }
    console.log('\nSoubory nahrány.')
  }
} catch (error) {
  fail(`FTP selhalo: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  client.close()
}

// ---------------------------------------------------------------- migrace databáze
if (!dryRun && !skipMigrate) {
  console.log(`Spouštím migrace databáze (${siteUrl}/api/admin/migrate)…`)
  try {
    const res = await fetch(`${siteUrl}/api/admin/migrate`, {
      method: 'POST',
      headers: { 'X-Migrate-Key': cfg.migrate_key },
    })
    const text = await res.text()
    if (!res.ok) {
      fail(
        `Migrace selhaly (HTTP ${res.status}): ${text.slice(0, 300)}\n` +
          'Zkontroluj, že subdoména funguje, PHP je verze 8+ a že údaje k databázi v api/config.production.php jsou správné.',
      )
    }
    const { applied } = JSON.parse(text)
    console.log(applied.length ? `Aplikované migrace: ${applied.join(', ')}` : 'Databáze je aktuální, žádné nové migrace.')

    console.log('Načítám pravidla (SRD 5.1 a katalog itemů)…')
    const seedRes = await fetch(`${siteUrl}/api/admin/seed`, { method: 'POST', headers: { 'X-Migrate-Key': cfg.migrate_key } })
    const seedText = await seedRes.text()
    if (!seedRes.ok) fail(`Načtení pravidel selhalo (HTTP ${seedRes.status}): ${seedText.slice(0, 300)}`)
    const seed = JSON.parse(seedText)
    console.log(
      seed.skipped
        ? 'Pravidla jsou aktuální, nic se nenačítalo.'
        : `Pravidla načtena: ${Object.values(seed.counts).reduce((a, b) => a + b, 0)} záznamů, smazáno zastaralých ${seed.removed}.`,
    )
  } catch (error) {
    fail(`Migrace se nepodařilo zavolat: ${error instanceof Error ? error.message : String(error)}`)
  }
  const diagRes = await fetch(`${siteUrl}/api/admin/diagnostics`, { method: 'POST', headers: { 'X-Migrate-Key': cfg.migrate_key } })
  if (diagRes.ok) {
    const d = await diagRes.json()
    console.log(`Server: PHP ${d.php}, GD (obrázky) ${d.gd ? 'ano' : 'NE'}, složka pro nahrané soubory ${d.storageWritable ? 'zapisovatelná' : 'NENÍ ZAPISOVATELNÁ'}, limit uploadu ${d.uploadMaxFilesize}`)
    if (!d.gd) console.warn('POZOR: chybí rozšíření GD, nahrávání fotek a map nebude fungovat. Zapni GD v nastavení PHP na Endoře.')
    if (!d.storageWritable) console.warn('POZOR: PHP nemůže zapisovat do api/storage, nahrávání fotek a map nebude fungovat (zkontroluj oprávnění složky).')
  }

  console.log(`\nHotovo. Aplikace běží na ${siteUrl}`)
}
