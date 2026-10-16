import { useMemo, useState, type DragEvent } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { ArrowLeftIcon, CoinsIcon, FolderInputIcon, FolderPlusIcon, PackagePlusIcon, PencilIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { FullPageSpinner } from '@/components/FullPageSpinner'
import { SectionHeader } from '@/components/SectionHeader'
import { useCampaign } from '@/features/campaigns/api'
import { useCharacters } from '@/features/sheet/api'
import { ApiError } from '@/lib/api'
import { usePageTitle } from '@/lib/page-title'
import { useCreateEntry, useDeleteEntry, useDeleteFolder, useGiveLoot, useLoot, useUpdateEntry, type LootEntry } from './api'
import { assign, toRequest, unassign, type Assignments } from './distribution'
import { FolderTree } from './FolderTree'
import { LootDialogs, type LootDialog } from './LootDialogs'
import { LootEntryRow } from './LootEntryRow'
import { entryLabel, folderPath } from './labels'
import { PARTY, PartyBar, type PartyMember } from './PartyBar'

const errorText = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback)

/**
 * Loot a dílna itemů DM: složky (dungeon → místnosti) s připravenými itemy a zlatem. Hráči o nich nevědí, dokud jim je DM nerozdá:
 * přetažením na ikonu postavy nebo zaškrtnutím a klepnutím na ikonu se položky připraví k rozdání, tlačítko Rozdat je pošle najednou.
 */
