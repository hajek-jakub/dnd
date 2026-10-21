import { MasonryCards } from '@/components/Masonry'
import { useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ApiError } from '@/lib/api'
import { useAuth } from '@/features/auth/auth-context'
import { useTheme, type Theme } from '@/components/theme-context'
import { rememberCampaign, useActiveCampaign } from '@/features/campaigns/active-campaign'
import { RoleBadge } from '@/features/campaigns/RoleBadge'
import { cn } from '@/lib/utils'
import { Link } from 'react-router-dom'
import { CampaignDangerCard } from './CampaignDangerCard'
import { useChangePassword, useUpdateDisplayName } from './api'
import { usePageTitle } from '@/lib/page-title'

const THEMES: { value: Theme; label: string }[] = [
  { value: 'system', label: 'Podle systému' },
  { value: 'light', label: 'Světlý' },
  { value: 'dark', label: 'Tmavý' },
]

export function ProfilePage() {
  usePageTitle('Profil')
  const { user, logout } = useAuth()
  const { theme, setTheme } = useTheme()
  const { campaigns, active } = useActiveCampaign()
  if (!user) return null

  return (
    <>
      <h1 className="sr-only">Profil a nastavení účtu</h1>
      <MasonryCards columns="tab:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Profil</CardTitle>
          <CardDescription>Přihlašovací jméno: {user.username}</CardDescription>
        </CardHeader>
        <CardContent>
          <NameForm initialName={user.displayName} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Moje kampaně</CardTitle>
          <CardDescription>Hraje se v jedné kampani, ta se pamatuje. Tady ji můžeš přepnout nebo založit novou.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <ul className="space-y-2">
            {campaigns?.map((c) => (
              <li key={c.id}>
                <Link
                  to={`/campaigns/${c.id}`}
                  onClick={() => rememberCampaign(c.id)}
                  aria-current={active?.id === c.id ? 'true' : undefined}
                  className={cn('flex min-h-14 items-center justify-between gap-3 rounded-xl border bg-card px-4 hover:bg-muted', active?.id === c.id && 'border-primary ring-2 ring-primary/20')}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{c.name}</span>
                    <RoleBadge role={c.role} />
                  </span>
                  {active?.id === c.id && <span className="text-xs font-medium text-primary">aktivní</span>}
                </Link>
              </li>
            ))}
          </ul>
          <Link to="/campaigns" className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline underline-offset-4">
            Všechny kampaně, založit novou nebo se připojit kódem
          </Link>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Vzhled</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div role="group" aria-label="Motiv" className="grid grid-cols-3 gap-2">
            {THEMES.map((t) => (
              <Button key={t.value} type="button" className="px-2 text-sm" variant={theme === t.value ? 'default' : 'outline'} aria-pressed={theme === t.value} onClick={() => setTheme(t.value)}>
                {t.label}
              </Button>
            ))}
          </div>
          <Button variant="outline" className="w-full" onClick={() => void logout()}>
            Odhlásit se
          </Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>O aplikaci</CardTitle>
          <CardDescription>Licence herního obsahu (SRD 5.1, CC-BY 4.0) a informace o aplikaci.</CardDescription>
        </CardHeader>
        <CardContent>
          <Link to="/about" className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline underline-offset-4">
            O aplikaci a licence SRD 5.1
          </Link>
        </CardContent>
      </Card>
      <CampaignDangerCard campaigns={campaigns} />
      <Card>
        <CardHeader>
          <CardTitle>Změna hesla</CardTitle>
          <CardDescription>Po změně se odhlásíš ze všech ostatních zařízení.</CardDescription>
        </CardHeader>
        <CardContent>
          <PasswordForm />
        </CardContent>
      </Card>
      </MasonryCards>
    </>
  )
}

function NameForm({ initialName }: { initialName: string }) {
  const update = useUpdateDisplayName()
  const [name, setName] = useState(initialName)

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    update.mutate(trimmed, {
      onSuccess: () => toast.success('Jméno uloženo'),
      onError: () => toast.error('Jméno se nepodařilo uložit'),
    })
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="display-name">Zobrazované jméno</Label>
        <Input id="display-name" value={name} maxLength={60} required onChange={(e) => setName(e.target.value)} />
        <p className="text-sm text-muted-foreground">Takto tě uvidí ostatní v kampaních.</p>
      </div>
      <Button type="submit" disabled={update.isPending || !name.trim()}>
        Uložit
      </Button>
    </form>
  )
}

function PasswordForm() {
  const change = useChangePassword()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [error, setError] = useState<string | null>(null)

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    change.mutate(
      { currentPassword: current, newPassword: next },
      {
        onSuccess: () => {
          setCurrent('')
          setNext('')
          toast.success('Heslo změněno')
        },
        onError: (e) => setError(e instanceof ApiError ? e.message : 'Heslo se nepodařilo změnit'),
      },
    )
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="current-password">Současné heslo</Label>
        <Input id="current-password" type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="new-password">Nové heslo</Label>
        <Input id="new-password" type="password" autoComplete="new-password" required minLength={8} maxLength={72} value={next} onChange={(e) => setNext(e.target.value)} />
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" disabled={change.isPending}>
        Změnit heslo
      </Button>
    </form>
  )
}
