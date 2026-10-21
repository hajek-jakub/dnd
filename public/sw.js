// Service worker: jen příjem push notifikací a klepnutí na ně. Nic necachuje (aplikace offline režim nemá).
// Server posílá push jen tomu, kdo nemá aplikaci otevřenou, takže tu žádné „skrýt, když je okno vidět“ není.

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = { body: event.data ? event.data.text() : '' }
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'D&D kampaň', {
      body: data.body || '',
      // Stejný štítek nahradí starší notifikaci (další zpráva ve stejném vlákně), renotify ji znovu ohlásí zvukem.
      tag: data.tag || undefined,
      renotify: Boolean(data.tag),
      icon: 'icon-192.png?v=2',
      badge: 'favicon-32.png?v=2',
      data: { url: data.url || '' },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = new URL((event.notification.data && event.notification.data.url) || '', self.registration.scope)
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      const mine = windows.find((w) => new URL(w.url).origin === self.location.origin)
      if (mine) {
        // Otevřenou aplikaci jen přepneme a necháme ji přejít na stránku sama (bez znovunačtení).
        await mine.focus()
        mine.postMessage({ type: 'navigate', path: target.pathname + target.search })
        return
      }
      await self.clients.openWindow(target.href)
    })(),
  )
})
