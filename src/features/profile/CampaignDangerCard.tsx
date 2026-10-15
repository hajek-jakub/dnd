import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuth } from '@/features/auth/auth-context'
import { useDeleteCampaign, useRemoveMember } from '@/features/campaigns/api'
import type { CampaignSummary } from '@/lib/types'

/** Opuštění kampaně (hráč) a smazání kampaně (DM): schované v Profilu, ne na hlavní stránce kampaně. */
export function CampaignDangerCard({ campaigns }: { campaigns: CampaignSummary[] | undefined }) {
  if (!campaigns || campaigns.length === 0) return null
  return (
    <Card>
      <CardHeader>
        <CardTitle>Nebezpečná zóna</CardTitle>
        <CardDescription>Odejít z kampaně můžeš jako hráč, smazat ji jen jako DM. Smazání nejde vrátit.</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y">
          {campaigns.map((c) => (
            <DangerRow key={c.id} campaign={c} />
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

function DangerRow({ campaign }: { campaign: CampaignSummary }) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const removeMember = useRemoveMember(campaign.id)
  const deleteCampaign = useDeleteCampaign(campaign.id)
  const isDm = campaign.role === 'dm'

  function leave() {
    if (!user || !window.confirm(`Opravdu chceš z kampaně „${campaign.name}“ odejít? Své postavy v ní už neuvidíš.`)) return
    removeMember.mutate(user.id, {
      // Nejdřív se obnoví seznam kampaní, jinak by úvodní stránka poslala uživatele zpátky do kampaně, kterou právě opustil.
      onSuccess: async () => {
        queryClient.removeQueries({ queryKey: ['campaign', campaign.id] })
        await queryClient.refetchQueries({ queryKey: ['campaigns'] })
        void navigate('/')
      },
      onError: () => toast.error('Z kampaně se nepodařilo odejít'),
    })
  }

  function remove() {
    if (!window.confirm(`Smazat kampaň „${campaign.name}“ včetně všech dat? Tohle nejde vrátit.`)) return
    deleteCampaign.mutate(undefined, {
      onSuccess: () => void navigate('/'),
      onError: () => toast.error('Kampaň se nepodařilo smazat'),
    })
  }

  return (
    <li className="flex min-h-14 flex-wrap items-center justify-between gap-2 py-2">
      <span className="min-w-0 truncate font-medium">{campaign.name}</span>
      {isDm ? (
        <Button variant="destructive" aria-label={`Smazat kampaň ${campaign.name}`} onClick={remove} disabled={deleteCampaign.isPending}>
          Smazat kampaň
        </Button>
      ) : (
        <Button variant="destructive" aria-label={`Odejít z kampaně ${campaign.name}`} onClick={leave} disabled={removeMember.isPending}>
          Odejít z kampaně
        </Button>
      )}
    </li>
  )
}
