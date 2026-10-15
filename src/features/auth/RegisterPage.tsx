import { useState, type FormEvent } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { FullPageSpinner } from '@/components/FullPageSpinner'
import { ApiError } from '@/lib/api'
import { AuthShell } from './AuthShell'
import { useAuth } from './auth-context'
import { safeNextPath } from './next-path'
import { usePageTitle } from '@/lib/page-title'

/** Kód pozvánky z odkazu /join/KOD (odkaz od DM), aby ho hráč nemusel opisovat. */
function codeFromNext(next: string): string {
  return next.match(/^\/join\/([A-Za-z0-9-]+)/)?.[1] ?? ''
}

export function RegisterPage() {
  usePageTitle('Registrace')
  const { user, loading, register } = useAuth()
  const [params] = useSearchParams()
  const next = safeNextPath(params.get('next'))
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState(() => params.get('code') ?? codeFromNext(next))
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldError, setFieldError] = useState<string | undefined>()

  if (loading) return <FullPageSpinner />
  if (user) return <Navigate to={next} replace />

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setFieldError(undefined)
    setPending(true)
    try {
      await register({
        username: username.trim(),
        password,
        code: code.trim(),
        displayName: displayName.trim() || undefined,
      })
    } catch (e) {
      if (e instanceof ApiError) {
        setError(e.message)
        setFieldError(e.field)
      } else {
        setError('Registrace se nepodařila.')
      }
      setPending(false)
    }
  }

  return (
    <AuthShell>
      <Card>
        <CardHeader>
          <CardTitle>Registrace</CardTitle>
          <CardDescription>
            Potřebuješ kód pozvánky od svého DM. DM si zakládá účet pomocí registračního hesla.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="code">Kód pozvánky nebo registrační heslo</Label>
              <Input
                id="code"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                required
                value={code}
                aria-invalid={fieldError === 'code'}
                onChange={(e) => setCode(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="username">Přihlašovací jméno</Label>
              <Input
                id="username"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                required
                minLength={3}
                maxLength={30}
                value={username}
                aria-invalid={fieldError === 'username'}
                onChange={(e) => setUsername(e.target.value)}
              />
              <p className="text-sm text-muted-foreground">3 až 30 znaků: písmena, číslice, tečka, pomlčka, podtržítko.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="display-name">Zobrazované jméno (nepovinné)</Label>
              <Input
                id="display-name"
                maxLength={60}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
              />
              <p className="text-sm text-muted-foreground">Takto tě uvidí ostatní. Když nic nezadáš, použije se přihlašovací jméno.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Heslo</Label>
              <Input
                id="password"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                maxLength={72}
                value={password}
                aria-invalid={fieldError === 'password'}
                onChange={(e) => setPassword(e.target.value)}
              />
              <p className="text-sm text-muted-foreground">Aspoň 8 znaků.</p>
            </div>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <Button type="submit" size="lg" className="w-full" disabled={pending}>
              {pending ? 'Zakládám účet…' : 'Vytvořit účet'}
            </Button>
          </form>
          <p className="text-center text-sm text-muted-foreground">
            Už účet máš?{' '}
            <Link to={`/login?next=${encodeURIComponent(next)}`} className="font-medium text-foreground underline underline-offset-4">
              Přihlas se
            </Link>
          </p>
        </CardContent>
      </Card>
    </AuthShell>
  )
}
