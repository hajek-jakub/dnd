import { useSyncExternalStore } from 'react'

/**
 * Přepínače přídavků od tříd (Sneak Attack, Colossus Slayer). Sdílí je karta Útoky a záložka Taktiky, ať je hráč nezapíná dvakrát.
 * Drží se jen v paměti prohlížeče (platí pro jeden zásah, po obnovení stránky jsou vypnuté).
 */
const on = new Map<string, boolean>()
const listeners = new Set<() => void>()

const key = (characterId: string, riderId: string) => `${characterId}:${riderId}`

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useClassToggle(characterId: string, riderId: string): [boolean, () => void] {
  const value = useSyncExternalStore(subscribe, () => on.get(key(characterId, riderId)) === true)
  const toggle = () => {
    on.set(key(characterId, riderId), !value)
    for (const l of listeners) l()
  }
  return [value, toggle]
}
