import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom'
import { ChevronDownIcon, PencilIcon, PinIcon, PlusIcon, SearchIcon, Trash2Icon, UserRoundIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { FullPageSpinner } from '@/components/FullPageSpinner'
import { Input } from '@/components/ui/input'
import { Modal } from '@/components/ui/modal'
import { RichText } from '@/components/RichText'
import { useCampaign } from '@/features/campaigns/api'
import { cn } from '@/lib/utils'
import { useDeleteEntry, useJournal, useMarkJournalRead, type JournalEntry } from './api'
import { EntryForm } from './EntryForm'
import { DEFAULT_TOPICS } from './topics'
import { JournalHeader } from './JournalTabs'
import { fold } from './npc-list'
import { useJournalNpcs } from './npc-api'
import { PlaceList } from '@/features/maps/places'
import { usePageTitle } from '@/lib/page-title'

const VISIBILITY_LABELS: Record<JournalEntry['visibility'], string> = {
  all: 'Vidí všichni',
  selected: 'Vidí vybraní hráči',
  dm: 'Vidí jen DM',
  owner: 'Starý soukromý zápisek (jen ty)',
}

const dateFormat = (iso: string) => new Date(iso).toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric' })

export function JournalPage() {
  const { campaignId = '' } = useParams<{ campaignId: string }>()
  const { data: campaign, isPending } = useCampaign(campaignId)
  usePageTitle('Deník', campaign?.name)
  const { data, isPending: entriesPending } = useJournal(campaignId)
  const { data: npcs = [] } = useJournalNpcs(campaignId)
  const npcById = useMemo(() => new Map(npcs.map((n) => [n.id, n])), [npcs])
  const [params] = useSearchParams()
  const focusId = params.get('entry')
  const markRead = useMarkJournalRead(campaignId)
  const remove = useDeleteEntry(campaignId)
  const [query, setQuery] = useState('')
  const [topic, setTopic] = useState<string | null>(null)
  const [editing, setEditing] = useState<JournalEntry | 'new' | null>(null)
  const [openIds, setOpenIds] = useState<Set<string>>(new Set())
  // Které zápisy byly při otevření deníku nové: ukazují se označené, i když se deník mezitím označí jako přečtený.
  const [newIds, setNewIds] = useState<Set<string> | null>(null)
  const initialised = useRef(false)

  const isDm = campaign?.role === 'dm'
  const entries = useMemo(() => data?.entries ?? [], [data?.entries])

  useEffect(() => {
    if (!data || initialised.current) return
    initialised.current = true
    const fresh = new Set(data.entries.filter((e) => e.isNew).map((e) => e.id))
    setNewIds(fresh)
    // Zápis z odkazu (např. z detailu NPC) se otevře a je vidět; nové zápisy jsou také rozbalené.
    setOpenIds(focusId && data.entries.some((e) => e.id === focusId) ? new Set([...fresh, focusId]) : fresh)
    markRead.mutate()
    // označí se jen při prvním načtení po otevření stránky
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  useEffect(() => {
    if (!focusId || !data) return
    document.getElementById(`entry-${focusId}`)?.scrollIntoView({ block: 'center' })
  }, [focusId, data])

  const topics = useMemo(() => [...new Set(entries.map((e) => e.topic))].sort((a, b) => a.localeCompare(b, 'cs')), [entries])
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    const f = fold(q)
    return entries.filter(
      (e) => (topic === null || e.topic === topic) && (f === '' || fold(`${e.title} ${e.body} ${e.topic} ${e.npcIds.map((id) => npcById.get(id)?.name ?? '').join(' ')}`).includes(f)),
    )
  }, [entries, query, topic, npcById])
  const pinned = visible.filter((e) => e.pinned)
  const byTopic = useMemo(() => {
    const map = new Map<string, JournalEntry[]>()
    for (const e of visible.filter((x) => !x.pinned)) map.set(e.topic, [...(map.get(e.topic) ?? []), e])
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], 'cs'))
  }, [visible])

  if (isPending) return <FullPageSpinner />
  if (!campaign) return <Navigate to="/" replace />

  const toggle = (id: string) =>
    setOpenIds((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const card = (e: JournalEntry) => {
    const open = openIds.has(e.id)
    return (
      <li key={e.id} id={`entry-${e.id}`} className={cn('rounded-xl border bg-card shadow-xs', newIds?.has(e.id) && 'border-primary/60 ring-2 ring-primary/20')}>
        <button
          type="button"
          aria-expanded={open}
          onClick={() => toggle(e.id)}
          className="flex min-h-14 w-full items-center gap-3 rounded-xl px-4 py-3 text-left"
        >
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-2">
              {e.pinned && <PinIcon aria-label="Připnuto" className="size-4 text-primary" />}
              <span className="font-semibold">{e.title}</span>
              {newIds?.has(e.id) && <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground">nové</span>}
            </span>
            <span className="block truncate text-xs text-muted-foreground">
              {e.topic} · {e.mine ? 'ty' : e.createdByName} · {dateFormat(e.updatedAt)}
              {e.visibility !== 'all' && ` · ${VISIBILITY_LABELS[e.visibility]}`}
              {e.npcIds.length > 0 && ` · ${e.npcIds.length} NPC`}
              {e.places.length > 0 && ` · na mapě`}
            </span>
          </span>
          <ChevronDownIcon aria-hidden className={cn('size-5 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} />
        </button>
        {open && (
          <div className="space-y-3 border-t px-4 py-3">
            {e.body ? <RichText text={e.body} className="break-words" /> : <p className="text-sm text-muted-foreground">Zápis nemá žádný text.</p>}
            {e.npcIds.length > 0 && (
              <ul aria-label="NPC a postavy v zápisu" className="flex flex-wrap gap-2">
                {e.npcIds.map((id) => {
                  const npc = npcById.get(id)
                  if (!npc) return null
                  return (
                    <li key={id}>
                      <Link
                        to={`/campaigns/${campaignId}/journal/npcs?npc=${id}`}
                        className="inline-flex min-h-11 items-center gap-1.5 rounded-full border bg-muted px-3 text-sm font-medium hover:border-primary/50"
                      >
                        <UserRoundIcon aria-hidden className="size-4 text-primary" /> {npc.name}
                      </Link>
                    </li>
                  )
                })}
              </ul>
            )}
            {e.places.length > 0 && (
              <section aria-label="Na mapě" className="space-y-2">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Na mapě</h3>
                <PlaceList campaignId={campaignId} places={e.places} />
              </section>
            )}
            {e.canEdit && (
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setEditing(e)}>
                  <PencilIcon aria-hidden /> Upravit
                </Button>
                <Button
                  variant="ghost"
                  aria-label={`Smazat zápis ${e.title}`}
                  onClick={() => {
                    if (window.confirm(`Smazat zápis „${e.title}“?`)) remove.mutate(e.id, { onError: () => toast.error('Zápis se nepodařilo smazat') })
                  }}
                >
                  <Trash2Icon aria-hidden /> Smazat
                </Button>
              </div>
            )}
          </div>
        )}
      </li>
    )
  }

  return (
    <>
      <JournalHeader
        campaignId={campaignId}
        active="entries"
        npcCount={npcs.length}
        actions={
          <Button onClick={() => setEditing('new')}>
            <PlusIcon aria-hidden /> Nový zápis
          </Button>
        }
      />

      <div className="space-y-3">
        <div className="relative">
          <SearchIcon aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input type="search" aria-label="Hledat v deníku" placeholder="Hledat v deníku…" className="pl-9" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        {topics.length > 1 && (
          <div role="group" aria-label="Témata" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
            {[null, ...topics].map((t) => (
              <button
                key={t ?? 'all'}
                type="button"
                aria-pressed={topic === t}
                onClick={() => setTopic(t)}
                className={cn(
                  'inline-flex min-h-11 shrink-0 items-center rounded-full border px-4 text-sm font-medium',
                  topic === t ? 'border-primary bg-primary text-primary-foreground' : 'bg-card hover:bg-muted',
                )}
              >
                {t ?? 'Vše'}
              </button>
            ))}
          </div>
        )}
      </div>

      {entriesPending && <p className="text-muted-foreground">Načítám deník…</p>}
      {!entriesPending && entries.length === 0 && (
        <p className="rounded-xl border border-dashed p-6 text-center text-muted-foreground">
          {isDm ? 'V deníku zatím nic není. Napiš první zápis, třeba o příběhu, místech nebo frakcích, a hráči ho uvidí.' : 'V deníku zatím nic není. Deník je společný pro celou družinu: napiš první zápis, třeba co jste zažili, a uvidí ho všichni.'}
        </p>
      )}
      {entries.length > 0 && visible.length === 0 && <p className="text-muted-foreground">Nic nenalezeno.</p>}

      {pinned.length > 0 && (
        <section aria-label="Připnuté zápisy" className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Důležité</h2>
          <ul className="space-y-2">{pinned.map(card)}</ul>
        </section>
      )}
      {byTopic.map(([name, list]) => (
        <section key={name} aria-label={`Téma: ${name}`} className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{name}</h2>
          <ul className="space-y-2">{list.map(card)}</ul>
        </section>
      ))}

      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing === 'new' ? 'Nový zápis' : 'Upravit zápis'}>
        {editing && (
          <EntryForm
            key={editing === 'new' ? 'new' : editing.id}
            campaignId={campaignId}
            entry={editing === 'new' ? null : editing}
            isDm={isDm}
            topics={[...new Set([...DEFAULT_TOPICS, ...topics])]}
            onDone={() => setEditing(null)}
          />
        )}
      </Modal>
    </>
  )
}
