import { useMemo, useState } from 'react'
import { PlusIcon, XIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { useCharacters } from '@/features/sheet/api'
import { ApiError } from '@/lib/api'
import { useAddCharacterNpcs, useCreateNpc, useJournalNpcs } from './npc-api'
import { sortNpcs } from './npc-list'

/**
 * Výběr NPC a postav, o kterých zápis je: vybrané jsou štítky, přidat jde NPC z přehledu, postavu nebo NPC postavu z kampaně
 * (ta se zároveň přidá do přehledu) a rovnou i úplně nové NPC (jméno a rasa).
 */
export function NpcPicker({ campaignId, value, onChange }: { campaignId: string; value: string[]; onChange: (ids: string[]) => void }) {
  const { data: npcs = [] } = useJournalNpcs(campaignId)
  const { data: characters = [] } = useCharacters(campaignId, { pollMs: 60_000 })
  const addCharacters = useAddCharacterNpcs(campaignId)
  const createNpc = useCreateNpc(campaignId)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [race, setRace] = useState('')
  const sorted = useMemo(() => sortNpcs(npcs), [npcs])
  const selected = sorted.filter((n) => value.includes(n.id))
  const available = sorted.filter((n) => !value.includes(n.id))
  const inDirectory = new Set(npcs.map((n) => n.characterId).filter(Boolean))
  const fromCampaign = characters.filter((c) => !inDirectory.has(c.id)).sort((a, b) => a.name.localeCompare(b.name, 'cs'))
  const onError = (err: Error) => toast.error(err instanceof ApiError ? err.message : 'NPC se nepodařilo přidat.')

  function pick(raw: string) {
    if (raw === '') return
    if (raw.startsWith('char:')) {
      addCharacters.mutate([raw.slice(5)], { onSuccess: ([npc]) => npc && onChange([...value, npc.id]), onError })
    } else {
      onChange([...value, raw])
    }
  }

  function create() {
    if (name.trim() === '') return
    createNpc.mutate(
      { name: name.trim(), race: race.trim() },
      {
        onSuccess: (npc) => {
          onChange([...value, npc.id])
          setName('')
          setRace('')
          setCreating(false)
        },
        onError,
      },
    )
  }

  return (
    <div className="space-y-2">
      <Label htmlFor="journal-npc-add">NPC a postavy v zápisu</Label>
      {selected.length > 0 && (
        <ul aria-label="Vybraná NPC" className="flex flex-wrap gap-2">
          {selected.map((n) => (
            <li key={n.id} className="inline-flex min-h-11 items-center gap-1 rounded-full border bg-muted pl-3 text-sm font-medium">
              {n.name}
              <button type="button" aria-label={`Odebrat ${n.name} ze zápisu`} onClick={() => onChange(value.filter((id) => id !== n.id))} className="flex size-11 items-center justify-center rounded-full hover:bg-background">
                <XIcon aria-hidden className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <NativeSelect id="journal-npc-add" value="" onChange={(e) => pick(e.target.value)} disabled={addCharacters.isPending}>
        <option value="">Přidat NPC nebo postavu…</option>
        {available.length > 0 && (
          <optgroup label="Z přehledu NPC">
            {available.map((n) => (
              <option key={n.id} value={n.id}>
                {n.name}
                {n.race ? ` (${n.race})` : ''}
              </option>
            ))}
          </optgroup>
        )}
        {fromCampaign.length > 0 && (
          <optgroup label="Postavy z kampaně (přidají se do přehledu)">
            {fromCampaign.map((c) => (
              <option key={c.id} value={`char:${c.id}`}>
                {c.name}
                {c.kind === 'npc' ? ' (NPC)' : ''}
              </option>
            ))}
          </optgroup>
        )}
      </NativeSelect>
      {creating ? (
        <div className="space-y-3 rounded-xl border p-3">
          <div className="space-y-2">
            <Label htmlFor="journal-npc-new-name">Jméno nového NPC</Label>
            <Input id="journal-npc-new-name" maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="journal-npc-new-race">Rasa</Label>
            <Input id="journal-npc-new-race" maxLength={100} value={race} onChange={(e) => setRace(e.target.value)} />
          </div>
          <div className="flex gap-2">
            <Button type="button" onClick={create} disabled={name.trim() === '' || createNpc.isPending}>
              Přidat NPC
            </Button>
            <Button type="button" variant="ghost" onClick={() => setCreating(false)}>
              Zrušit
            </Button>
          </div>
        </div>
      ) : (
        <Button type="button" variant="outline" onClick={() => setCreating(true)}>
          <PlusIcon aria-hidden /> Nové NPC
        </Button>
      )}
    </div>
  )
}
