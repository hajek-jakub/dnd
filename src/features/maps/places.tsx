import { Link } from 'react-router-dom'
import { SearchPicker } from '@/components/SearchPicker'
import type { NpcPlace } from '@/features/journal/npc-api'
import { useCampaignPins } from './api'
import { emojiOf } from './pin-icons'

/** Výběr bodů na mapách kampaně (kde se NPC nachází, kde se zápis odehrál). */
export function PlacePicker({ campaignId, value, onChange, label }: { campaignId: string; value: string[]; onChange: (ids: string[]) => void; label: string }) {
  const { data: pins = [], isPending } = useCampaignPins(campaignId)
  const toOption = (p: NpcPlace) => ({ id: p.pinId, label: p.title, hint: p.mapName, icon: <span aria-hidden>{emojiOf(p.icon)}</span> })
  return (
    <SearchPicker
      label={label}
      selectedLabel="Vybraná místa"
      selected={pins.filter((p) => value.includes(p.pinId)).map(toOption)}
      options={pins.filter((p) => !value.includes(p.pinId)).map(toOption)}
      onAdd={(id) => onChange([...value, id])}
      onRemove={(id) => onChange(value.filter((v) => v !== id))}
      removeLabel={(o) => `Odebrat místo ${o.label}`}
      placeholder="Hledat bod nebo mapu…"
      empty={isPending ? 'Načítám body…' : 'Na mapách zatím nejsou žádné body.'}
    />
  )
}

/** Odkazy na body na mapách; odkaz bod na mapě rovnou vybere (`?pin=`). */
export function PlaceList({ campaignId, places }: { campaignId: string; places: NpcPlace[] }) {
  return (
    <ul className="grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-2">
      {places.map((p) => (
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
  )
}
