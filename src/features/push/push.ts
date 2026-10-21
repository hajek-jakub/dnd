import { api } from '@/lib/api'

/** Kategorie push notifikací (stejné jako `Push::CATEGORIES` na serveru) a jejich popisky. */
export const PUSH_CATEGORIES = [
  { id: 'messages', label: 'Zprávy', hint: 'Nová zpráva ve skupině, soukromě nebo tajná.' },
  { id: 'dm', label: 'Změny od DM', hint: 'DM ti dal item, peníze nebo bonus, upravil životy nebo stav; předání mezi hráči.' },
  { id: 'maps', label: 'Nové mapy', hint: 'DM zveřejnil mapu.' },
  { id: 'journal', label: 'Deník', hint: 'DM přidal zápis do deníku.' },
] as const

export type PushCategory = (typeof PUSH_CATEGORIES)[number]['id']

const BASE = import.meta.env.BASE_URL

/** Umí tento prohlížeč push? (iPhone a iPad jen z aplikace přidané na plochu, jinde `PushManager` chybí.) */
export function pushSupported(): boolean {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

export function isIos(): boolean {
  if (typeof navigator === 'undefined') return false
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

/** Běží aplikace přidaná na plochu (na iPhonu a iPadu jediný způsob, jak dostávat push)? */
export function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true
}

/** Veřejný klíč VAPID z base64url na bajty, jak ho chce `pushManager.subscribe`. */
export function keyToBytes(key: string): Uint8Array<ArrayBuffer> {
  const padded = key.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(key.length / 4) * 4, '=')
  const raw = atob(padded)
  const bytes = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  return bytes
}

/** Cesta v aplikaci z cesty, kterou poslal service worker (odstraní základ nasazení do podsložky). */
export function appPath(path: string): string {
  const base = BASE.replace(/\/$/, '')
  const rest = base && path.startsWith(base) ? path.slice(base.length) : path
  return rest.startsWith('/') ? rest : `/${rest}`
}

export function registerWorker(): Promise<ServiceWorkerRegistration> {
  // updateViaCache 'none': nový service worker se po nasazení vždy stáhne ze serveru, ne z HTTP cache.
  return navigator.serviceWorker.register(`${BASE}sw.js`, { scope: BASE, updateViaCache: 'none' })
}

/** Odběr tohoto prohlížeče (bez ptaní na oprávnění), nebo null. */
export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null
  const reg = await navigator.serviceWorker.getRegistration(BASE)
  return reg ? reg.pushManager.getSubscription() : null
}

export interface ServerSubscription {
  categories: PushCategory[]
  createdAt: string | null
}

const endpointQuery = (endpoint: string) => `?endpoint=${encodeURIComponent(endpoint)}`

export async function fetchServerSubscription(endpoint: string): Promise<ServerSubscription | null> {
  return (await api.get<{ subscription: ServerSubscription | null }>(`/push/subscription${endpointQuery(endpoint)}`)).subscription
}

/**
 * Zapne push na tomto zařízení: oprávnění, service worker, odběr v prohlížeči a jeho uložení na server.
 * Musí se volat přímo z klepnutí uživatele (iOS jinak o oprávnění nepožádá).
 */
export async function enablePush(publicKey: string): Promise<ServerSubscription> {
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new PushDenied()
  await registerWorker()
  const reg = await navigator.serviceWorker.ready
  const key = keyToBytes(publicKey)
  let sub = await reg.pushManager.getSubscription()
  if (sub) {
    // Odběr s jiným klíčem serveru (po výměně klíče) by subscribe odmítl; starý se zruší a založí nový.
    const current = sub.options.applicationServerKey ? new Uint8Array(sub.options.applicationServerKey) : null
    if (!current || current.length !== key.length || current.some((b, i) => b !== key[i])) {
      await sub.unsubscribe()
      sub = null
    }
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
  const json = sub.toJSON()
  const res = await api.post<{ subscription: ServerSubscription }>('/push/subscription', { endpoint: json.endpoint, keys: json.keys })
  return res.subscription
}

export class PushDenied extends Error {
  constructor() {
    super('Oprávnění k notifikacím nebylo uděleno.')
    this.name = 'PushDenied'
  }
}

/** Vypne push na tomto zařízení (server i prohlížeč). */
export async function disablePush(): Promise<void> {
  const sub = await currentSubscription()
  if (!sub) return
  await api.delete(`/push/subscription${endpointQuery(sub.endpoint)}`).catch(() => undefined)
  await sub.unsubscribe().catch(() => undefined)
}

/** Odhlášení: odběr tohoto zařízení se na serveru zruší, ať push po odhlášení nechodí dál (v prohlížeči zůstane, příští přihlášení ho zapne jedním klepnutím). */
export async function forgetPushOnServer(): Promise<void> {
  try {
    const sub = await currentSubscription()
    if (sub) await api.delete(`/push/subscription${endpointQuery(sub.endpoint)}`)
  } catch {
    // odhlášení se kvůli push nikdy nesmí zdržet ani selhat
  }
}

export async function updateCategories(endpoint: string, categories: PushCategory[]): Promise<ServerSubscription> {
  return (await api.patch<{ subscription: ServerSubscription }>('/push/subscription', { endpoint, categories })).subscription
}

export function sendTestPush(): Promise<{ sent: number; failed: number }> {
  return api.post('/push/test', {})
}

export function fetchPushConfig(): Promise<{ available: boolean; publicKey: string | null }> {
  return api.get('/push/config')
}
