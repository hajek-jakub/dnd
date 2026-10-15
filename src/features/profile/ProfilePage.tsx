import { useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/features/auth/auth-context'
import { useProfile, useUpdateDisplayName } from './api'

export function ProfilePage() {
  const { user } = useAuth()
  const { data: profile } = useProfile()

  return (
    <Card>
      <CardHeader>
        <CardTitle>Profil</CardTitle>
        <CardDescription>Přihlášen jako {user?.email}</CardDescription>
      </CardHeader>
      <CardContent>
        {profile ? <NameForm initialName={profile.display_name} /> : <p className="text-muted-foreground">Načítám…</p>}
      </CardContent>
    </Card>
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
