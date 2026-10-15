import { useState, type FormEvent } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import { MailIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { FullPageSpinner } from '@/components/FullPageSpinner'
import { supabase } from '@/lib/supabase'
import { useAuth } from './auth-context'
import { safeNextPath } from './next-path'

export function LoginPage() {
  const { user, loading } = useAuth()
  const [params] = useSearchParams()
  const next = safeNextPath(params.get('next'))
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent'>('idle')
  const [error, setError] = useState<string | null>(null)

  if (loading) return <FullPageSpinner />
  if (user) return <Navigate to={next} replace />

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setStatus('sending')

    const base = import.meta.env.BASE_URL.replace(/\/$/, '')
    const redirectTo = `${window.location.origin}${base}${next}`

    const { error: signInError } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: redirectTo },
    })

    if (signInError) {
      setError('Odkaz se nepodařilo odeslat. Zkontroluj e-mail a zkus to za chvíli znovu.')
      setStatus('idle')
      return
    }
    setStatus('sent')
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-6 p-4">
      <div className="space-y-1 text-center">
        <h1 className="text-3xl font-bold tracking-tight">D&amp;D kampaně</h1>
        <p className="text-muted-foreground">Postavy, kostky a mapy pro tvoji družinu.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Přihlášení</CardTitle>
          <CardDescription>Pošleme ti e-mail s odkazem, kterým se přihlásíš. Heslo není potřeba.</CardDescription>
        </CardHeader>
        <CardContent>
          {status === 'sent' ? (
            <div role="status" className="space-y-2">
              <p className="flex items-center gap-2 font-medium">
                <MailIcon aria-hidden /> Odkaz je na cestě
              </p>
              <p className="text-muted-foreground">
                Otevři e-mail na <strong>{email}</strong> a klepni na odkaz. Může to trvat minutu, koukni i do spamu.
              </p>
              <Button variant="outline" className="w-full" onClick={() => setStatus('idle')}>
                Zadat jiný e-mail
              </Button>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">E-mail</Label>
                <Input
                  id="email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  required
                  placeholder="jmeno@example.cz"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              <Button type="submit" size="lg" className="w-full" disabled={status === 'sending'}>
                {status === 'sending' ? 'Odesílám…' : 'Poslat přihlašovací odkaz'}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </main>
  )
}
