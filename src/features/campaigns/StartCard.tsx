import { Link } from 'react-router-dom'
import { ChevronRightIcon, MapIcon, SwordsIcon, UserPlusIcon, type LucideIcon } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

const step = 'flex min-h-12 items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors hover:bg-muted'

function Step({ icon: Icon, title, hint }: { icon: LucideIcon; title: string; hint: string }) {
  return (
    <>
      <Icon aria-hidden className="size-5 shrink-0 text-primary" />
      <span className="min-w-0 flex-1">
        <span className="block font-medium">{title}</span>
        <span className="block text-sm text-muted-foreground">{hint}</span>
      </span>
      <ChevronRightIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
    </>
  )
}

/** Nová kampaň bez hráčů: DM uvidí, čím začít. Zmizí, jakmile se připojí první hráč. */
export function StartCard({ campaignId }: { campaignId: string }) {
  return (
    <Card data-testid="start-card">
      <CardHeader>
        <CardTitle>Začni</CardTitle>
        <CardDescription>Kampaň je připravená. Pozvi hráče a nachystej první session.</CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-[minmax(0,1fr)] gap-2 lg:grid-cols-3">
        <button
          type="button"
          className={step}
          onClick={() => {
            const card = document.getElementById('invite-players')
            card?.scrollIntoView({ behavior: 'smooth', block: 'start' })
            document.getElementById('invite-username')?.focus({ preventScroll: true })
          }}
        >
          <Step icon={UserPlusIcon} title="Pozvi hráče" hint="Jménem, nebo odkazem pro nové" />
        </button>
        <Link to={`/campaigns/${campaignId}/maps`} className={step}>
          <Step icon={MapIcon} title="Nahraj mapu" hint="Hráčům ji zveřejníš, až budeš chtít" />
        </Link>
        <Link to={`/campaigns/${campaignId}/dm/loot`} className={step}>
          <Step icon={SwordsIcon} title="Připrav loot a nepřátele" hint="Ručně, nebo s AI pomocníkem" />
        </Link>
      </CardContent>
    </Card>
  )
}
