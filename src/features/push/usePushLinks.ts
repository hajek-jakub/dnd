import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { appPath, pushSupported, registerWorker } from './push'

/**
 * Klepnutí na push notifikaci: service worker pošle otevřené aplikaci cestu a ta na ni přejde bez znovunačtení.
 * Když už je push povolený, service worker se při startu aplikace zaregistruje znovu (aktualizace nové verze po nasazení).
 */
export function usePushLinks() {
  const navigate = useNavigate()

  useEffect(() => {
    if (!pushSupported()) return
    if (Notification.permission === 'granted') void registerWorker().catch(() => undefined)
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; path?: unknown } | null
      if (data?.type === 'navigate' && typeof data.path === 'string' && data.path.startsWith('/')) navigate(appPath(data.path))
    }
    navigator.serviceWorker.addEventListener('message', onMessage)
    return () => navigator.serviceWorker.removeEventListener('message', onMessage)
  }, [navigate])
}
