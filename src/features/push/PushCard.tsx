import { useCallback, useEffect, useState } from 'react'
import { BellRingIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ApiError } from '@/lib/api'
import {
  PUSH_CATEGORIES,
  PushDenied,
  currentSubscription,
  disablePush,
  enablePush,
  fetchPushConfig,
  fetchServerSubscription,
  isIos,
  isStandalone,
  pushSupported,
  sendTestPush,
  updateCategories,
  type PushCategory,
  type ServerSubscription,
} from './push'

type State =
  | { kind: 'loading' }
  | { kind: 'unsupported'; ios: boolean }
  | { kind: 'server-off' }
  | { kind: 'denied' }
  | { kind: 'off'; publicKey: string }
  | { kind: 'on'; publicKey: string; subscription: ServerSubscription; endpoint: string }

/** Zjistí, v jakém stavu jsou push notifikace na tomto zařízení (prohlížeč, oprávnění, odběr na serveru). */
async function readState(): Promise<State> {
  try {
    const config = await fetchPushConfig()
    if (!config.available || !config.publicKey) return { kind: 'server-off' }
    if (Notification.permission === 'denied') return { kind: 'denied' }
    const sub = await currentSubscription()
    const server = sub && Notification.permission === 'granted' ? await fetchServerSubscription(sub.endpoint) : null
    return sub && server ? { kind: 'on', publicKey: config.publicKey, subscription: server, endpoint: sub.endpoint } : { kind: 'off', publicKey: config.publicKey }
  } catch {
    return { kind: 'server-off' }
  }
}

/** Nastavení push notifikací pro toto zařízení (každé zařízení si vybírá zvlášť). */
export function PushCard() {
  const [state, setState] = useState<State>(() => (pushSupported() ? { kind: 'loading' } : { kind: 'unsupported', ios: isIos() && !isStandalone() }))
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => setState(await readState()), [])

  useEffect(() => {
    let cancelled = false
    if (pushSupported()) {
      void readState().then((next) => {
        if (!cancelled) setState(next)
      })
    }
    return () => {
      cancelled = true
    }
  }, [])

  async function enable(publicKey: string) {
    setBusy(true)
    try {
      await enablePush(publicKey)
      toast.success('Push notifikace jsou zapnuté')
      await load()
    } catch (e) {
      if (e instanceof PushDenied) {
        await load()
        toast.error('Notifikace nejsou povolené. Povol je v nastavení prohlížeče pro tento web.')
      } else {
        toast.error(e instanceof ApiError ? e.message : 'Push notifikace se nepodařilo zapnout. Zkus to znovu.')
      }
    } finally {
      setBusy(false)
    }
  }

  async function disable() {
    setBusy(true)
    try {
      await disablePush()
      toast.success('Push notifikace jsou na tomto zařízení vypnuté')
      await load()
    } finally {
      setBusy(false)
    }
  }

  async function toggle(current: Extract<State, { kind: 'on' }>, id: PushCategory, checked: boolean) {
    const next = PUSH_CATEGORIES.map((c) => c.id).filter((c) => (c === id ? checked : current.subscription.categories.includes(c)))
    // optimisticky, ať přepínač nezpožďuje; při chybě se vrátí
    setState({ ...current, subscription: { ...current.subscription, categories: next } })
    try {
      setState({ ...current, subscription: await updateCategories(current.endpoint, next) })
    } catch {
      setState(current)
      toast.error('Nastavení se nepodařilo uložit')
    }
  }

  async function test() {
    setBusy(true)
    try {
      const res = await sendTestPush()
      if (res.sent > 0) toast.success('Zkušební notifikace je na cestě')
      else toast.error('Zkušební notifikaci se nepodařilo odeslat')
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Zkušební notifikaci se nepodařilo odeslat')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Push notifikace</CardTitle>
        <CardDescription>Upozornění na telefon nebo počítač, i když máš aplikaci zavřenou. Když je aplikace otevřená, nic nechodí. Hody kostkou se nikdy neposílají.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {state.kind === 'loading' && <p role="status" className="text-sm text-muted-foreground">Načítám…</p>}
        {state.kind === 'unsupported' && (
          <p className="text-sm text-muted-foreground" role="status">
            {state.ios
              ? 'Na iPhonu a iPadu fungují push notifikace jen v aplikaci přidané na plochu: v Safari klepni na Sdílet, vyber Přidat na plochu, otevři aplikaci z plochy a vrať se sem.'
              : 'Tento prohlížeč push notifikace nepodporuje.'}
          </p>
        )}
        {state.kind === 'server-off' && (
          <p className="text-sm text-muted-foreground" role="status">
            Push notifikace jsou teď na serveru nedostupné.
          </p>
        )}
        {state.kind === 'denied' && (
          <p className="text-sm text-muted-foreground" role="status">
            Notifikace jsou pro tento web v prohlížeči zablokované. Povol je v nastavení prohlížeče (u adresy webu nebo v nastavení systému) a načti stránku znovu.
          </p>
        )}
        {state.kind === 'off' && (
          <Button className="w-full" disabled={busy} onClick={() => void enable(state.publicKey)}>
            <BellRingIcon aria-hidden /> Zapnout push notifikace na tomto zařízení
          </Button>
        )}
        {state.kind === 'on' && (
          <>
            <fieldset className="space-y-1">
              <legend className="mb-1 text-sm font-medium">Co chceš dostávat</legend>
              {PUSH_CATEGORIES.map((c) => (
                <label key={c.id} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-md py-2">
                  <input
                    type="checkbox"
                    className="mt-0.5 size-5 shrink-0"
                    checked={state.subscription.categories.includes(c.id)}
                    onChange={(e) => void toggle(state, c.id, e.target.checked)}
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{c.label}</span>
                    <span className="block text-sm text-muted-foreground">{c.hint}</span>
                  </span>
                </label>
              ))}
            </fieldset>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" disabled={busy} onClick={() => void test()}>
                Poslat zkušební notifikaci
              </Button>
              <Button variant="outline" disabled={busy} onClick={() => void disable()}>
                Vypnout na tomto zařízení
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
