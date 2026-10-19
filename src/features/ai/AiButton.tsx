import { lazy, Suspense, useState } from 'react'
import { SparklesIcon } from 'lucide-react'
import { useActiveCampaign } from '@/features/campaigns/active-campaign'
import { useAiStatus } from './api'

const AiPanel = lazy(() => import('./AiPanel'))

/**
 * Tlačítko AI pomocníka v horní liště. Vidí ho jen DM aktivní kampaně, a to jen když mu ho server povolil (claude_users),
 * hráči se na stav pomocníka ani neptají. Panel s chatem se načte až po otevření.
 */
export function AiButton({ className }: { className: string }) {
  const { active } = useActiveCampaign()
  const isDm = active?.role === 'dm'
  const { data } = useAiStatus(active?.id, isDm)
  const [open, setOpen] = useState(false)
  if (!active || !isDm || !data?.enabled) return null
  return (
    <>
      <button type="button" className={className} aria-label="AI pomocník" title="AI pomocník DM" onClick={() => setOpen(true)}>
        <SparklesIcon aria-hidden className="size-5" />
      </button>
      {open && (
        <Suspense fallback={null}>
          <AiPanel key={active.id} campaignId={active.id} onClose={() => setOpen(false)} />
        </Suspense>
      )}
    </>
  )
}
