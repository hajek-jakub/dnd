import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeftIcon, ChevronDownIcon, EyeOffIcon, LinkIcon, PencilIcon, PlusIcon, SearchIcon, Trash2Icon, UnlinkIcon, UsersIcon } from 'lucide-react'
import { toast } from 'sonner'
import { FullPageSpinner } from '@/components/FullPageSpinner'
import { RichText } from '@/components/RichText'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Modal } from '@/components/ui/modal'
import { NativeSelect } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { useCampaign } from '@/features/campaigns/api'
import { emojiOf } from '@/features/maps/pin-icons'
import { Avatar } from '@/features/sheet/Avatar'
import { useCharacters } from '@/features/sheet/api'
import { ApiError } from '@/lib/api'
import { usePageTitle } from '@/lib/page-title'
import { cn } from '@/lib/utils'
import { useJournal, useUpdateEntry, type JournalEntry } from './api'
import { EntryForm } from './EntryForm'
import { DEFAULT_TOPICS } from './topics'
import { JournalHeader } from './JournalTabs'
import { useAddCharacterNpcs, useCreateNpc, useDeleteNpc, useJournalNpcs, useUpdateNpc, type JournalNpc } from './npc-api'
import { filterNpcs, groupByLetter, type NpcFilter } from './npc-list'

const FILTERS: { id: NpcFilter; label: string }[] = [
  { id: 'all', label: 'Vše' },
  { id: 'npc', label: 'NPC' },
  { id: 'character', label: 'Postavy hráčů' },
]

const dateFormat = (iso: string) => new Date(iso).toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric' })

type Dialog = null | 'new' | 'campaign' | { edit: JournalNpc }

/**
 * Přehled NPC v deníku: abecední seznam (jméno, rasa, popis) a u každého NPC jeho příběh = zápisy deníku, které se ho týkají.
 * Na telefonu je seznam a po klepnutí detail (adresa `?npc=`), na počítači vedle sebe.
 */
