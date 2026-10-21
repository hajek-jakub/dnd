import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ChevronRightIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RoleBadge } from './RoleBadge'
import { useCreateCampaign, useMyCampaigns } from './api'
import { extractInviteCode, isValidInviteCode } from './invite'
import { usePageTitle } from '@/lib/page-title'

export function CampaignsPage() {
  usePageTitle('Kampaně')
  const navigate = useNavigate()
  const { data: campaigns, isPending, error } = useMyCampaigns()
  const createCampaign = useCreateCampaign()
  const [name, setName] = useState('')
  const [codeInput, setCodeInput] = useState('')
  const [codeError, setCodeError] = useState<string | null>(null)

  function onCreate(event: FormEvent) {
    event.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    createCampaign.mutate(
      { name: trimmed },
      {
        onSuccess: (campaign) => {
          setName('')
          void navigate(`/campaigns/${campaign.id}`)
        },
        onError: () => toast.error('Kampaň se nepodařilo založit'),
      },
    )
  }

  function onJoin(event: FormEvent) {
    event.preventDefault()
    const code = extractInviteCode(codeInput)
    if (!isValidInviteCode(code)) {
      setCodeError('Kód pozvánky má 10 znaků (písmena a číslice). Zkontroluj ho prosím.')
      return
    }
    setCodeError(null)
    void navigate(`/join/${code}`)
  }

  return (
    // Telefon: vše pod sebou. Počítač: seznam kampaní vlevo, formuláře vpravo.
    <div className="grid gap-6 tab:grid-cols-3 tab:items-start">
      <section className="space-y-3 tab:col-span-2">
        <h1 className="text-2xl font-bold">Moje kampaně</h1>
        {isPending && <p className="text-muted-foreground">Načítám…</p>}
        {error && (
          <p role="alert" className="text-destructive">
            Kampaně se nepodařilo načíst.
          </p>
        )}
        {campaigns?.length === 0 && (
          <p className="text-muted-foreground">Zatím nejsi v žádné kampani. Založ novou, nebo se připoj kódem od DM.</p>
        )}
        <ul className="space-y-2">
          {campaigns?.map((campaign) => (
            <li key={campaign.id}>
              <Link
                to={`/campaigns/${campaign.id}`}
                className="flex min-h-16 items-center justify-between gap-3 rounded-xl border bg-card p-4 transition-colors hover:bg-muted"
              >
                <span className="min-w-0 space-y-1">
                  <span className="block truncate font-medium">{campaign.name}</span>
                  <RoleBadge role={campaign.role} />
                </span>
                <ChevronRightIcon aria-hidden className="shrink-0 text-muted-foreground" />
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Nová kampaň</CardTitle>
            <CardDescription>Budeš v ní DM a můžeš pozvat hráče.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onCreate} className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="campaign-name">Název kampaně</Label>
                <Input
                  id="campaign-name"
                  value={name}
                  maxLength={100}
                  required
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <Button type="submit" disabled={createCampaign.isPending || !name.trim()} className="w-full">
                Založit kampaň
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Připojit se kódem</CardTitle>
            <CardDescription>Vlož kód nebo celý odkaz, který ti poslal DM.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onJoin} className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="invite-code">Kód pozvánky</Label>
                <Input
                  id="invite-code"
                  value={codeInput}
                  autoCapitalize="characters"
                  autoComplete="off"
                  spellCheck={false}
                  required
                  onChange={(e) => setCodeInput(e.target.value)}
                />
                {codeError && (
                  <p role="alert" className="text-sm text-destructive">
                    {codeError}
                  </p>
                )}
              </div>
              <Button type="submit" variant="secondary" className="w-full">
                Pokračovat
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
