#!/usr/bin/env node
/**
 * Nasazení obsahu dist/ na FTP (Endora).
 *
 *   npm run deploy            # build + nahrání
 *   npm run deploy -- --dry   # jen ukáže, co by se stalo (nic nenahrává ani nemaže)
 *   npm run deploy -- --skip-build
 *
 * Přihlašovací údaje se berou z .env.deploy (je v .gitignore, viz .env.deploy.example):
 *   FTP_HOST, FTP_USER, FTP_PASSWORD, FTP_REMOTE_DIR, volitelně FTP_SECURE=true|false a FTP_PORT
 *
 * Postup: nahraje všechny soubory z dist/ (index.html až nakonec, aby návštěvník nikdy
 * neviděl novou stránku bez nových assetů) a pak smaže na serveru soubory, které v dist/ nejsou.
 * Smazání je omezeno na FTP_REMOTE_DIR a odmítne běžet, pokud by to bylo podezřelé (viz níže).
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { Client } from 'basic-ftp'

const root = path.resolve(import.meta.dirname, '..')
const distDir = path.join(root, 'dist')
const args = new Set(process.argv.slice(2))
const dryRun = args.has('--dry')
const skipBuild = args.has('--skip-build')

// Soubory a složky na serveru, které deploy nikdy nesmí smazat.
const PROTECTED = new Set(['.well-known', 'cgi-bin', '.ftpquota'])

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

function fail(message) {
  console.error(`\nChyba: ${message}\n`)
  process.exit(1)
}

const env = { ...loadEnvFile(path.join(root, '.env.deploy')), ...process.env }
const host = env.FTP_HOST
const user = env.FTP_USER
const password = env.FTP_PASSWORD
const port = env.FTP_PORT ? Number(env.FTP_PORT) : 21
const remoteDir = (env.FTP_REMOTE_DIR || '').replace(/\/+$/, '')
const secure = env.FTP_SECURE ? env.FTP_SECURE !== 'false' : true

if (!host || !user || !password) {
  fail('Chybí FTP_HOST, FTP_USER nebo FTP_PASSWORD. Zkopíruj .env.deploy.example do .env.deploy a vyplň ho.')
}
if (!remoteDir || remoteDir === '/') {
  fail(
    'FTP_REMOTE_DIR musí být konkrétní složka subdomény (např. /dnd.hajekjakub.cz), ne kořen FTP.\n' +
      'Smazání starých souborů by jinak mohlo zasáhnout jiné weby na hostingu.',
  )
}

if (!skipBuild) {
  console.log('Spouštím build…')
  const build = spawnSync('npm', ['run', 'build'], { cwd: root, stdio: 'inherit' })
  if (build.status !== 0) fail('Build selhal, nic se nenahrává.')
}

if (!existsSync(path.join(distDir, 'index.html'))) {
  fail('dist/index.html neexistuje. Spusť nejdřív npm run build.')
}

/** Rekurzivně vypíše relativní cesty všech souborů v adresáři. */
function listLocal(dir, prefix = '') {
  const result = []
  for (const name of readdirSync(dir)) {
    const rel = prefix ? `${prefix}/${name}` : name
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) result.push(...listLocal(full, rel))
    else result.push(rel)
  }
  return result
}

const localFiles = listLocal(distDir)
// index.html jde až nakonec.
localFiles.sort((a, b) => Number(a === 'index.html') - Number(b === 'index.html') || a.localeCompare(b))

/** Rekurzivně vypíše relativní cesty souborů na serveru (a složky zvlášť). */
async function listRemote(client, dir, prefix = '') {
  const files = []
  const dirs = []
  for (const item of await client.list(dir)) {
    if (item.name === '.' || item.name === '..') continue
    const rel = prefix ? `${prefix}/${item.name}` : item.name
    if (!prefix && PROTECTED.has(item.name)) continue
    if (item.isDirectory) {
      dirs.push(rel)
      const sub = await listRemote(client, `${dir}/${item.name}`, rel)
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
  await client.access({
    host,
    port,
    user,
    password,
    secure,
    secureOptions: { rejectUnauthorized: false },
  })

  await client.ensureDir(remoteDir)
  const remote = await listRemote(client, remoteDir)

  const localSet = new Set(localFiles)
  const staleFiles = remote.files.filter((f) => !localSet.has(f))
  const localDirs = new Set(localFiles.flatMap((f) => f.split('/').slice(0, -1).map((_, i, a) => a.slice(0, i + 1).join('/'))))
  const staleDirs = remote.dirs.filter((d) => !localDirs.has(d)).sort((a, b) => b.length - a.length)

  console.log(`\nNahraju ${localFiles.length} souborů, smažu ${staleFiles.length} starých souborů.`)
  if (dryRun) {
    for (const f of localFiles) console.log(`  + ${f}`)
    for (const f of staleFiles) console.log(`  - ${f}`)
    console.log('\n--dry: nic se nezměnilo.')
  } else {
    for (const rel of localFiles) {
      const remotePath = `${remoteDir}/${rel}`
      await client.ensureDir(path.posix.dirname(remotePath))
      await client.cd('/')
      await client.uploadFrom(path.join(distDir, rel), remotePath)
      console.log(`  + ${rel}`)
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
    console.log('\nHotovo. Nasazeno.')
  }
} catch (error) {
  fail(`FTP selhalo: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  client.close()
}
