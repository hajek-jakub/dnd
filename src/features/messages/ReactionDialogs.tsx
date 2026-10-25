import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Modal } from '@/components/ui/modal'
import { cn } from '@/lib/utils'
import type { Reaction } from './api'
import { EMOJI_GROUPS, isSingleEmoji, recentEmojis } from './chat-utils'

function EmojiGrid({ label, emojis, current, onPick }: { label: string; emojis: string[]; current: string | null; onPick: (emoji: string) => void }) {
  return (
    <section aria-label={label} className="mb-3">
      <h3 className="mb-1 text-xs font-medium text-muted-foreground">{label}</h3>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(2.75rem,1fr))] gap-0.5">
        {emojis.map((emoji) => (
          <button
            key={emoji}
            type="button"
            aria-label={`Reagovat ${emoji}`}
            aria-pressed={current === emoji}
            onClick={() => onPick(emoji)}
            className={cn('flex size-11 items-center justify-center rounded-lg text-2xl hover:bg-muted', current === emoji && 'bg-primary/15 ring-1 ring-primary')}
          >
            <span aria-hidden>{emoji}</span>
          </button>
        ))}
      </div>
    </section>
  )
}

/** Výběr jakéhokoli emoji jako na Messengeru: naposledy použitá, nabídka po skupinách a pole pro vlastní (napsat nebo vložit). */
export function EmojiPickerDialog({ open, current, onClose, onPick }: { open: boolean; current: string | null; onClose: () => void; onPick: (emoji: string) => void }) {
  const [custom, setCustom] = useState('')
  const [error, setError] = useState<string | null>(null)
  const recent = open ? recentEmojis() : []

  function close() {
    setCustom('')
    setError(null)
    onClose()
  }

  function pick(emoji: string) {
    setCustom('')
    setError(null)
    onPick(emoji)
  }

  return (
    <Modal open={open} onClose={close} title="Reagovat emoji">
      <form
        className="mb-4 flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          const value = custom.trim()
          if (!isSingleEmoji(value)) setError('Napiš nebo vlož jedno emoji.')
          else pick(value)
        }}
      >
        <label className="min-w-0 flex-1 text-sm">
          <span className="mb-1 block font-medium">Vlastní emoji</span>
          <Input
            value={custom}
            onChange={(e) => {
              setCustom(e.target.value)
              setError(null)
            }}
            placeholder="Napiš nebo vlož emoji"
            aria-invalid={error !== null}
            aria-describedby={error ? 'custom-emoji-error' : undefined}
            className="text-xl"
          />
        </label>
        <Button type="submit">Reagovat</Button>
      </form>
      {error && (
        <p id="custom-emoji-error" role="alert" className="-mt-2 mb-3 text-sm text-destructive">
          {error}
        </p>
      )}
      {recent.length > 0 && <EmojiGrid label="Naposledy použité" emojis={recent} current={current} onPick={pick} />}
      {EMOJI_GROUPS.map((g) => (
        <EmojiGrid key={g.name} label={g.name} emojis={g.emojis} current={current} onPick={pick} />
      ))}
    </Modal>
  )
}

/** Kdo jak reagoval (klepnutí na bublinu reakcí); vlastní reakci jde odebrat. */
export function ReactionsDialog({
  open,
  reactions,
  me,
  onClose,
  onRemove,
}: {
  open: boolean
  reactions: Reaction[]
  me: { id: string }
  onClose: () => void
  onRemove: (emoji: string) => void
}) {
  const [filter, setFilter] = useState<string | null>(null)
  const active = filter && reactions.some((r) => r.emoji === filter) ? filter : null
  const rows = reactions
    .filter((r) => active === null || r.emoji === active)
    .flatMap((r) => r.users.map((u) => ({ emoji: r.emoji, user: u })))
    .sort((a, b) => Number(b.user.id === me.id) - Number(a.user.id === me.id) || a.user.name.localeCompare(b.user.name, 'cs'))
  const total = reactions.reduce((sum, r) => sum + r.users.length, 0)

  return (
    <Modal
      open={open}
      onClose={() => {
        setFilter(null)
        onClose()
      }}
      title="Reakce"
    >
      <div role="group" aria-label="Filtrovat reakce" className="mb-3 flex flex-wrap gap-1">
        <Button variant={active === null ? 'secondary' : 'ghost'} aria-pressed={active === null} onClick={() => setFilter(null)}>
          Vše {total}
        </Button>
        {reactions.map((r) => (
          <Button key={r.emoji} variant={active === r.emoji ? 'secondary' : 'ghost'} aria-pressed={active === r.emoji} aria-label={`${r.emoji} ${r.users.length}`} onClick={() => setFilter(r.emoji)}>
            <span aria-hidden className="text-lg">
              {r.emoji}
            </span>
            <span aria-hidden className="tabular-nums">
              {r.users.length}
            </span>
          </Button>
        ))}
      </div>
      <ul aria-label="Kdo reagoval" className="divide-y">
        {rows.map(({ emoji, user }) => {
          const mine = user.id === me.id
          return (
            <li key={`${emoji}-${user.id}`} className="flex min-h-12 items-center gap-3 py-1">
              <span className="min-w-0 flex-1 truncate">{mine ? 'Ty' : user.name}</span>
              {mine && (
                <Button variant="ghost" onClick={() => onRemove(emoji)}>
                  Odebrat
                </Button>
              )}
              <span role="img" aria-label={emoji} className="text-2xl">
                {emoji}
              </span>
            </li>
          )
        })}
      </ul>
    </Modal>
  )
}
