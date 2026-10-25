import { useMemo, useState } from 'react'
import { PlusIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useCharacters } from '@/features/sheet/api'
import { ApiError } from '@/lib/api'
import { SearchPicker, type PickerOption } from '@/components/SearchPicker'
import { useAddCharacterNpcs, useCreateNpc, useJournalNpcs, type JournalNpc } from './npc-api'
import { sortNpcs } from './npc-list'

/**
 * Výběr NPC a postav, o kterých zápis je: vybrané jsou štítky, přidat jde NPC z přehledu, postavu nebo NPC postavu z kampaně
 * (ta se zároveň přidá do přehledu) a rovnou i úplně nové NPC (jméno a rasa).
 */
export function NpcPicker({
  campaignId,
  value,
  onChange,
  id = 'journal-npc',
  label = 'NPC a postavy v zápisu',
  removeSuffix = 'ze zápisu',
}: {
  campaignId: string
  value: string[]
  onChange: (ids: string[]) => void
  id?: string
  label?: string
  removeSuffix?: string
}) {
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
  const toOption = (n: JournalNpc): PickerOption => ({ id: n.id, label: n.name, hint: [n.race, n.characterKind === 'pc' ? 'postava hráče' : null].filter(Boolean).join(', ') || undefined })
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
      <SearchPicker
        label={label}
        selectedLabel="Vybraná NPC"
        selected={selected.map(toOption)}
        options={[
          ...available.map(toOption),
          ...fromCampaign.map((c) => ({ id: `char:${c.id}`, label: c.name, hint: c.kind === 'npc' ? 'NPC z kampaně' : 'postava z kampaně' })),
        ]}
        onAdd={pick}
        onRemove={(npcId) => onChange(value.filter((v) => v !== npcId))}
        removeLabel={(o) => `Odebrat ${o.label} ${removeSuffix}`}
        placeholder="Hledat NPC nebo postavu…"
        empty="V přehledu zatím nejsou žádná NPC. Přidej nové."
        disabled={addCharacters.isPending}
      />
      {creating ? (
        <div className="space-y-3 rounded-xl border p-3">
          <div className="space-y-2">
            <Label htmlFor={`${id}-new-name`}>Jméno nového NPC</Label>
            <Input id={`${id}-new-name`} maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${id}-new-race`}>Rasa</Label>
            <Input id={`${id}-new-race`} maxLength={100} value={race} onChange={(e) => setRace(e.target.value)} />
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
