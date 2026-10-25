import { useId, useState, type ReactNode } from 'react'
import { SearchIcon, XIcon } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export interface PickerOption {
  id: string
  label: string
  /** šedý doplněk vedle názvu (rasa, mapa, „z kampaně“) */
  hint?: string
  icon?: ReactNode
}

/** Bez diakritiky a velikosti písmen, ať „hostinsky“ najde „Hostinský“. */
const fold = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

const LIMIT = 8

/**
 * Výběr více položek s hledáním: vybrané jsou štítky, pod polem se po klepnutí nebo psaní ukážou odpovídající položky.
 * Místo dlouhého rozbalovacího seznamu, ve kterém nejde hledat.
 */
export function SearchPicker({
  label,
  selected,
  options,
  onAdd,
  onRemove,
  removeLabel,
  placeholder,
  empty,
  disabled,
  selectedLabel,
}: {
  label: string
  /** název seznamu vybraných štítků (musí se lišit od `label`) */
  selectedLabel?: string
  /** vybrané položky (štítky) */
  selected: PickerOption[]
  /** položky, které jde přidat (bez vybraných) */
  options: PickerOption[]
  onAdd: (id: string) => void
  onRemove: (id: string) => void
  removeLabel: (option: PickerOption) => string
  placeholder: string
  /** text, když není co vybrat ani bez hledání */
  empty: string
  disabled?: boolean
}) {
  const id = useId()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const q = fold(query.trim())
  const matches = options.filter((o) => q === '' || fold(`${o.label} ${o.hint ?? ''}`).includes(q))
  const shown = matches.slice(0, LIMIT)
  // po výběru se seznam zavře, ať se pod ním formulář neposune ve chvíli, kdy se klepe na další tlačítko
  const pick = (optionId: string) => {
    onAdd(optionId)
    setQuery('')
    setOpen(false)
  }

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      {selected.length > 0 && (
        <ul aria-label={selectedLabel ?? `${label}: vybrané`} className="flex flex-wrap gap-2">
          {selected.map((o) => (
            <li key={o.id} className="inline-flex min-h-11 max-w-full items-center gap-1 rounded-full border bg-muted pl-3 text-sm font-medium">
              {o.icon}
              <span className="min-w-0 truncate">
                {o.label}
                {o.hint && <span className="font-normal text-muted-foreground"> · {o.hint}</span>}
              </span>
              <button type="button" aria-label={removeLabel(o)} onClick={() => onRemove(o.id)} className="flex size-11 shrink-0 items-center justify-center rounded-full hover:bg-background">
                <XIcon aria-hidden className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="relative">
        <SearchIcon aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          id={id}
          type="search"
          autoComplete="off"
          placeholder={placeholder}
          className="pl-9"
          value={query}
          disabled={disabled}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setQuery('')
            if (e.key === 'Enter') {
              e.preventDefault()
              const first = shown[0]
              if (first) pick(first.id)
            }
          }}
        />
      </div>
      {open && (
        <div className="rounded-xl border bg-background">
          {options.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">{empty}</p>
          ) : shown.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">Nic nenalezeno.</p>
          ) : (
            <ul aria-label={`${label}: výsledky`} className="scroll-area max-h-72 overflow-y-auto p-1">
              {shown.map((o) => (
                <li key={o.id}>
                  <button
                    type="button"
                    // klepnutí nesmí nejdřív zavřít seznam (blur pole)
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pick(o.id)}
                    className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left hover:bg-muted"
                  >
                    {o.icon}
                    <span className="min-w-0 flex-1 break-words">
                      <span className="font-medium">{o.label}</span>
                      {o.hint && <span className="text-sm text-muted-foreground"> · {o.hint}</span>}
                    </span>
                  </button>
                </li>
              ))}
              {matches.length > shown.length && <li className="px-3 py-2 text-xs text-muted-foreground">a dalších {matches.length - shown.length}, upřesni hledání</li>}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
