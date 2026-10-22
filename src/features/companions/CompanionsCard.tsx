import { useState, type FormEvent } from 'react'
import { CopyIcon, PawPrintIcon, PencilIcon, PlusIcon, ShieldIcon, SkullIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { RichText } from '@/components/RichText'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { d20 } from '@/features/dice/format'
import { useRoller } from '@/features/dice/useRoller'
import { EnemyEditor } from '@/features/enemies/EnemyForm'
import { RollBtn } from '@/features/enemies/EnemiesSection'
import { useSheet } from '@/features/sheet/sheet-context'
import { ApiError } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useCompanionHp, useCompanions, useCreateCompanion, useDeleteCompanion, useDuplicateCompanion, useUpdateCompanion, type Companion } from './api'

const fail = (fallback: string) => (e: Error) => toast.error(e instanceof ApiError ? e.message : fallback)

/**
 * Společníci a přivolaná stvoření postavy (familiar, animal companion, přivolaní tvorové): malé karty s HP, AC a útoky.
 * Úpravy a hody smí majitel a DM; ostatní, kteří postavu vidí celou, je jen čtou. Bez společníků se karta ukáže jen těm, kdo mohou přidávat.
 */
export function CompanionsCard() {
  const { character, canEdit } = useSheet()
  const companions = useCompanions(character.id)
  const create = useCreateCompanion(character.id)
  const [editing, setEditing] = useState<Companion | 'new' | null>(null)
  const update = useUpdateCompanion(character.id)
  const list = companions.data ?? []
  if (companions.isPending || companions.isError) return null
  if (list.length === 0 && !canEdit) return null

  return (
    <Card data-testid="companions-card">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <CardTitle>Společníci</CardTitle>
        {canEdit && (
          <Button variant="outline" onClick={() => setEditing('new')}>
            <PlusIcon aria-hidden /> Přidat
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {list.length === 0 && <p className="text-sm text-muted-foreground">Familiar, zvířecí společník nebo přivolané stvoření. „Přidat“ je založí s životy a útoky, třeba z nestvůr SRD.</p>}
        <ul aria-label="Společníci" className="space-y-3">
          {list.map((c) => (
            <CompanionItem key={c.id} companion={c} onEdit={() => setEditing(c)} />
          ))}
        </ul>
      </CardContent>
      {editing && (
        <EnemyEditor
          title={editing === 'new' ? 'Přidat společníka' : `Upravit: ${editing.name}`}
          initial={editing === 'new' ? undefined : { ...editing, initiative: 0, cr: null, xp: null }}
          withCount={false}
          withInitiative={false}
          notesLabel="Poznámka (druh, schopnosti, jak dlouho trvá)"
          onClose={() => setEditing(null)}
          onSubmit={async ({ count: _count, cr: _cr, xp: _xp, initiative: _init, ...input }) => {
            if (editing === 'new') await create.mutateAsync(input)
            else await update.mutateAsync({ id: editing.id, ...input })
          }}
        />
      )}
    </Card>
  )
}

function CompanionItem({ companion: c, onEdit }: { companion: Companion; onEdit: () => void }) {
  const { character, canEdit } = useSheet()
  const hp = useCompanionHp(character.id)
  const duplicate = useDuplicateCompanion(character.id)
  const remove = useDeleteCompanion(character.id)
  const { roll, pending } = useRoller(character.campaignId, character.id)
  const [amount, setAmount] = useState('')
  const down = c.hpCurrent === 0
  const percent = Math.max(0, Math.min(100, Math.round((c.hpCurrent / c.hpMax) * 100)))
  const change = (delta: number) => hp.mutate({ id: c.id, delta }, { onError: fail('Změna HP se nepodařila.') })
  function custom(e: FormEvent, sign: 1 | -1) {
    e.preventDefault()
    const n = Number.parseInt(amount, 10)
    if (!Number.isInteger(n) || n <= 0) return
    change(sign * n)
    setAmount('')
  }

  return (
    <li className={cn('space-y-3 rounded-xl border border-l-4 border-l-primary bg-muted/30 p-3', down && 'border-dashed bg-muted')} data-testid={`companion-${c.name}`}>
      <div className="flex items-start justify-between gap-2">
        <h3 className={cn('flex min-w-0 items-center gap-2 break-words text-base font-semibold', down && 'line-through')}>
          <PawPrintIcon aria-hidden className="size-4 shrink-0 text-primary" /> {c.name}
        </h3>
        <div className="flex shrink-0 items-center gap-2">
          {down && (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
              <SkullIcon aria-hidden className="size-3.5" /> Padl
            </span>
          )}
          {c.ac !== null && (
            <span className="inline-flex items-center gap-1 rounded-full bg-muted px-3 py-1 text-sm font-medium" title="Armor Class">
              <ShieldIcon aria-hidden className="size-4" /> AC {c.ac}
            </span>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-sm">
          HP: <strong data-testid={`companion-hp-${c.name}`}>{c.hpCurrent}</strong> / {c.hpMax}
        </p>
        <div className="h-2 overflow-hidden rounded-full bg-background" aria-hidden>
          <div className={cn('h-full', percent > 50 ? 'bg-green-500' : percent > 25 ? 'bg-amber-500' : 'bg-red-500')} style={{ width: `${percent}%` }} />
        </div>
        {canEdit && (
          <>
            <div className="grid grid-cols-4 gap-2">
              {[-5, -1, 1, 5].map((d) => (
                <Button key={d} variant="outline" disabled={hp.isPending} aria-label={`${c.name}: ${d > 0 ? '+' : '−'}${Math.abs(d)} HP`} onClick={() => change(d)}>
                  {d > 0 ? `+${d}` : `−${Math.abs(d)}`}
                </Button>
              ))}
            </div>
            <form className="flex gap-2" onSubmit={(e) => custom(e, -1)}>
              <Input aria-label={`${c.name}: kolik HP`} type="number" inputMode="numeric" min={1} placeholder="Kolik" value={amount} onChange={(e) => setAmount(e.target.value)} />
              <Button type="submit" variant="secondary" disabled={hp.isPending || amount === ''} aria-label={`${c.name}: zranit`}>
                Zranit
              </Button>
              <Button type="button" variant="outline" disabled={hp.isPending || amount === ''} aria-label={`${c.name}: léčit`} onClick={(e) => custom(e, 1)}>
                Léčit
              </Button>
            </form>
          </>
        )}
      </div>

      {c.attacks.length > 0 && (
        <ul aria-label={`Útoky: ${c.name}`} className="divide-y rounded-lg border bg-background/60">
          {c.attacks.map((a, i) => (
            <li key={`${a.name}-${i}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1">
              <span className="min-w-0 flex-1 font-medium">{a.name}</span>
              <span className="text-sm text-muted-foreground">
                {a.toHit >= 0 ? '+' : '−'}
                {Math.abs(a.toHit)}
                {a.damage && ` · ${a.damage}`}
              </span>
              {canEdit && (
                <span className="flex">
                  <RollBtn label={`${c.name}: ${a.name} útok`} text="Útok" disabled={pending} onClick={() => roll(`${c.name}: ${a.name} (útok)`, d20(a.toHit))} />
                  {a.damage && <RollBtn label={`${c.name}: ${a.name} zranění`} text="Zranění" disabled={pending} onClick={() => roll(`${c.name}: ${a.name} (zranění)`, a.damage)} />}
                  {a.damage && <RollBtn label={`${c.name}: ${a.name} zranění (kritický)`} text="Krit" disabled={pending} onClick={() => roll(`${c.name}: ${a.name} (krit)`, a.damage, { crit: true })} />}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {c.notes && <RichText text={c.notes} className="break-words text-sm text-muted-foreground" />}

      {canEdit && (
        <div className="flex flex-wrap gap-1 border-t pt-2">
          <Button variant="outline" onClick={onEdit} aria-label={`Upravit ${c.name}`}>
            <PencilIcon aria-hidden /> Upravit
          </Button>
          <Button variant="outline" disabled={duplicate.isPending} aria-label={`Přidat další: ${c.name}`} onClick={() => duplicate.mutate(c.id, { onError: fail('Kopii se nepodařilo vytvořit.') })}>
            <CopyIcon aria-hidden /> Další
          </Button>
          <Button
            variant="destructive"
            size="icon"
            aria-label={`Smazat ${c.name}`}
            disabled={remove.isPending}
            onClick={() => {
              if (window.confirm(`Smazat společníka „${c.name}“?`)) remove.mutate(c.id, { onError: fail('Smazání se nepodařilo.') })
            }}
          >
            <Trash2Icon aria-hidden />
          </Button>
        </div>
      )}
    </li>
  )
}
