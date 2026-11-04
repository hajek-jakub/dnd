import { useRef } from 'react'
import { Navigate } from 'react-router-dom'
import { FullPageSpinner } from '@/components/FullPageSpinner'
import { useMyCampaigns, useMyInvitations } from './api'
import { CampaignsPage } from './CampaignsPage'

/**
 * Úvodní adresa: kdo má jedinou kampaň (a žádnou čekající pozvánku), jde rovnou do ní.
 * S víc kampaněmi si vybere, kterou chce zrovna hrát; bez kampaně uvidí zakládání a připojení.
 */
export function HomeRoute() {
  const { data: campaigns, isPending } = useMyCampaigns()
  const { data: invitations, isPending: invitationsPending } = useMyInvitations()
  // Rozhoduje se jednou: přijetí pozvánky na výběru nesmí výběr přepnout na přesměrování do jiné kampaně.
  const picker = useRef<boolean | null>(null)
  // S jedinou kampaní se čeká i na pozvánky, jinak by přesměrování schovalo čerstvou pozvánku.
  if (picker.current === null && (isPending || (campaigns?.length === 1 && invitationsPending))) return <FullPageSpinner />
  const only = campaigns?.length === 1 ? campaigns[0] : undefined
  picker.current ??= !(only && (invitations?.length ?? 0) === 0)
  if (!picker.current && only) return <Navigate to={`/campaigns/${only.id}`} replace />
  return <CampaignsPage />
}
