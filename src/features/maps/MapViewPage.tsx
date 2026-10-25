import { useState, type FormEvent } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeftIcon, MapPinPlusIcon, MoveIcon, PencilIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { RichText } from '@/components/RichText'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { FullPageSpinner } from '@/components/FullPageSpinner'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Modal } from '@/components/ui/modal'
import { NativeSelect } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { useCampaign, useCampaignMembers } from '@/features/campaigns/api'
import { useJournal } from '@/features/journal/api'
import { NpcPicker } from '@/features/journal/NpcPicker'
import { useJournalNpcs, type JournalNpc } from '@/features/journal/npc-api'
import { Avatar } from '@/features/sheet/Avatar'
import { ApiError } from '@/lib/api'
import { cn } from '@/lib/utils'
import { mapImageUrl, useCreatePin, useDeletePin, useMapPins, useMaps, useUpdatePin, type MapPin } from './api'
import { LeafletMap } from './LeafletMap'
import { PIN_ICONS, VISIBILITY_LABELS, emojiOf } from './pin-icons'
import { usePageTitle } from '@/lib/page-title'

type Draft = { kind: 'new'; x: number; y: number } | { kind: 'edit'; pin: MapPin }

export default function MapViewPage() {
  const { campaignId = '', mapId = '' } = useParams<{ campaignId: string; mapId: string }>()
  const { data: campaign, isPending } = useCampaign(campaignId)
  usePageTitle('Mapa', campaign?.name)
  const { data: maps, isPending: mapsPending } = useMaps(campaignId)
  const { data: pins } = useMapPins(mapId)
  const updatePin = useUpdatePin(mapId)
  const deletePin = useDeletePin(mapId)
  const [addMode, setAddMode] = useState(false)
  const [moveMode, setMoveMode] = useState(false)
  // Odkaz z přehledu NPC (`?pin=`) bod rovnou vybere a mapa na něj přiletí.
  const [params] = useSearchParams()
  const [selectedId, setSelectedId] = useState<string | null>(() => params.get('pin'))
  const [focus, setFocus] = useState<{ id: string; n: number } | null>(() => (params.get('pin') ? { id: params.get('pin')!, n: 0 } : null))
  const [draft, setDraft] = useState<Draft | null>(null)
  const { data: npcs } = useJournalNpcs(campaignId)

  const map = maps?.find((m) => m.id === mapId)
  const isDm = campaign?.role === 'dm'
  const selected = pins?.find((p) => p.id === selectedId) ?? null
  const npcById = new Map((npcs ?? []).map((n) => [n.id, n]))

  if (isPending || mapsPending) return <FullPageSpinner />
  if (!map) {
    return (
      <div className="space-y-4 py-10 text-center">
        <h1 className="text-2xl font-bold">Mapa nenalezena</h1>
        <Link to={`/campaigns/${campaignId}/maps`} className="underline">
          Zpět na mapy
        </Link>
      </div>
    )
  }

  const select = (id: string) => {
    setSelectedId(id)
    setAddMode(false)
  }

  return (
    <>
      <div className="space-y-2">
        <Link to={`/campaigns/${campaignId}/maps`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeftIcon aria-hidden className="size-4" /> Mapy
        </Link>
        <h1 className="text-2xl font-bold">{map.name}</h1>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant={addMode ? 'default' : 'secondary'} aria-pressed={addMode} onClick={() => { setAddMode((v) => !v); setMoveMode(false) }}>
          <MapPinPlusIcon aria-hidden /> {isDm ? 'Přidat bod' : 'Přidat poznámku'}
        </Button>
        {pins?.some((p) => p.canEdit) && (
          <Button variant={moveMode ? 'default' : 'outline'} aria-pressed={moveMode} onClick={() => { setMoveMode((v) => !v); setAddMode(false) }}>
            <MoveIcon aria-hidden /> Přesouvat body
          </Button>
        )}
        {addMode && <p role="status" className="text-sm text-muted-foreground">Klepni na mapu, kam bod patří.</p>}
        {moveMode && <p role="status" className="text-sm text-muted-foreground">Přetáhni bod na nové místo.</p>}
      </div>

      <LeafletMap
        imageUrl={mapImageUrl(map)}
        width={map.width}
        height={map.height}
        pins={pins ?? []}
        selectedId={selectedId}
        addMode={addMode}
        onAdd={(x, y) => {
          setAddMode(false)
          setDraft({ kind: 'new', x, y })
        }}
        onSelect={select}
        moveMode={moveMode}
        onMove={(id, x, y) =>
          updatePin.mutate({ id, x, y }, { onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Bod se nepodařilo přesunout.') })
        }
        focus={focus}
      />

      {selected && (
        <Card>
          <CardContent className="space-y-2 p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h2 className="flex items-center gap-2 text-lg font-semibold">
                  <span aria-hidden>{emojiOf(selected.icon)}</span>
                  <span className="truncate">{selected.title}</span>
                </h2>
                <p className="text-xs text-muted-foreground">
                  {VISIBILITY_LABELS[selected.visibility]} · {selected.mine ? 'ty' : selected.createdByName}
                </p>
              </div>
              {selected.canEdit && (
                <div className="flex shrink-0 gap-1">
                  <Button variant="outline" onClick={() => setDraft({ kind: 'edit', pin: selected })}>
                    <PencilIcon aria-hidden /> Upravit
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Smazat bod ${selected.title}`}
                    title="Smazat bod"
                    onClick={() => {
                      if (window.confirm(`Smazat bod „${selected.title}“?`))
                        deletePin.mutate(selected.id, { onSuccess: () => setSelectedId(null), onError: () => toast.error('Bod se nepodařilo smazat') })
                    }}
                  >
                    <Trash2Icon aria-hidden />
                  </Button>
                </div>
              )}
            </div>
            {selected.description && <p className="whitespace-pre-wrap break-words">{selected.description}</p>}
            <PinNpcs campaignId={campaignId} npcs={selected.npcIds.flatMap((id) => npcById.get(id) ?? [])} />
          </CardContent>
        </Card>
      )}

      <section aria-label="Seznam bodů" className="space-y-2">
        <h2 className="text-lg font-semibold">Body na mapě</h2>
        {pins?.length === 0 && <p className="text-sm text-muted-foreground">Na mapě zatím nic není.</p>}
        <ul className="grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-2 tab:grid-cols-3">
          {pins?.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => {
                  select(p.id)
                  setFocus((f) => ({ id: p.id, n: (f?.n ?? 0) + 1 }))
                }}
                className={cn('flex min-h-12 w-full items-center gap-2 rounded-lg border bg-card px-3 text-left hover:bg-muted/50', p.id === selectedId && 'border-primary')}
              >
                <span aria-hidden>{emojiOf(p.icon)}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{p.title}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {[VISIBILITY_LABELS[p.visibility], ...p.npcIds.flatMap((id) => npcById.get(id)?.name ?? [])].join(' · ')}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <Modal open={draft !== null} onClose={() => setDraft(null)} title={draft?.kind === 'edit' ? 'Upravit bod' : isDm ? 'Nový bod' : 'Nová poznámka'}>
        {draft && <PinForm key={draft.kind === 'edit' ? draft.pin.id : `${draft.x},${draft.y}`} mapId={mapId} campaignId={campaignId} draft={draft} isDm={isDm} onDone={(id) => { setDraft(null); if (id) select(id) }} />}
      </Modal>
    </>
  )
}

function PinForm({ mapId, campaignId, draft, isDm, onDone }: { mapId: string; campaignId: string; draft: Draft; isDm: boolean; onDone: (pinId?: string) => void }) {
  const { data: members } = useCampaignMembers(campaignId)
  const create = useCreatePin(mapId)
  const update = useUpdatePin(mapId)
  const editing = draft.kind === 'edit' ? draft.pin : null
  const [title, setTitle] = useState(editing?.title ?? '')
  const [description, setDescription] = useState(editing?.description ?? '')
  const [icon, setIcon] = useState(editing?.icon ?? 'pin')
  const [visibility, setVisibility] = useState<MapPin['visibility']>(editing?.visibility ?? 'all')
  const [viewers, setViewers] = useState<Set<string>>(new Set(editing?.viewerIds ?? []))
  const [npcIds, setNpcIds] = useState<string[]>(editing?.npcIds ?? [])
  const players = members?.filter((m) => m.role === 'player') ?? []
  // Viditelnost volí jen DM; body hráčů vidí všichni (stará soukromá poznámka zůstane, jak je).
  const choosesVisibility = isDm && editing?.visibility !== 'owner'
  const pending = create.isPending || update.isPending
  const valid = title.trim() !== '' && (visibility !== 'selected' || viewers.size > 0)

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!valid) return
    const common = { title: title.trim(), description, icon, npcIds, ...(choosesVisibility ? { visibility, ...(visibility === 'selected' ? { viewerIds: [...viewers] } : {}) } : {}) }
    const onError = (err: Error) => toast.error(err instanceof ApiError ? err.message : 'Uložení se nepodařilo.')
    if (editing) update.mutate({ id: editing.id, ...common }, { onSuccess: (p) => onDone(p.id), onError })
    else if (draft.kind === 'new') create.mutate({ x: draft.x, y: draft.y, ...common }, { onSuccess: (p) => onDone(p.id), onError })
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="pin-title">Název</Label>
        <Input id="pin-title" required maxLength={100} autoFocus value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="pin-desc">Popis</Label>
        <Textarea id="pin-desc" rows={3} maxLength={2000} className="min-h-20" value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
<NpcPicker campaignId={campaignId} value={npcIds} onChange={setNpcIds} id="pin-npc" label="Kdo se tu nachází (NPC a postavy z deníku)" removeSuffix="z bodu" />
      <div role="group" aria-label="Ikona" className="flex flex-wrap gap-2">
        {PIN_ICONS.map((i) => (
          <button
            key={i.value}
            type="button"
            aria-label={i.label}
            aria-pressed={icon === i.value}
            title={i.label}
            onClick={() => setIcon(i.value)}
            className={cn('flex size-11 items-center justify-center rounded-lg border text-xl', icon === i.value ? 'border-primary bg-primary/10 ring-2 ring-primary/40' : 'bg-background hover:bg-muted')}
          >
            {i.emoji}
          </button>
        ))}
      </div>
      {!choosesVisibility ? (
        <p className="rounded-lg border bg-muted/50 p-3 text-sm">
          {editing?.visibility === 'owner' ? 'Soukromá poznámka: uvidíš ji jen ty.' : 'Bod uvidí všichni, kdo vidí mapu.'}
        </p>
      ) : (
        <div className="space-y-2">
          <Label htmlFor="pin-visibility">Kdo bod uvidí</Label>
          <NativeSelect id="pin-visibility" value={visibility} onChange={(e) => setVisibility(e.target.value as MapPin['visibility'])}>
            <option value="all">Všichni hráči</option>
            <option value="selected">Vybraní hráči</option>
            <option value="dm">Jen já (DM)</option>
          </NativeSelect>
          {visibility === 'selected' && (
            <fieldset className="flex flex-wrap gap-2">
              <legend className="sr-only">Vybraní hráči</legend>
              {players.map((m) => (
                <label key={m.userId} className="flex min-h-11 items-center gap-2 rounded-lg border px-3">
                  <input
                    type="checkbox"
                    className="size-5"
                    checked={viewers.has(m.userId)}
                    onChange={(e) =>
                      setViewers((v) => {
                        const next = new Set(v)
                        if (e.target.checked) next.add(m.userId)
                        else next.delete(m.userId)
                        return next
                      })
                    }
                  />
                  {m.displayName}
                </label>
              ))}
              {players.length === 0 && <p className="text-sm text-muted-foreground">V kampani zatím nejsou žádní hráči.</p>}
            </fieldset>
          )}
        </div>
      )}
      <Button type="submit" size="lg" className="w-full" disabled={!valid || pending}>
        {editing ? 'Uložit' : 'Přidat na mapu'}
      </Button>
    </form>
  )
}

/** NPC a postavy na bodu: popis a jejich zápisy z deníku, s odkazem do přehledu NPC. */
function PinNpcs({ campaignId, npcs }: { campaignId: string; npcs: JournalNpc[] }) {
  const { data: journal } = useJournal(campaignId)
  if (npcs.length === 0) return null
  const entries = journal?.entries ?? []
  return (
    <section aria-label="Kdo se tu nachází" className="space-y-2 border-t pt-3">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Kdo se tu nachází</h3>
      <ul className="space-y-2">
        {npcs.map((n) => {
          const story = entries.filter((e) => e.npcIds.includes(n.id))
          return (
            <li key={n.id} className="space-y-2 rounded-xl border bg-background p-3">
              <div className="flex items-center gap-3">
                <Avatar id={n.characterId ?? n.id} name={n.name} version={n.photoVersion} className="size-10 text-base" />
                <div className="min-w-0 flex-1">
                  <p className="break-words font-semibold">{n.name}</p>
                  {n.race && <p className="text-xs text-muted-foreground">{n.race}</p>}
                </div>
              </div>
              {n.description && <RichText text={n.description} className="break-words text-sm" />}
              {story.length > 0 && (
                <ul aria-label={`Zápisy o ${n.name}`} className="space-y-1">
                  {story.map((e) => (
                    <li key={e.id}>
                      <Link to={`/campaigns/${campaignId}/journal?entry=${e.id}`} className="inline-flex min-h-11 items-center text-sm text-primary underline underline-offset-2">
                        📖 {e.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              <Link to={`/campaigns/${campaignId}/journal/npcs?npc=${n.id}`} className={buttonVariants({ variant: 'outline' })}>
                Detail v deníku
              </Link>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
