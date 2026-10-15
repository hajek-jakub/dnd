import { useSyncExternalStore } from 'react'
import { WifiOffIcon } from 'lucide-react'

function subscribe(cb: () => void) {
  window.addEventListener('online', cb)
  window.addEventListener('offline', cb)
  return () => {
    window.removeEventListener('online', cb)
    window.removeEventListener('offline', cb)
  }
}

/** Pruh nahoře, když zařízení ztratí připojení: ať je jasné, proč se nic neukládá (data se po návratu připojení načtou sama). */
export function OfflineBanner() {
  const online = useSyncExternalStore(subscribe, () => navigator.onLine, () => true)
  if (online) return null
  return (
    <div role="status" className="flex items-center justify-center gap-2 bg-amber-500 px-4 py-2 text-sm font-medium text-black">
      <WifiOffIcon aria-hidden className="size-4 shrink-0" /> Jsi offline. Změny se neuloží, dokud se nepřipojíš; data se pak obnoví sama.
    </div>
  )
}
