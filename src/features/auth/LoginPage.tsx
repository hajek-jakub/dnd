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

export function LoginPage() {
  usePageTitle('Přihlášení')
  const { user, loading, login } = useAuth()
  const [params] = useSearchParams()
  const next = safeNextPath(params.get('next'))
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (loading) return <FullPageSpinner />
  if (user) return <Navigate to={next} replace />

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setPending(true)
    try {
      await login(username.trim(), password)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Přihlášení se nepodařilo.')
      setPending(false)
    }
  }

  return (
    <AuthShell>
      <Card>
        <CardHeader>
          <CardTitle>Přihlášení</CardTitle>
          <CardDescription>Přihlas se svým jménem a heslem.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="username">Jméno</Label>
              <Input
                id="username"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Heslo</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <Button type="submit" size="lg" className="w-full" disabled={pending}>
              {pending ? 'Přihlašuji…' : 'Přihlásit se'}
            </Button>
          </form>
          <p className="text-center text-sm text-muted-foreground">
            Nemáš účet?{' '}
            <Link to={`/register?next=${encodeURIComponent(next)}`} className="font-medium text-foreground underline underline-offset-4">
              Zaregistruj se
            </Link>
          </p>
        </CardContent>
      </Card>
    </AuthShell>
  )
}
