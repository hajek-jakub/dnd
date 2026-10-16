import { useState, type FormEvent } from 'react'
import { CopyIcon, DicesIcon, EyeOffIcon, PencilIcon, PlusIcon, ShieldIcon, SkullIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { SectionHeader } from '@/components/SectionHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { d20 } from '@/features/dice/format'
import { useRoller } from '@/features/dice/useRoller'
import { ApiError } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useDeleteEnemy, useDuplicateEnemy, useEnemyHp, useRollEnemyInitiative, type Enemy } from './api'

/**
 * Nepřátelé přímo v Panelu DM (vidí je jen DM): karty s červeným akcentem, HP, hody útoku, zranění a iniciativy.
 * Přidání a úpravu řeší rodič (tlačítka v hlavičce stránky, „Upravit“ na kartě).
 */
export function EnemiesSection({ campaignId, enemies, onAdd, onEdit }: { campaignId: string; enemies: Enemy[]; onAdd: () => void; onEdit: (enemy: Enemy) => void }) {
  const [hideRolls, setHideRolls] = useState(true)
  return (
    <section aria-label="Nepřátelé" className="space-y-3">
      <SectionHeader
        title={
          <span className="underline decoration-red-500 decoration-4 underline-offset-8">
            Nepřátelé
          </span>
        }
        actions={
          <>
            <Button type="button" variant={hideRolls ? 'default' : 'outline'} aria-pressed={hideRolls} onClick={() => setHideRolls((v) => !v)}>
              <EyeOffIcon aria-hidden /> {hideRolls ? 'Hody skryté před hráči' : 'Hody vidí všichni'}
            </Button>
            <Button variant="secondary" onClick={onAdd}>
              <PlusIcon aria-hidden /> Nový nepřítel
            </Button>
          </>
        }
      />
      {enemies.length === 0 && <p className="text-sm text-muted-foreground">Zatím tu nikdo není. „Nový nepřítel“ přidá třeba goblina s životy, útoky a iniciativou. Vidíš je jen ty.</p>}
      <ul aria-label="Seznam nepřátel" className="grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-2 xl:grid-cols-3">
        {enemies.map((e) => (
          <EnemyCard key={e.id} campaignId={campaignId} enemy={e} hideRolls={hideRolls} onEdit={() => onEdit(e)} />
        ))}
      </ul>
    </section>
  )
}

