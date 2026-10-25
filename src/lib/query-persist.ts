import { dehydrate, hydrate, type DehydratedState, type QueryClient } from '@tanstack/react-query'

/**
 * Data z API uložená v prohlížeči (IndexedDB), aby se po otevření aplikace hned ukázala poslední známá podoba
 * (sheet, deník, zprávy, pravidla pro engine) a na pozadí se jen obnovila. Hosting zvládá málo souběžných požadavků,
 * takže každý ušetřený dotaz při startu se počítá (zprávy se navíc doptají jen na novější než uložené).
 * Cache patří jednomu uživateli a jedné verzi buildu; jiný uživatel, nový build, stáří přes 7 dní nebo odhlášení ji zahodí.
 */

const DB_NAME = 'dnd-cache'
const STORE = 'queries'
const KEY = 'state'
const MAX_AGE_MS = 7 * 24 * 3600_000
const SAVE_DELAY_MS = 2000

/** Neukládá se: náhled pozvánky (před přihlášením) a AI pomocník (velké konverzace, jen DM). */
const SKIP = new Set(['invite-preview', 'ai', 'ai-conversation'])
/** Po obnovení se nemusí hned stahovat znovu: pravidla pro engine se mění jen s novým buildem (a ten cache zahodí). */
const KEEP_FRESH = new Set(['engine'])

interface Saved {
  userId: string
  buildId: string
  savedAt: number
  state: DehydratedState
}

let dbPromise: Promise<IDBDatabase> | null = null

function db(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

async function run<T>(mode: IDBTransactionMode, op: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const tx = (await db()).transaction(STORE, mode)
  const req = op(tx.objectStore(STORE))
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(req.result)
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

const available = () => typeof indexedDB !== 'undefined'

/** Vrátí uložená data přihlášeného uživatele do cache; jako zastaralá, takže se otevřená stránka hned obnoví. */
export async function restoreQueryCache(queryClient: QueryClient, userId: string): Promise<void> {
  if (!available()) return
  try {
    const saved = (await run('readonly', (s) => s.get(KEY))) as Saved | undefined
    if (!saved) return
    if (saved.userId !== userId || saved.buildId !== __BUILD_ID__ || Date.now() - saved.savedAt > MAX_AGE_MS) {
      await run('readwrite', (s) => s.delete(KEY))
      return
    }
    hydrate(queryClient, saved.state)
    void queryClient.invalidateQueries({ predicate: (q) => !KEEP_FRESH.has(String(q.queryKey[0])), refetchType: 'none' })
  } catch {
    // soukromý režim nebo plné úložiště: aplikace jede i bez uložených dat
  }
}

let stopCurrent: (() => void) | null = null

/** Průběžně ukládá cache (nejvýš jednou za 2 s a při skrytí stránky). Vrací funkci, která ukládání zastaví. */
export function persistQueryCache(queryClient: QueryClient, userId: string): () => void {
  if (!available()) return () => {}
  stopCurrent?.()
  let timer: number | undefined
  let stopped = false

  const save = () => {
    window.clearTimeout(timer)
    timer = undefined
    if (stopped) return
    const state = dehydrate(queryClient, {
      shouldDehydrateQuery: (q) => q.state.status === 'success' && !SKIP.has(String(q.queryKey[0])),
      shouldDehydrateMutation: () => false,
    })
    const record: Saved = { userId, buildId: __BUILD_ID__, savedAt: Date.now(), state }
    run('readwrite', (s) => s.put(record, KEY)).catch(() => {})
  }
  const schedule = () => {
    if (timer === undefined && !stopped) timer = window.setTimeout(save, SAVE_DELAY_MS)
  }
  const flush = () => {
    if (timer !== undefined) save()
  }
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') flush()
  }

  const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
    if (event.type === 'updated' || event.type === 'removed') schedule()
  })
  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('pagehide', flush)

  const stop = () => {
    stopped = true
    window.clearTimeout(timer)
    unsubscribe()
    document.removeEventListener('visibilitychange', onVisibility)
    window.removeEventListener('pagehide', flush)
    if (stopCurrent === stop) stopCurrent = null
  }
  stopCurrent = stop
  return stop
}

/** Odhlášení nebo vypršelá relace: ukládání se zastaví a uložená data se smažou (na sdíleném zařízení nesmí zůstat). */
export async function clearQueryCache(): Promise<void> {
  stopCurrent?.()
  if (!available()) return
  try {
    await run('readwrite', (s) => s.delete(KEY))
  } catch {
    // nic uloženého
  }
}
