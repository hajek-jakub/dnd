import { useSyncExternalStore } from 'react'

/**
 * Přepínače přídavků ke zranění (Hex, Sneak Attack, Colossus Slayer). Sdílí je karta Útoky a záložka Taktiky, ať je hráč nezapíná dvakrát.
 * Pamatují se v prohlížeči (`localStorage`) pro každou postavu zvlášť, takže vydrží zavření a znovuotevření aplikace.
 */
const STORAGE_KEY = 'dnd.toggles'
const listeners = new Set<() => void>()
let cache: Record<string, boolean> | null = null

function load(): Record<string, boolean> {
  if (cache) return cache
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
    cache = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, boolean>) : {}
  } catch {
    cache = {}
  }
  return cache
}

function save(next: Record<string, boolean>) {
  cache = next
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // úložiště může být vypnuté, přepínač pak platí do zavření stránky
  }
  for (const l of listeners) l()
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

const key = (characterId: string, riderId: string) => `${characterId}:${riderId}`

export function useClassToggle(characterId: string, riderId: string, defaultOn = false): [boolean, () => void] {
  const k = key(characterId, riderId)
  const value = useSyncExternalStore(subscribe, () => load()[k] ?? defaultOn)
  const toggle = () => save({ ...load(), [k]: !value })
  return [value, toggle]
}

/** Přepínač „cíl je pod kouzlem“ (Hex, Hunter's Mark); výchozí zapnutý, protože se kouzlo sesílá na cíl, na který se útočí. */
export const CONCENTRATION_RIDER = 'concentration-rider'