function EnemyCard({ campaignId, enemy, hideRolls, onEdit }: { campaignId: string; enemy: Enemy; hideRolls: boolean; onEdit: () => void }) {
  const hp = useEnemyHp(campaignId)
  const duplicate = useDuplicateEnemy(campaignId)
  const remove = useDeleteEnemy(campaignId)
  const initiative = useRollEnemyInitiative(campaignId)
  const { roll, pending } = useRoller(campaignId)
  const [amount, setAmount] = useState('')
  const down = enemy.hpCurrent === 0
  const percent = Math.max(0, Math.min(100, Math.round((enemy.hpCurrent / enemy.hpMax) * 100)))
  const fail = (fallback: string) => (e: Error) => toast.error(e instanceof ApiError ? e.message : fallback)

  const change = (delta: number) => hp.mutate({ id: enemy.id, delta }, { onError: fail('Změna HP se nepodařila.') })
  function custom(e: FormEvent, sign: 1 | -1) {
    e.preventDefault()
    const n = Number.parseInt(amount, 10)
    if (!Number.isInteger(n) || n <= 0) return
    change(sign * n)
    setAmount('')
  }

  return (
    <li
      className={cn('space-y-3 rounded-xl border border-l-4 border-red-500/40 border-l-red-600 bg-red-500/5 p-4', down && 'border-dashed bg-muted')}
      data-testid={`enemy-${enemy.name}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className={cn('break-words text-lg font-semibold underline decoration-red-500 decoration-2 underline-offset-4', down && 'line-through')}>{enemy.name}</h3>
          {down && (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
              <SkullIcon aria-hidden className="size-3.5" /> Padl
            </span>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-1">
          {enemy.ac !== null && (
            <span className="inline-flex items-center gap-1 rounded-full bg-muted px-3 py-1 text-sm font-medium" title="Armor Class">
              <ShieldIcon aria-hidden className="size-4" /> AC {enemy.ac}
            </span>
          )}
          <Button
            variant="outline"
            className="min-h-11 text-sm"
            disabled={initiative.isPending}
            aria-label={`${enemy.name}: hodit iniciativu (${enemy.initiative >= 0 ? '+' : '−'}${Math.abs(enemy.initiative)})`}
            onClick={() => initiative.mutate(enemy.id, { onSuccess: (r) => toast(`${r.name}: iniciativa ${r.total}`), onError: fail('Hod na iniciativu se nepodařil.') })}
          >
            <DicesIcon aria-hidden /> Iniciativa {enemy.initiative >= 0 ? '+' : '−'}
            {Math.abs(enemy.initiative)}
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-sm">
          HP: <strong data-testid={`enemy-hp-${enemy.name}`}>{enemy.hpCurrent}</strong> / {enemy.hpMax}
        </p>
        <div className="h-2 overflow-hidden rounded-full bg-background" aria-hidden>
          <div className={cn('h-full', percent > 50 ? 'bg-green-500' : percent > 25 ? 'bg-amber-500' : 'bg-red-500')} style={{ width: `${percent}%` }} />
        </div>
        <div className="grid grid-cols-4 gap-2">
          {[-5, -1, 1, 5].map((d) => (
            <Button key={d} variant="outline" disabled={hp.isPending} aria-label={`${enemy.name}: ${d > 0 ? '+' : '−'}${Math.abs(d)} HP`} onClick={() => change(d)}>
              {d > 0 ? `+${d}` : `−${Math.abs(d)}`}
            </Button>
          ))}
        </div>
        <form className="flex gap-2" onSubmit={(e) => custom(e, -1)}>
          <Input aria-label={`${enemy.name}: kolik HP`} type="number" inputMode="numeric" min={1} placeholder="Kolik" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <Button type="submit" variant="secondary" disabled={hp.isPending || amount === ''} aria-label={`${enemy.name}: zranit`}>
            Zranit
          </Button>
          <Button type="button" variant="outline" disabled={hp.isPending || amount === ''} aria-label={`${enemy.name}: léčit`} onClick={(e) => custom(e, 1)}>
            Léčit
          </Button>
        </form>
      </div>

      {enemy.attacks.length > 0 && (
        <ul aria-label={`Útoky: ${enemy.name}`} className="divide-y rounded-lg border bg-background/60">
          {enemy.attacks.map((a, i) => (
            <li key={`${a.name}-${i}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1">
              <span className="min-w-0 flex-1 font-medium">{a.name}</span>
              <span className="text-sm text-muted-foreground">
                {a.toHit >= 0 ? '+' : '−'}
                {Math.abs(a.toHit)}
                {a.damage && ` · ${a.damage}`}
              </span>
              <span className="flex">
                <RollBtn label={`${enemy.name}: ${a.name} útok`} text="Útok" disabled={pending} onClick={() => roll(`${enemy.name}: ${a.name} (útok)`, d20(a.toHit), { hidden: hideRolls })} />
                {a.damage && <RollBtn label={`${enemy.name}: ${a.name} zranění`} text="Zranění" disabled={pending} onClick={() => roll(`${enemy.name}: ${a.name} (zranění)`, a.damage, { hidden: hideRolls })} />}
                {a.damage && <RollBtn label={`${enemy.name}: ${a.name} zranění (kritický)`} text="Krit" disabled={pending} onClick={() => roll(`${enemy.name}: ${a.name} (krit)`, a.damage, { hidden: hideRolls, crit: true })} />}
              </span>
            </li>
          ))}
        </ul>
      )}

      {enemy.notes && <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">{enemy.notes}</p>}

      <div className="flex flex-wrap gap-1 border-t border-red-500/20 pt-2">
        <Button variant="outline" onClick={onEdit} aria-label={`Upravit ${enemy.name} (útoky, kostky, iniciativa)`}>
          <PencilIcon aria-hidden /> Upravit
        </Button>
        <Button
          variant="outline"
          disabled={duplicate.isPending}
          aria-label={`Přidat další: ${enemy.name}`}
          onClick={() => duplicate.mutate(enemy.id, { onError: fail('Kopii se nepodařilo vytvořit.') })}
        >
          <CopyIcon aria-hidden /> Další
        </Button>
        <Button
          variant="destructive"
          size="icon"
          aria-label={`Smazat ${enemy.name}`}
          disabled={remove.isPending}
          onClick={() => {
            if (window.confirm(`Smazat nepřítele „${enemy.name}“?`)) remove.mutate(enemy.id, { onError: fail('Smazání se nepodařilo.') })
          }}
        >
          <Trash2Icon aria-hidden />
        </Button>
      </div>
    </li>
  )
}

function RollBtn({ label, text, disabled, onClick }: { label: string; text: string; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-label={`Hodit: ${label}`}
      className="inline-flex h-11 min-w-11 items-center justify-center rounded-lg px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
    >
      {text}
    </button>
  )
}
