import { useEffect, useState } from 'react'
import { BellRingIcon } from 'lucide-react'
import { useLocation } from 'react-router-dom'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { ApiError } from '@/lib/api'
import { PushDenied, enablePush, isIos, isStandalone, pushSupported, readState } from './push'

const KEY = 'dnd.pushPrompt'
const DAY = 24 * 3600 * 1000

/** Nabídka už byla zamítnutá („Nechci“ nadobro, „Později“ na pár dní)? Bez úložiště (soukromý režim) se nabídne pokaždé. */
function dismissed(): boolean {
  try {
    const value = localStorage.getItem(KEY)
    return value === 'never' || Number(value) > Date.now()
  } catch {
    return false
  }
}

function dismiss(days: number | 'never') {
  try {
    localStorage.setItem(KEY, days === 'never' ? 'never' : String(Date.now() + days * DAY))
  } catch {
    // bez úložiště se nabídka při dalším otevření ukáže znovu, to nevadí
  }
}

type Mode = 'hidden' | 'ask' | 'ios-tip'

/**
 * Při otevření aplikace nabídne zapnutí push notifikací (jen když je prohlížeč umí, oprávnění není zablokované
 * a zařízení ještě nemá odběr). Systémové okno s oprávněním se smí otevřít jen po klepnutí uživatele, proto je to karta s tlačítkem.
 * iPhone a iPad umí push jen z aplikace přidané na plochu, tam se ukáže návod.
 */
export function PushPrompt() {
  const { pathname } = useLocation()
  const [mode, setMode] = useState<Mode>(() => (dismissed() ? 'hidden' : !pushSupported() && isIos() && !isStandalone() ? 'ios-tip' : 'hidden'))
  const [publicKey, setPublicKey] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (dismissed() || !pushSupported()) return
    let cancelled = false
    void readState().then((state) => {
      if (cancelled || state.kind !== 'off') return
      setPublicKey(state.publicKey)
      setMode('ask')
    })
    return () => {
      cancelled = true
    }
  }, [])

  // V profilu je nastavení push přímo, tam nabídka nepřekáží.
  if (mode === 'hidden' || pathname === '/profile') return null

  async function enable() {
    setBusy(true)
    try {
      await enablePush(publicKey)
      toast.success('Push notifikace jsou zapnuté')
      setMode('hidden')
    } catch (e) {
      if (e instanceof PushDenied) {
        // zamítnuto v okně prohlížeče: nenabízet znovu, zapnout jde jen v nastavení prohlížeče
        dismiss('never')
        setMode('hidden')
        toast.error('Notifikace nejsou povolené. Zapnout je půjde v nastavení prohlížeče pro tento web.')
      } else {
        toast.error(e instanceof ApiError ? e.message : 'Push notifikace se nepodařilo zapnout. Zkus to znovu.')
      }
    } finally {
      setBusy(false)
    }
  }

  function close(days: number | 'never') {
    dismiss(days)
    setMode('hidden')
  }

  return (
    <Card role="region" aria-label="Nabídka push notifikací">
      <CardContent className="flex flex-wrap items-center gap-3">
        <BellRingIcon aria-hidden className="size-6 shrink-0 text-primary" />
        <p className="min-w-0 flex-1 basis-56 text-sm">
          {mode === 'ask' ? (
            <>
              <span className="font-semibold">Zapnout upozornění?</span> Dostaneš zprávy a novinky od DM (item, mapa, deník) i když bude aplikace zavřená. Když ji máš otevřenou, nic nechodí.
            </>
          ) : (
            <>
              <span className="font-semibold">Upozornění na telefonu:</span> v Safari klepni na Sdílet, vyber Přidat na plochu a aplikaci pak otevři z plochy. Tam půjdou zapnout push notifikace na zprávy a novinky od DM.
            </>
          )}
        </p>
        <div className="flex flex-wrap gap-2">
          {mode === 'ask' ? (
            <>
              <Button disabled={busy} onClick={() => void enable()}>
                Zapnout
              </Button>
              <Button variant="outline" disabled={busy} onClick={() => close(7)}>
                Později
              </Button>
            </>
          ) : (
            <Button variant="outline" onClick={() => close(14)}>
              Rozumím
            </Button>
          )}
          <Button variant="ghost" disabled={busy} onClick={() => close('never')}>
            Nechci
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
