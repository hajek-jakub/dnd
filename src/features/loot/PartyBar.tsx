import { useState, type DragEvent } from 'react'
import { GiftIcon, UsersIcon, XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Avatar } from '@/features/sheet/Avatar'
import { formatCp } from '@/features/sheet/money'
import { cn } from '@/lib/utils'
import type { LootEntry } from './api'
import { countFor, goldShare, type Assignments } from './distribution'
import { entryLabel } from './labels'

export interface PartyMember {
  id: string
  name: string
  photoVersion: string | null
  npc: boolean
}

/** Cíl „celá družina“: zlato se rozdělí rovným dílem mezi hráčské postavy. */
export const PARTY = 'party'

/**
 * Lišta s ikonami postav: položku jde přetáhnout na ikonu (počítač), nebo položky zaškrtnout a klepnout na ikonu (telefon i počítač).
 * Přiřazení se jen připraví; nic se nerozdá, dokud DM neklepne na Rozdat, takže překlik jde opravit.
 */
export function PartyBar({
  members,
  entries,
  assignments,
  tickedCount,
  dragging,
  pending,
  onAssign,
  onUnassign,
  onClear,
  onGive,
}: {
  members: PartyMember[]
  entries: LootEntry[]
  assignments: Assignments
  tickedCount: number
  dragging: boolean
  pending: boolean
  /** Přiřadí zaškrtnuté (nebo přetažené) položky postavě, případně celé družině (`PARTY`). */
  onAssign: (target: string) => void
  onUnassign: (entryId: string, characterId: string) => void
  onClear: () => void
  onGive: () => void
}) {
  const [over, setOver] = useState<string | null>(null)
  const names = new Map(members.map((m) => [m.id, m.name]))
  const assigned = Object.entries(assignments).flatMap(([id, chars]) => {
    const entry = entries.find((e) => e.id === id)
    return entry ? [{ entry, chars }] : []
  })
  const players = members.filter((m) => !m.npc)

  const dropTarget = (target: string) => ({
    onDragOver: (e: DragEvent) => {
      if (!dragging) return
      e.preventDefault()
      setOver(target)
    },
    onDragLeave: () => setOver((o) => (o === target ? null : o)),
    onDrop: (e: DragEvent) => {
      e.preventDefault()
      setOver(null)
      onAssign(target)
    },
  })

  return (
    <Card size="sm" className="tab:sticky tab:top-[4.25rem] tab:z-[5]" data-testid="party-bar">
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          {tickedCount > 0
            ? `Vybráno ${tickedCount}: klepni na postavu, které to dáš.`
            : 'Komu to dát: přetáhni položku na postavu, nebo položky zaškrtni a klepni na postavu.'}
        </p>
        <ul aria-label="Komu dát" className="flex flex-wrap gap-2">
          {members.map((m) => {
            const n = countFor(assignments, m.id)
            return (
              <li key={m.id}>
                <button
                  type="button"
                  {...dropTarget(m.id)}
                  onClick={() => onAssign(m.id)}
                  aria-label={`Dát vybrané: ${m.name}${n > 0 ? `, připraveno ${n}` : ''}`}
                  data-testid={`loot-target-${m.name}`}
                  className={cn(
                    'flex min-h-11 items-center gap-2 rounded-full border bg-background py-1 pr-3 pl-1 text-sm transition-colors hover:bg-muted',
                    n > 0 && 'border-primary',
                    over === m.id && 'ring-2 ring-primary',
                  )}
                >
                  <Avatar id={m.id} name={m.name} version={m.photoVersion} className="size-9 shrink-0 text-sm" />
                  <span className="max-w-36 truncate">
                    {m.name}
                    {m.npc ? ' (NPC)' : ''}
                  </span>
                  {n > 0 && <span className="rounded-full bg-primary px-2 text-xs font-bold text-primary-foreground">{n}</span>}
                </button>
              </li>
            )
          })}
          {players.length > 1 && (
            <li>
              <button
                type="button"
                {...dropTarget(PARTY)}
                onClick={() => onAssign(PARTY)}
                aria-label="Dát vybrané zlato celé družině rovným dílem"
                data-testid="loot-target-party"
                className={cn(
                  'flex min-h-11 items-center gap-2 rounded-full border border-dashed bg-background px-3 py-1 text-sm transition-colors hover:bg-muted',
                  over === PARTY && 'ring-2 ring-primary',
                )}
              >
                <UsersIcon aria-hidden className="size-5" /> Celá družina (zlato rovným dílem)
              </button>
            </li>
          )}
        </ul>
        {members.length === 0 && <p className="text-sm text-muted-foreground">V kampani zatím nejsou žádné postavy.</p>}

        <div aria-live="polite" className="empty:hidden">
          {assigned.length > 0 && (
            <div className="space-y-2 rounded-lg border bg-muted/30 p-2">
              <h2 className="text-sm font-medium">Připraveno k rozdání</h2>
              {/* na počítači je lišta přilepená nahoře, dlouhý seznam proto roluje uvnitř */}
              <ul className="scroll-area max-h-48 space-y-1 overflow-y-auto" aria-label="Připraveno k rozdání">
                {assigned.map(({ entry, chars }) => (
                  <li key={entry.id} className="flex flex-wrap items-center gap-1 text-sm">
                    <span className="font-medium break-words">{entryLabel(entry)}</span>
                    <span aria-hidden>→</span>
                    {chars.map((c) => (
                      <span key={c} className="inline-flex items-center rounded-full border bg-background pl-3">
                        {names.get(c) ?? 'postava'}
                        <Button variant="ghost" size="icon" aria-label={`Nedávat ${entryLabel(entry)}: ${names.get(c) ?? 'postava'}`} onClick={() => onUnassign(entry.id, c)}>
                          <XIcon aria-hidden />
                        </Button>
                      </span>
                    ))}
                    {entry.kind === 'gold' && chars.length > 1 && <span className="text-muted-foreground">(každý {goldShare(entry.data.currency, chars.length).each})</span>}
                    {entry.priceCp !== null && <span className="font-medium text-amber-700 dark:text-amber-400">({chars.length > 1 ? 'každý zaplatí' : 'zaplatí'} {formatCp(entry.priceCp)})</span>}
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap gap-2">
                <Button onClick={onGive} disabled={pending}>
                  <GiftIcon aria-hidden /> {pending ? 'Rozdávám…' : `Rozdat (${assigned.length})`}
                </Button>
                <Button variant="ghost" onClick={onClear} disabled={pending}>
                  Zrušit přiřazení
                </Button>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
