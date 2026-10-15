import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { FullPageSpinner } from '@/components/FullPageSpinner'
import { useAcceptInvite, usePreviewInvite } from './api'
import { normalizeInviteCode } from './invite'

export function JoinPage() {
  const { code: rawCode = '' } = useParams<{ code: string }>()
  const code = normalizeInviteCode(rawCode)
  const navigate = useNavigate()
  const { data: preview, isPending, error } = usePreviewInvite(code)
  const accept = useAcceptInvite()

  if (isPending) return <FullPageSpinner />

  if (error || !preview) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Pozvánka nejde použít</CardTitle>
          <CardDescription>Je neplatná, vypršela nebo ji DM zrušil. Popros DM o novou.</CardDescription>
        </CardHeader>
        <CardContent>
          <Link to="/" className={buttonVariants({ className: 'w-full' })}>
            Zpět na kampaně
          </Link>
        </CardContent>
      </Card>
    )
  }

  if (preview.already_member) return <Navigate to={`/campaigns/${preview.campaign_id}`} replace />

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pozvánka do kampaně</CardTitle>
        <CardDescription>
          {preview.dm_name ? `${preview.dm_name} tě zve do kampaně` : 'Jsi pozván do kampaně'}{' '}
          <strong>{preview.campaign_name}</strong>.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button
          size="lg"
          className="w-full"
          disabled={accept.isPending}
          onClick={() =>
            accept.mutate(code, {
              onSuccess: (campaignId) => void navigate(`/campaigns/${campaignId}`, { replace: true }),
              onError: () => toast.error('Připojení se nepodařilo. Pozvánka už možná neplatí.'),
            })
          }
        >
          Připojit se jako hráč
        </Button>
      </CardContent>
    </Card>
  )
}
