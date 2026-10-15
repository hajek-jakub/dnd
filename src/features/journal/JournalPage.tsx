import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { BookOpenIcon, ChevronDownIcon, PencilIcon, PinIcon, PlusIcon, SearchIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { FullPageSpinner } from '@/components/FullPageSpinner'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Modal } from '@/components/ui/modal'
import { NativeSelect } from '@/components/ui/native-select'
import { RichText } from '@/components/RichText'
import { Textarea } from '@/components/ui/textarea'
import { useCampaign, useCampaignMembers } from '@/features/campaigns/api'
import { ApiError } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useCreateEntry, useDeleteEntry, useJournal, useMarkJournalRead, useUpdateEntry, type JournalEntry } from './api'
import { usePageTitle } from '@/lib/page-title'

const DEFAULT_TOPICS = ['Příběh', 'Místa', 'Postavy', 'Frakce', 'Úkoly', 'Předměty', 'Domácí pravidla']

const VISIBILITY_LABELS: Record<JournalEntry['visibility'], string> = {
  all: 'Vidí všichni',
  selected: 'Vidí vybraní hráči',
  dm: 'Vidí jen DM',
  owner: 'Soukromý zápisek (jen ty)',
}

const dateFormat = (iso: string) => new Date(iso).toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric' })

export function JournalPage() {
  const { campaignId = '' } = useParams<{ campaignId: string }>()
  const { data: campaign, isPending } = useCampaign(campaignId)
  usePageTitle('Deník', campaign?.name)
  const { data, isPending: entriesPending } = useJournal(campaignId)
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
    setOpenIds(fresh)
    markRead.mutate()
    // označí se jen při prvním načtení po otevření stránky
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  const topics = useMemo(() => [...new Set(entries.map((e) => e.topic))].sort((a, b) => a.localeCompare(b, 'cs')), [entries])
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return entries.filter((e) => (topic === null || e.topic === topic) && (q === '' || `${e.title} ${e.body} ${e.topic}`.toLowerCase().includes(q)))
  }, [entries, query, topic])
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
      <li key={e.id} className={cn('rounded-xl border bg-card shadow-xs', newIds?.has(e.id) && 'border-primary/60 ring-2 ring-primary/20')}>
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
            </span>
          </span>
          <ChevronDownIcon aria-hidden className={cn('size-5 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} />
        </button>
        {open && (
          <div className="space-y-3 border-t px-4 py-3">
            {e.body ? <RichText text={e.body} className="break-words" /> : <p className="text-sm text-muted-foreground">Zápis nemá žádný text.</p>}
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <BookOpenIcon aria-hidden className="size-6 text-primary" /> Deník
        </h1>
        <Button onClick={() => setEditing('new')}>
          <PlusIcon aria-hidden /> {isDm ? 'Nový zápis' : 'Můj zápisek'}
        </Button>
      </div>

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
          {isDm ? 'V deníku zatím nic není. Napiš první zápis, třeba o příběhu, místech nebo frakcích, a hráči ho uvidí.' : 'DM zatím nic nezapsal. Až přidá informace, uvidíš je tady. Můžeš si psát i vlastní zápisky.'}
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

      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing === 'new' ? (isDm ? 'Nový zápis' : 'Nový zápisek') : 'Upravit zápis'}>
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

function EntryForm({ campaignId, entry, isDm, topics, onDone }: { campaignId: string; entry: JournalEntry | null; isDm: boolean; topics: string[]; onDone: () => void }) {
  const { data: members } = useCampaignMembers(campaignId)
  const create = useCreateEntry(campaignId)
  const update = useUpdateEntry(campaignId)
  const [topic, setTopic] = useState(entry?.topic ?? 'Příběh')
  const [title, setTitle] = useState(entry?.title ?? '')
  const [body, setBody] = useState(entry?.body ?? '')
  const [visibility, setVisibility] = useState<JournalEntry['visibility']>(entry?.visibility ?? (isDm ? 'all' : 'owner'))
  const [viewers, setViewers] = useState<Set<string>>(new Set(entry?.viewerIds ?? []))
  const [pinned, setPinned] = useState(entry?.pinned ?? false)
  const privateNote = !isDm || entry?.visibility === 'owner'
  const players = members?.filter((m) => m.role === 'player') ?? []
  const valid = title.trim() !== '' && topic.trim() !== '' && (visibility !== 'selected' || viewers.size > 0)
  const pending = create.isPending || update.isPending

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!valid) return
    const common = {
      topic: topic.trim(),
      title: title.trim(),
      body,
      ...(privateNote ? {} : { visibility, pinned, ...(visibility === 'selected' ? { viewerIds: [...viewers] } : {}) }),
    }
    const onError = (err: Error) => toast.error(err instanceof ApiError ? err.message : 'Zápis se nepodařilo uložit.')
    if (entry) update.mutate({ id: entry.id, ...common }, { onSuccess: onDone, onError })
    else create.mutate(common, { onSuccess: onDone, onError })
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="journal-topic">Téma</Label>
        <Input id="journal-topic" list="journal-topics" required maxLength={60} value={topic} onChange={(e) => setTopic(e.target.value)} />
        <datalist id="journal-topics">
          {topics.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
      </div>
      <div className="space-y-2">
        <Label htmlFor="journal-title">Nadpis</Label>
        <Input id="journal-title" required maxLength={120} autoFocus value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="journal-body">Text</Label>
        <Textarea id="journal-body" rows={8} maxLength={20000} value={body} onChange={(e) => setBody(e.target.value)} />
        <p className="text-xs text-muted-foreground">Formátování: **tučně**, *kurzíva*, „# Nadpis“, odrážky „- položka“, odkazy https://…</p>
      </div>
      {privateNote ? (
        <p className="rounded-lg border border-amber-500 bg-amber-500/10 p-3 text-sm">Soukromý zápisek: uvidíš ho jen ty, ani DM ne.</p>
      ) : (
        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="journal-visibility">Kdo zápis uvidí</Label>
            <NativeSelect id="journal-visibility" value={visibility} onChange={(e) => setVisibility(e.target.value as JournalEntry['visibility'])}>
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
          <label className="flex min-h-11 items-center gap-3">
            <input type="checkbox" className="size-5" checked={pinned} onChange={(e) => setPinned(e.target.checked)} />
            Připnout nahoru (důležité)
          </label>
        </div>
      )}
      <Button type="submit" size="lg" className="w-full" disabled={!valid || pending}>
        {entry ? 'Uložit' : 'Přidat do deníku'}
      </Button>
    </form>
  )
}
