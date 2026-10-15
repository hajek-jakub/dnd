import { useRef, useState, type FormEvent } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { ArrowLeftIcon, EyeIcon, EyeOffIcon, Trash2Icon, UploadIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { FullPageSpinner } from '@/components/FullPageSpinner'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useCampaign } from '@/features/campaigns/api'
import { mapImageUrl, useDeleteMap, useMaps, useUpdateMap, useUploadMap, type MapInfo } from './api'
import { shrinkImage } from './shrink-image'
import { usePageTitle } from '@/lib/page-title'

export function MapsPage() {
  const { campaignId = '' } = useParams<{ campaignId: string }>()
  const { data: campaign, isPending } = useCampaign(campaignId)
  usePageTitle('Mapy', campaign?.name)
  const { data: maps, isPending: mapsPending } = useMaps(campaignId)
  const isDm = campaign?.role === 'dm'

  if (isPending) return <FullPageSpinner />
  if (!campaign) return <Navigate to="/" replace />

  return (
    <>
      <div className="space-y-2">
        <Link to={`/campaigns/${campaignId}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeftIcon aria-hidden className="size-4" /> {campaign.name}
        </Link>
        <h1 className="text-2xl font-bold">Mapy</h1>
      </div>

      {isDm && <UploadCard campaignId={campaignId} />}

      {mapsPending && <p className="text-muted-foreground">Načítám mapy…</p>}
      {maps?.length === 0 && (
        <p className="text-muted-foreground">{isDm ? 'Zatím tu nejsou žádné mapy. Nahraj první.' : 'DM zatím žádnou mapu nezveřejnil.'}</p>
      )}
      <ul aria-label="Mapy kampaně" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {maps?.map((m) => (
          <MapCard key={m.id} campaignId={campaignId} map={m} isDm={isDm} />
        ))}
      </ul>
    </>
  )
}

function UploadCard({ campaignId }: { campaignId: string }) {
  const upload = useUploadMap(campaignId)
  const [name, setName] = useState('')
  const file = useRef<HTMLInputElement>(null)
  const [chosen, setChosen] = useState<File | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!chosen || !name.trim()) return
    const { blob, filename } = await shrinkImage(chosen)
    upload.mutate(
      { name: name.trim(), image: blob, filename },
      {
        onSuccess: () => {
          toast.success('Mapa nahrána. Hráči ji uvidí, až ji zveřejníš.')
          setName('')
          setChosen(null)
          if (file.current) file.current.value = ''
        },
        onError: (err) => toast.error(err.message),
      },
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Nahrát mapu</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={(e) => void submit(e)} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <div className="space-y-2">
            <Label htmlFor="map-name">Název mapy</Label>
            <Input id="map-name" required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="map-file">Obrázek (JPEG, PNG, WebP)</Label>
            <Input id="map-file" ref={file} type="file" accept="image/jpeg,image/png,image/webp,image/gif" required onChange={(e) => setChosen(e.target.files?.[0] ?? null)} />
          </div>
          <Button type="submit" disabled={!chosen || !name.trim() || upload.isPending}>
            <UploadIcon aria-hidden /> {upload.isPending ? 'Nahrávám…' : 'Nahrát'}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}

function MapCard({ campaignId, map, isDm }: { campaignId: string; map: MapInfo; isDm: boolean }) {
  const update = useUpdateMap(campaignId)
  const remove = useDeleteMap(campaignId)
  return (
    <li className="overflow-hidden rounded-xl border bg-card">
      <Link to={`/campaigns/${campaignId}/maps/${map.id}`} className="block">
        <img src={mapImageUrl(map)} alt="" loading="lazy" decoding="async" className="aspect-[4/3] w-full bg-muted object-cover" />
        <span className="block truncate p-3 font-medium">{map.name}</span>
      </Link>
      {isDm && (
        <div className="flex items-center justify-between gap-2 border-t p-2">
          <span className="text-xs text-muted-foreground">{map.visible ? 'Hráči ji vidí' : 'Skrytá před hráči'}</span>
          <div className="flex gap-1">
            <Button
              variant="outline"
              disabled={update.isPending}
              onClick={() =>
                update.mutate({ id: map.id, visible: !map.visible }, { onError: () => toast.error('Změna se nepodařila') })
              }
            >
              {map.visible ? <EyeOffIcon aria-hidden /> : <EyeIcon aria-hidden />} {map.visible ? 'Skrýt' : 'Zveřejnit'}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Smazat mapu ${map.name}`}
              title="Smazat mapu"
              onClick={() => {
                if (window.confirm(`Smazat mapu „${map.name}“ včetně všech bodů?`)) remove.mutate(map.id, { onError: () => toast.error('Mapu se nepodařilo smazat') })
              }}
            >
              <Trash2Icon aria-hidden />
            </Button>
          </div>
        </div>
      )}
    </li>
  )
}
