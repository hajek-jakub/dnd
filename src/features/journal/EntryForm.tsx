import { useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { useCampaignMembers } from '@/features/campaigns/api'
import { ApiError } from '@/lib/api'
import { useCreateEntry, useUpdateEntry, type JournalEntry } from './api'
import { NpcPicker } from './NpcPicker'

/**
 * Zápis do společného deníku. Každý člen kampaně píše pro celou družinu; DM navíc vybírá, kdo zápis uvidí, a připíná.
 * Starý soukromý zápisek hráče (z doby, kdy měl každý svůj) jde nechat soukromý, nebo sdílet s družinou.
 */
export function EntryForm({
  campaignId,
  entry,
  isDm,
  topics,
  defaultNpcIds = [],
  defaultTopic,
  onDone,
}: {
  campaignId: string
  entry: JournalEntry | null
  isDm: boolean
  topics: string[]
  /** NPC, která se předvyberou u nového zápisu (zápis založený z detailu NPC) */
  defaultNpcIds?: string[]
  defaultTopic?: string
  onDone: () => void
}) {
  const { data: members } = useCampaignMembers(campaignId)
  const create = useCreateEntry(campaignId)
  const update = useUpdateEntry(campaignId)
  const [topic, setTopic] = useState(entry?.topic ?? defaultTopic ?? 'Příběh')
  const [title, setTitle] = useState(entry?.title ?? '')
  const [body, setBody] = useState(entry?.body ?? '')
  const [visibility, setVisibility] = useState<JournalEntry['visibility']>(entry?.visibility ?? 'all')
  const [viewers, setViewers] = useState<Set<string>>(new Set(entry?.viewerIds ?? []))
  const [pinned, setPinned] = useState(entry?.pinned ?? false)
  const [npcIds, setNpcIds] = useState<string[]>(entry?.npcIds ?? defaultNpcIds)
  const legacyPrivate = !isDm && entry?.visibility === 'owner'
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
      npcIds,
      ...(isDm ? { visibility, pinned, ...(visibility === 'selected' ? { viewerIds: [...viewers] } : {}) } : legacyPrivate ? { visibility } : {}),
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
      <NpcPicker campaignId={campaignId} value={npcIds} onChange={setNpcIds} />
      {isDm ? (
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
      ) : legacyPrivate ? (
        <div className="space-y-2">
          <Label htmlFor="journal-visibility">Kdo zápis uvidí</Label>
          <NativeSelect id="journal-visibility" value={visibility} onChange={(e) => setVisibility(e.target.value as JournalEntry['visibility'])}>
            <option value="owner">Jen já (starý soukromý zápisek)</option>
            <option value="all">Celá družina (zpátky už půjde jen smazat)</option>
          </NativeSelect>
        </div>
      ) : (
        <p className="rounded-lg border bg-muted/50 p-3 text-sm">Deník je společný: zápis uvidí celá družina včetně DM.</p>
      )}
      <Button type="submit" size="lg" className="w-full" disabled={!valid || pending}>
        {entry ? 'Uložit' : 'Přidat do deníku'}
      </Button>
    </form>
  )
}