export function LootPage() {
  const { campaignId = '' } = useParams<{ campaignId: string }>()
  const { data: campaign, isPending } = useCampaign(campaignId)
  usePageTitle('Loot a itemy', campaign?.name)
  const isDm = campaign?.role === 'dm'
  const loot = useLoot(campaignId, isDm)
  const { data: characters } = useCharacters(isDm ? campaignId : undefined, { pollMs: 30_000 })
  const [folderId, setFolderId] = useState<string | null>(null)
  const [ticked, setTicked] = useState<Set<string>>(new Set())
  const [assignments, setAssignments] = useState<Assignments>({})
  const [dragIds, setDragIds] = useState<string[] | null>(null)
  const [hideGiven, setHideGiven] = useState(false)
  const [dialog, setDialog] = useState<LootDialog | null>(null)
  const give = useGiveLoot(campaignId)
  const updateEntry = useUpdateEntry(campaignId)
  const createEntry = useCreateEntry(campaignId)
  const deleteEntry = useDeleteEntry(campaignId)
  const deleteFolder = useDeleteFolder(campaignId)

  const folders = useMemo(() => loot.data?.folders ?? [], [loot.data])
  const entries = useMemo(() => loot.data?.entries ?? [], [loot.data])
  const members: PartyMember[] = useMemo(
    () =>
      (characters ?? [])
        .map((c) => ({ id: c.id, name: c.name, photoVersion: c.photoVersion, npc: c.kind === 'npc' }))
        .sort((a, b) => Number(a.npc) - Number(b.npc)), // NPC až za postavami hráčů
    [characters],
  )

  if (isPending) return <FullPageSpinner />
  if (!campaign) return <Navigate to="/" replace />
  // Loot je jen pro DM; hráč se vrátí na kampaň (API mu stejně vrací 403).
  if (!isDm) return <Navigate to={`/campaigns/${campaignId}`} replace />

  // Otevřená složka mohla zmizet (smazaná v jiném okně): pak se ukážou nezařazené.
  const current = folderId !== null && folders.some((f) => f.id === folderId) ? folderId : null
  const currentFolder = folders.find((f) => f.id === current)
  const subfolders = folders.filter((f) => f.parentId === current)
  const shown = entries.filter((e) => e.folderId === current && (!hideGiven || e.givenTo === ''))
  const names = new Map(members.map((m) => [m.id, m.name]))

  function openFolder(id: string | null) {
    setFolderId(id)
    setTicked(new Set()) // zaškrtnuté v jiné složce by nebylo vidět
  }

  function assignTo(target: string) {
    const ids = dragIds ?? [...ticked]
    if (ids.length === 0) {
      toast.info('Nejdřív zaškrtni položky (nebo je přetáhni na postavu).')
      return
    }
    if (target === PARTY) {
      const gold = ids.filter((id) => entries.find((e) => e.id === id)?.kind === 'gold')
      if (gold.length < ids.length) toast.error('Celá družina je jen pro zlato (rozdělí se rovným dílem). Item přiřaď konkrétní postavě.')
      if (gold.length === 0) return
      setAssignments((a) => assign(a, gold, members.filter((m) => !m.npc).map((m) => m.id)))
    } else {
      setAssignments((a) => assign(a, ids, [target]))
    }
    setTicked(new Set())
    setDragIds(null)
  }

  function giveAll() {
    const request = toRequest(assignments, entries)
    if (request.length === 0) return
    give.mutate(request, {
      onSuccess: (res) => {
        toast.success(`Rozdáno: ${res.given.map((g) => `${g.label} → ${g.to.join(', ')}`).join('; ')}`)
        setAssignments({})
      },
      onError: (e) => toast.error(errorText(e, 'Rozdání se nepodařilo, nic se nerozdalo.')),
    })
  }

  function startDrag(entry: LootEntry, e: DragEvent) {
    const ids = ticked.has(entry.id) ? [...ticked] : [entry.id]
    setDragIds(ids)
    e.dataTransfer.setData('text/plain', ids.join(',')) // bez dat Firefox tah nezačne
    e.dataTransfer.effectAllowed = 'copyMove'
  }

  function moveEntries(ids: string[], target: string | null) {
    const moving = ids.filter((id) => entries.find((e) => e.id === id)?.folderId !== target)
    for (const id of moving) updateEntry.mutate({ id, folderId: target }, { onError: (err) => toast.error(errorText(err, 'Položku se nepodařilo přesunout.')) })
    if (moving.length > 0) toast.success(`Přesunuto do: ${folderPath(folders, target)}`)
    setDragIds(null)
    setTicked(new Set())
  }

  function duplicate(entry: LootEntry) {
    const done = { onSuccess: () => toast.success(`Zkopírováno: ${entryLabel(entry)}`), onError: (e: unknown) => toast.error(errorText(e, 'Kopie se nepodařila.')) }
    if (entry.kind === 'item') createEntry.mutate({ folderId: entry.folderId, kind: 'item', item: entry.data }, done)
    else createEntry.mutate({ folderId: entry.folderId, kind: 'gold', name: entry.data.name, currency: entry.data.currency }, done)
  }

  function removeEntry(entry: LootEntry) {
    if (!window.confirm(`Smazat „${entryLabel(entry)}“ z lootu?`)) return
    deleteEntry.mutate(entry.id, { onError: (e) => toast.error(errorText(e, 'Položku se nepodařilo smazat.')) })
    setAssignments((a) => unassign(a, entry.id))
  }

  function removeFolder() {
    if (!currentFolder || !window.confirm(`Smazat složku „${currentFolder.name}“ i se vším, co je v ní (podsložky, itemy, zlato)?`)) return
    deleteFolder.mutate(currentFolder.id, { onError: (e) => toast.error(errorText(e, 'Složku se nepodařilo smazat.')) })
    openFolder(currentFolder.parentId)
  }

  return (
    <>
      <div className="space-y-2">
        <Link to={`/campaigns/${campaignId}/dm`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeftIcon aria-hidden className="size-4" /> Panel DM
        </Link>
        <SectionHeader
          level={1}
          title="Loot a itemy"
          actions={
            <Button variant="secondary" onClick={() => setDialog({ type: 'folder', parentId: null })}>
              <FolderPlusIcon aria-hidden /> Nová složka
            </Button>
          }
        />
        <p className="text-sm text-muted-foreground">
          Dílna DM: itemy a zlato si připrav dopředu do složek (třeba dungeon a v něm místnosti) a rozdej je, až je družina najde. Hráči nic z toho nevidí, dokud jim to nedáš.
        </p>
      </div>

      <PartyBar
        members={members}
        entries={entries}
        assignments={assignments}
        tickedCount={ticked.size}
        dragging={dragIds !== null}
        pending={give.isPending}
        onAssign={assignTo}
        onUnassign={(entryId, characterId) => setAssignments((a) => unassign(a, entryId, characterId))}
        onClear={() => setAssignments({})}
        onGive={giveAll}
      />

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]" data-testid="loot-layout">
        <Card>
          <CardHeader>
            <CardTitle>Složky</CardTitle>
          </CardHeader>
          <CardContent>
            {loot.isPending ? (
              <p role="status" className="text-sm text-muted-foreground">
                Načítám…
              </p>
            ) : (
              <FolderTree folders={folders} entries={entries} selected={current} dragging={dragIds !== null} onSelect={openFolder} onDropEntries={(target) => dragIds && moveEntries(dragIds, target)} />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
            <CardTitle className="min-w-0 break-words">{folderPath(folders, current)}</CardTitle>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => setDialog({ type: 'item' })}>
                <PackagePlusIcon aria-hidden /> Nový item
              </Button>
              <Button variant="secondary" onClick={() => setDialog({ type: 'gold' })}>
                <CoinsIcon aria-hidden /> Zlato
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => setDialog({ type: 'folder', parentId: current })}>
                <FolderPlusIcon aria-hidden /> {current === null ? 'Nová složka' : 'Podsložka'}
              </Button>
              {currentFolder && (
                <>
                  <Button variant="outline" onClick={() => setDialog({ type: 'folder', folder: currentFolder, parentId: currentFolder.parentId })}>
                    <PencilIcon aria-hidden /> Přejmenovat
                  </Button>
                  <Button variant="outline" onClick={() => setDialog({ type: 'moveFolder', folder: currentFolder })}>
                    <FolderInputIcon aria-hidden /> Přesunout
                  </Button>
                  <Button variant="outline" onClick={removeFolder}>
                    <Trash2Icon aria-hidden /> Smazat složku
                  </Button>
                </>
              )}
            </div>

            {subfolders.length > 0 && (
              <nav aria-label="Podsložky" className="flex flex-wrap gap-2">
                {subfolders.map((f) => (
                  <Button key={f.id} variant="secondary" className="h-auto min-h-11 max-w-full text-left break-words whitespace-normal" onClick={() => openFolder(f.id)}>
                    {f.name}
                  </Button>
                ))}
              </nav>
            )}

            <label className="flex min-h-11 w-fit cursor-pointer items-center gap-3 text-sm">
              <input type="checkbox" className="size-5" checked={hideGiven} onChange={(e) => setHideGiven(e.target.checked)} />
              <span>Skrýt rozdané</span>
            </label>

            <ul className="space-y-2" aria-label="Položky ve složce">
              {shown.map((entry) => (
                <LootEntryRow
                  key={entry.id}
                  entry={entry}
                  folders={folders}
                  ticked={ticked.has(entry.id)}
                  assignedTo={(assignments[entry.id] ?? []).map((id) => names.get(id) ?? 'postava')}
                  onTick={(on) =>
                    setTicked((s) => {
                      const next = new Set(s)
                      if (on) next.add(entry.id)
                      else next.delete(entry.id)
                      return next
                    })
                  }
                  onDragStart={(e) => startDrag(entry, e)}
                  onDragEnd={() => setDragIds(null)}
                  onEdit={() => setDialog(entry.kind === 'item' ? { type: 'item', entry } : { type: 'gold', entry })}
                  onDuplicate={() => duplicate(entry)}
                  onMove={(target) => moveEntries([entry.id], target)}
                  onClearGiven={() => updateEntry.mutate({ id: entry.id, givenTo: '' })}
                  onDelete={() => removeEntry(entry)}
                />
              ))}
            </ul>
            {!loot.isPending && shown.length === 0 && (
              <p className="text-sm text-muted-foreground">
                {entries.some((e) => e.folderId === current) ? 'Všechno odsud už je rozdané.' : 'Tady zatím nic není. Přidej item nebo zlato.'}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <LootDialogs campaignId={campaignId} dialog={dialog} folderId={current} folders={folders} onClose={() => setDialog(null)} />
    </>
  )
}