export function NpcPage() {
  const { campaignId = '' } = useParams<{ campaignId: string }>()
  const { data: campaign, isPending } = useCampaign(campaignId)
  usePageTitle('NPC v deníku', campaign?.name)
  const { data: npcs, isPending: npcsPending } = useJournalNpcs(campaignId)
  const { data: journal } = useJournal(campaignId)
  const [params] = useSearchParams()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<NpcFilter>('all')
  const [dialog, setDialog] = useState<Dialog>(null)

  const all = useMemo(() => npcs ?? [], [npcs])
  const groups = useMemo(() => groupByLetter(filterNpcs(all, query, filter)), [all, query, filter])
  const shown = groups.reduce((n, g) => n + g.npcs.length, 0)
  const entries = useMemo(() => journal?.entries ?? [], [journal?.entries])
  const entryCount = useMemo(() => {
    const map = new Map<string, number>()
    for (const e of entries) for (const id of e.npcIds) map.set(id, (map.get(id) ?? 0) + 1)
    return map
  }, [entries])
  const selected = all.find((n) => n.id === params.get('npc')) ?? null
  const selectedId = selected?.id
  // Na telefonu detail nahradí seznam, takže se začíná nahoře; na počítači je seznam vedle a nic se neposouvá.
  useEffect(() => {
    if (selectedId && window.matchMedia('(max-width: 1023px)').matches) window.scrollTo({ top: 0 })
  }, [selectedId])

  if (isPending) return <FullPageSpinner />
  if (!campaign) return <Navigate to="/" replace />
  const isDm = campaign.role === 'dm'

  return (
    <>
      <JournalHeader
        campaignId={campaignId}
        active="npcs"
        npcCount={all.length}
        actions={
          <>
            <Button variant="outline" onClick={() => setDialog('campaign')}>
              <UsersIcon aria-hidden /> Z kampaně
            </Button>
            <Button onClick={() => setDialog('new')}>
              <PlusIcon aria-hidden /> Přidat NPC
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] lg:items-start">
        <div className={cn('space-y-3', selected && 'max-lg:hidden')}>
          <div className="relative">
            <SearchIcon aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input type="search" aria-label="Hledat NPC" placeholder="Hledat podle jména, rasy, popisu…" className="pl-9" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <div role="group" aria-label="Druh" className="flex flex-wrap gap-2">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                aria-pressed={filter === f.id}
                onClick={() => setFilter(f.id)}
                className={cn('inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-medium', filter === f.id ? 'border-primary bg-primary text-primary-foreground' : 'bg-card hover:bg-muted')}
              >
                {f.label}
              </button>
            ))}
          </div>

          {npcsPending && <p className="text-muted-foreground">Načítám NPC…</p>}
          {!npcsPending && all.length === 0 && (
            <p className="rounded-xl border border-dashed p-6 text-center text-muted-foreground">
              Přehled NPC je prázdný. Přidej první NPC (stačí jméno, rasa a popis) nebo sem přidej postavy a NPC z kampaně. K NPC pak jdou přiřadit zápisy z deníku.
            </p>
          )}
          {all.length > 0 && shown === 0 && <p className="text-muted-foreground">Nic nenalezeno.</p>}

          {groups.map((g) => (
            <section key={g.letter} aria-label={`NPC na ${g.letter}`} className="space-y-1.5">
              <h2 className="sticky top-14 z-[1] -mx-1 bg-background/95 px-1 py-1 text-sm font-semibold uppercase tracking-wide text-muted-foreground backdrop-blur">{g.letter}</h2>
              <ul className="space-y-1.5">
                {g.npcs.map((n) => (
                  <li key={n.id}>
                    <Link
                      to={`?npc=${n.id}`}
                      aria-current={selected?.id === n.id ? 'true' : undefined}
                      className={cn(
                        'flex min-h-14 items-center gap-3 rounded-xl border bg-card px-3 py-2 transition-colors hover:border-primary/50',
                        selected?.id === n.id && 'border-primary ring-2 ring-primary/20',
                      )}
                    >
                      <Avatar id={n.characterId ?? n.id} name={n.name} version={n.photoVersion} className="size-10 text-base" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold">{n.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {[n.race, n.characterKind === 'pc' ? 'postava hráče' : null].filter(Boolean).join(' · ') || 'bez rasy'}
                        </span>
                      </span>
                      {n.visibility === 'dm' && <EyeOffIcon aria-label="Vidí jen DM" className="size-4 shrink-0 text-muted-foreground" />}
                      {(entryCount.get(n.id) ?? 0) > 0 && <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs font-medium">{entryCount.get(n.id)}</span>}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        <div className={cn(!selected && 'max-lg:hidden')}>
          {selected ? (
            <NpcDetail key={selected.id} campaignId={campaignId} npc={selected} entries={entries} isDm={isDm} onEdit={() => setDialog({ edit: selected })} />
          ) : (
            <p className="rounded-xl border border-dashed p-8 text-center text-muted-foreground">Vyber NPC ze seznamu, uvidíš jeho popis a příběh.</p>
          )}
        </div>
      </div>

      <Modal open={dialog === 'new' || (typeof dialog === 'object' && dialog !== null)} onClose={() => setDialog(null)} title={dialog === 'new' ? 'Nové NPC' : 'Upravit NPC'}>
        {dialog !== null && dialog !== 'campaign' && (
          <NpcForm key={dialog === 'new' ? 'new' : dialog.edit.id} campaignId={campaignId} npc={dialog === 'new' ? null : dialog.edit} isDm={isDm} onDone={() => setDialog(null)} />
        )}
      </Modal>
      <Modal open={dialog === 'campaign'} onClose={() => setDialog(null)} title="Přidat postavy a NPC z kampaně">
        {dialog === 'campaign' && <CampaignCharactersForm campaignId={campaignId} npcs={all} onDone={() => setDialog(null)} />}
      </Modal>
    </>
  )
}

function NpcDetail({ campaignId, npc, entries, isDm, onEdit }: { campaignId: string; npc: JournalNpc; entries: JournalEntry[]; isDm: boolean; onEdit: () => void }) {
  const remove = useDeleteNpc(campaignId)
  const [, setParams] = useSearchParams()
  const updateEntry = useUpdateEntry(campaignId)
  const [openIds, setOpenIds] = useState<Set<string>>(new Set())
  const [writing, setWriting] = useState(false)
  const [assigning, setAssigning] = useState(false)
  const linked = entries.filter((e) => e.npcIds.includes(npc.id))
  const topics = [...new Set([...DEFAULT_TOPICS, ...entries.map((e) => e.topic)])]
  const kind = npc.characterKind === 'pc' ? 'Postava hráče' : npc.characterKind === 'npc' ? 'NPC z kampaně' : null

  const toggle = (id: string) =>
    setOpenIds((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <article aria-label={`NPC ${npc.name}`} className="space-y-5 rounded-2xl border bg-card p-4 shadow-xs tab:p-5">
      <Link to={`/campaigns/${campaignId}/journal/npcs`} className="inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground hover:text-foreground lg:hidden">
        <ArrowLeftIcon aria-hidden className="size-4" /> Zpět na seznam NPC
      </Link>
      <header className="flex flex-wrap items-center gap-4">
        <Avatar id={npc.characterId ?? npc.id} name={npc.name} version={npc.photoVersion} className="size-16 text-2xl" />
        <div className="min-w-0 flex-1 basis-44">
          <h2 className="break-words font-display text-2xl font-semibold">{npc.name}</h2>
          <p className="text-muted-foreground">{npc.race || 'Rasa nezadána'}</p>
          <div className="mt-1 flex flex-wrap gap-2 text-xs">
            {kind && <span className="rounded-full border border-primary px-2 py-0.5 font-medium text-primary">{kind}</span>}
            {npc.visibility === 'dm' && (
              <span className="inline-flex items-center gap-1 rounded-full border border-amber-500 bg-amber-500/10 px-2 py-0.5 font-medium">
                <EyeOffIcon aria-hidden className="size-3" /> Vidí jen DM
              </span>
            )}
            <span className="py-0.5 text-muted-foreground">
              Přidal(a) {npc.mine ? 'ty' : npc.createdByName} · {dateFormat(npc.createdAt)}
            </span>
          </div>
        </div>
      </header>

      {npc.description ? <RichText text={npc.description} className="break-words" /> : <p className="text-sm text-muted-foreground">Popis zatím chybí.</p>}

      <div className="flex flex-wrap gap-2">
        {npc.characterId && (
          <Link to={`/characters/${npc.characterId}`} className={buttonVariants({ variant: 'outline' })}>
            Karta postavy
          </Link>
        )}
        {npc.canEdit && (
          <>
            <Button variant="outline" onClick={onEdit}>
              <PencilIcon aria-hidden /> Upravit
            </Button>
            <Button
              variant="ghost"
              aria-label={`Smazat NPC ${npc.name}`}
              onClick={() => {
                if (window.confirm(`Smazat NPC „${npc.name}“ z přehledu? Zápisy v deníku zůstanou.`)) {
                  remove.mutate(npc.id, { onSuccess: () => setParams({}, { replace: true }), onError: () => toast.error('NPC se nepodařilo smazat') })
                }
              }}
            >
              <Trash2Icon aria-hidden /> Smazat
            </Button>
          </>
        )}
      </div>

      <section aria-label="Na mapě" className="space-y-2 border-t pt-4">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Na mapě ({npc.places.length})</h3>
        {npc.places.length === 0 ? (
          <p className="text-sm text-muted-foreground">Zatím není na žádném bodu mapy. Přidáš ho u bodu na mapě (Upravit → Kdo se tu nachází).</p>
        ) : (
          <ul className="grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-2">
            {npc.places.map((p) => (
              <li key={p.pinId}>
                <Link to={`/campaigns/${campaignId}/maps/${p.mapId}?pin=${p.pinId}`} className="flex min-h-12 items-center gap-2 rounded-lg border bg-background px-3 py-1.5 hover:border-primary/50">
                  <span aria-hidden>{emojiOf(p.icon)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{p.title}</span>
                    <span className="block truncate text-xs text-muted-foreground">{p.mapName}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Příběh a zápisy" className="space-y-3 border-t pt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Příběh a zápisy ({linked.length})</h3>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setAssigning(true)}>
              <LinkIcon aria-hidden /> Přiřadit zápis
            </Button>
            <Button onClick={() => setWriting(true)}>
              <PlusIcon aria-hidden /> Napsat zápis
            </Button>
          </div>
        </div>
        {linked.length === 0 && <p className="text-sm text-muted-foreground">K NPC zatím nejsou žádné zápisy. Napiš nový, nebo přiřaď existující z deníku.</p>}
        <ul className="space-y-2">
          {linked.map((e) => {
            const open = openIds.has(e.id)
            return (
              <li key={e.id} className="rounded-xl border bg-background">
                <button type="button" aria-expanded={open} onClick={() => toggle(e.id)} className="flex min-h-14 w-full items-center gap-3 rounded-xl px-4 py-2 text-left">
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">{e.title}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {e.topic} · {e.mine ? 'ty' : e.createdByName} · {dateFormat(e.updatedAt)}
                    </span>
                  </span>
                  <ChevronDownIcon aria-hidden className={cn('size-5 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} />
                </button>
                {open && (
                  <div className="space-y-3 border-t px-4 py-3">
                    {e.body ? <RichText text={e.body} className="break-words" /> : <p className="text-sm text-muted-foreground">Zápis nemá žádný text.</p>}
                    <div className="flex flex-wrap gap-2">
                      <Link to={`/campaigns/${campaignId}/journal?entry=${e.id}`} className={buttonVariants({ variant: 'outline' })}>
                        Otevřít v deníku
                      </Link>
                      {e.canEdit && (
                        <Button
                          variant="ghost"
                          disabled={updateEntry.isPending}
                          aria-label={`Odebrat zápis ${e.title} od NPC ${npc.name}`}
                          onClick={() =>
                            updateEntry.mutate(
                              { id: e.id, npcIds: e.npcIds.filter((id) => id !== npc.id) },
                              { onError: (err) => toast.error(err instanceof ApiError ? err.message : 'Zápis se nepodařilo upravit.') },
                            )
                          }
                        >
                          <UnlinkIcon aria-hidden /> Odebrat od NPC
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      </section>

      <Modal open={writing} onClose={() => setWriting(false)} title={`Nový zápis o ${npc.name}`}>
        {writing && <EntryForm campaignId={campaignId} entry={null} isDm={isDm} topics={topics} defaultNpcIds={[npc.id]} defaultTopic="Postavy" onDone={() => setWriting(false)} />}
      </Modal>
      <Modal open={assigning} onClose={() => setAssigning(false)} title={`Přiřadit zápis k ${npc.name}`}>
        {assigning && <AssignEntryForm campaignId={campaignId} npc={npc} entries={entries} onDone={() => setAssigning(false)} />}
      </Modal>
    </article>
  )
}

/** Přiřazení existujících zápisů k NPC: jde jen o zápisy, které smí uživatel upravit (vlastní, DM všechny). */
function AssignEntryForm({ campaignId, npc, entries, onDone }: { campaignId: string; npc: JournalNpc; entries: JournalEntry[]; onDone: () => void }) {
  const update = useUpdateEntry(campaignId)
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const candidates = entries.filter((e) => e.canEdit && !e.npcIds.includes(npc.id))
  const q = query.trim().toLowerCase()
  const visible = candidates.filter((e) => q === '' || `${e.title} ${e.topic}`.toLowerCase().includes(q))
  const [saving, setSaving] = useState(false)

  async function submit(ev: FormEvent) {
    ev.preventDefault()
    setSaving(true)
    try {
      for (const e of candidates.filter((c) => picked.has(c.id))) await update.mutateAsync({ id: e.id, npcIds: [...e.npcIds, npc.id] })
      onDone()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Zápisy se nepodařilo přiřadit.')
    } finally {
      setSaving(false)
    }
  }

  if (candidates.length === 0) {
    return <p className="text-muted-foreground">Není co přiřadit: všechny zápisy, které můžeš upravit, už k NPC patří. Napiš nový zápis.</p>
  }
  return (
    <form onSubmit={submit} className="space-y-4">
      <Input type="search" aria-label="Hledat zápis" placeholder="Hledat zápis…" value={query} onChange={(e) => setQuery(e.target.value)} />
      <fieldset className="space-y-2">
        <legend className="sr-only">Zápisy k přiřazení</legend>
        {visible.length === 0 && <p className="text-sm text-muted-foreground">Nic nenalezeno.</p>}
        {visible.map((e) => (
          <label key={e.id} className="flex min-h-11 items-center gap-3 rounded-lg border px-3 py-2">
            <input
              type="checkbox"
              className="size-5 shrink-0"
              checked={picked.has(e.id)}
              onChange={(ev) =>
                setPicked((s) => {
                  const next = new Set(s)
                  if (ev.target.checked) next.add(e.id)
                  else next.delete(e.id)
                  return next
                })
              }
            />
            <span className="min-w-0">
              <span className="block break-words font-medium">{e.title}</span>
              <span className="block text-xs text-muted-foreground">{e.topic}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <Button type="submit" size="lg" className="w-full" disabled={picked.size === 0 || saving}>
        Přiřadit vybrané ({picked.size})
      </Button>
    </form>
  )
}

function NpcForm({ campaignId, npc, isDm, onDone }: { campaignId: string; npc: JournalNpc | null; isDm: boolean; onDone: () => void }) {
  const create = useCreateNpc(campaignId)
  const update = useUpdateNpc(campaignId)
  const [, setParams] = useSearchParams()
  const [name, setName] = useState(npc?.name ?? '')
  const [race, setRace] = useState(npc?.race ?? '')
  const [description, setDescription] = useState(npc?.description ?? '')
  const [visibility, setVisibility] = useState<JournalNpc['visibility']>(npc?.visibility ?? 'all')
  const fromCharacter = npc?.characterId != null
  const valid = name.trim() !== ''
  const pending = create.isPending || update.isPending

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!valid) return
    const onError = (err: Error) => toast.error(err instanceof ApiError ? err.message : 'NPC se nepodařilo uložit.')
    const common = { description, ...(isDm ? { visibility } : {}) }
    if (npc) update.mutate({ id: npc.id, ...common, ...(fromCharacter ? {} : { name: name.trim(), race: race.trim() }) }, { onSuccess: onDone, onError })
    else
      create.mutate(
        { name: name.trim(), race: race.trim(), ...common },
        {
          onSuccess: (created) => {
            setParams({ npc: created.id })
            onDone()
          },
          onError,
        },
      )
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="npc-name">Jméno</Label>
        <Input id="npc-name" required maxLength={100} autoFocus={!fromCharacter} disabled={fromCharacter} value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="npc-race">Rasa</Label>
        <Input id="npc-race" maxLength={100} disabled={fromCharacter} value={race} onChange={(e) => setRace(e.target.value)} />
        {fromCharacter && <p className="text-xs text-muted-foreground">Jméno a rasu přebírá postava z kampaně, změníš je na její kartě.</p>}
      </div>
      <div className="space-y-2">
        <Label htmlFor="npc-description">Popis</Label>
        <Textarea id="npc-description" rows={6} maxLength={5000} autoFocus={fromCharacter} value={description} onChange={(e) => setDescription(e.target.value)} />
        <p className="text-xs text-muted-foreground">Vzhled, povaha, čím se živí. Příběh NPC piš jako zápisy v deníku a přiřaď je k němu. Formátování: **tučně**, *kurzíva*.</p>
      </div>
      {isDm && (
        <div className="space-y-2">
          <Label htmlFor="npc-visibility">Kdo NPC uvidí</Label>
          <NativeSelect id="npc-visibility" value={visibility} onChange={(e) => setVisibility(e.target.value as JournalNpc['visibility'])}>
            <option value="all">Všichni v kampani</option>
            <option value="dm">Zatím jen já (DM)</option>
          </NativeSelect>
        </div>
      )}
      <Button type="submit" size="lg" className="w-full" disabled={!valid || pending}>
        {npc ? 'Uložit' : 'Přidat do přehledu'}
      </Button>
    </form>
  )
}

/** Postavy hráčů a NPC postavy z kampaně, které ještě v přehledu nejsou. */
function CampaignCharactersForm({ campaignId, npcs, onDone }: { campaignId: string; npcs: JournalNpc[]; onDone: () => void }) {
  const { data: characters, isPending } = useCharacters(campaignId)
  const add = useAddCharacterNpcs(campaignId)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const present = new Set(npcs.map((n) => n.characterId).filter(Boolean))
  const available = (characters ?? []).filter((c) => !present.has(c.id)).sort((a, b) => a.name.localeCompare(b.name, 'cs'))

  if (isPending) return <p className="text-muted-foreground">Načítám postavy…</p>
  if (available.length === 0) return <p className="text-muted-foreground">Všechny postavy a NPC z kampaně už v přehledu jsou.</p>

  const toggle = (id: string, on: boolean) =>
    setPicked((s) => {
      const next = new Set(s)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        add.mutate([...picked], {
          onSuccess: onDone,
          onError: (err) => toast.error(err instanceof ApiError ? err.message : 'Postavy se nepodařilo přidat.'),
        })
      }}
      className="space-y-4"
    >
      <p className="text-sm text-muted-foreground">Jméno a rasu přebírá postava. Popis a příběh doplníš u každé zvlášť.</p>
      <fieldset className="space-y-2">
        <legend className="sr-only">Postavy z kampaně</legend>
        {available.map((c) => (
          <label key={c.id} className="flex min-h-14 items-center gap-3 rounded-lg border px-3 py-2">
            <input type="checkbox" className="size-5 shrink-0" checked={picked.has(c.id)} onChange={(e) => toggle(c.id, e.target.checked)} />
            <Avatar id={c.id} name={c.name} version={c.photoVersion} className="size-10 text-base" />
            <span className="min-w-0">
              <span className="block truncate font-medium">{c.name}</span>
              <span className="block truncate text-xs text-muted-foreground">{[c.kind === 'npc' ? 'NPC kampaně' : 'Postava hráče', c.race].filter(Boolean).join(' · ')}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={() => setPicked(new Set(available.map((c) => c.id)))}>
          Vybrat vše
        </Button>
        <Button type="submit" className="flex-1" disabled={picked.size === 0 || add.isPending}>
          Přidat vybrané ({picked.size})
        </Button>
      </div>
    </form>
  )
}
