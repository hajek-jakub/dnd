import { useSyncExternalStore } from 'react'

/**
 * Které upozornění (toasty) na dění ostatních se ukazují v otevřené aplikaci. Toasty po vlastní akci (uloženo, chyba) se nevypínají.
 * Pamatuje se v prohlížeči (`localStorage`) pro každé zařízení zvlášť, stejně jako push notifikace.
 */
export const TOAST_CATEGORIES = [
  { id: 'rolls', label: 'Hody kostkou ostatních', hint: 'Když hodí jiný hráč nebo DM. V logu hodů zůstanou vždy.' },
  { id: 'dm', label: 'Změny od DM a oznámení', hint: 'Item, peníze, zranění, stav, bonus, předání itemu. Zůstanou pod zvonkem.' },
  { id: 'messages', label: 'Nové zprávy', hint: 'Odznak nepřečtených u Zpráv zůstane.' },
] as const

export type ToastCategory = (typeof TOAST_CATEGORIES)[number]['id']

const STORAGE_KEY = 'dnd.toasts'
const listeners = new Set<() => void>()
let cache: Partial<Record<ToastCategory, boolean>> | null = null

function load(): Partial<Record<ToastCategory, boolean>> {
  if (cache) return cache
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
    cache = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Partial<Record<ToastCategory, boolean>>) : {}
  } catch {
    cache = {}
  }
  return cache
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  const onStorage = (e: StorageEvent) => {
    if (e.key !== STORAGE_KEY) return
    cache = null
    listener()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

export function toastEnabled(category: ToastCategory): boolean {
  return load()[category] ?? true
}

export function setToastEnabled(category: ToastCategory, enabled: boolean) {
  cache = { ...load(), [category]: enabled }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cache))
  } catch {
    // úložiště může být vypnuté, volba pak platí do zavření stránky
  }
  for (const l of listeners) l()
}

export function useToastEnabled(category: ToastCategory): boolean {
  return useSyncExternalStore(subscribe, () => toastEnabled(category))
}
