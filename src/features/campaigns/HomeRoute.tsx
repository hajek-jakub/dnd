import { Navigate } from 'react-router-dom'
import { FullPageSpinner } from '@/components/FullPageSpinner'
import { useActiveCampaign } from './active-campaign'
import { CampaignsPage } from './CampaignsPage'

/** Úvodní adresa: kdo má kampaň, rovnou se dostane do té aktivní; bez kampaně uvidí zakládání a připojení. */
export function HomeRoute() {
  const { active, loading } = useActiveCampaign()
  if (loading) return <FullPageSpinner />
  if (active) return <Navigate to={`/campaigns/${active.id}`} replace />
  return <CampaignsPage />
}
