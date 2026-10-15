import { useState, type FormEvent } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { ArrowLeftIcon, CopyIcon, EyeOffIcon, PencilIcon, PlusIcon, ShieldIcon, SkullIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { FullPageSpinner } from '@/components/FullPageSpinner'
import { Input } from '@/components/ui/input'
import { useCampaign } from '@/features/campaigns/api'
import { DiceDock } from '@/features/dice/DiceDock'
import { d20 } from '@/features/dice/format'
import { useRoller } from '@/features/dice/useRoller'
import { ApiError } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useDeleteEnemy, useDuplicateEnemy, useEnemies, useEnemyHp, type Enemy } from './api'
import { EnemyForm } from './EnemyForm'

/** Nepřátelé: jednoduchý přehled jen pro DM (HP, AC, útoky s hody). Hráči o nich nic nevidí. */
export function EnemiesPage() {
  const { campaignId = '' } = useParams<{ campaignId: string }>()
  const { data: campaign, isPending } = useCampaign(campaignId)
  const isDm = campaign?.role === 'dm'
  const { data: enemies, isPending: loading, error } = useEnemies(campaignId, isDm)
  const [form, setForm] = useState<{ enemy?: Enemy } | null>(null)
  const [hideRolls, setHideRolls] = useState(true)

  if (isPending) return <FullPageSpinner />
  if (!campaign) return <Navigate to="/" replace />
  if (!isDm) return <Navigate to={`/campaigns/${campaignId}`} replace />

  return (
    <>
      <div className="space-y-2">
        <Link to={`/campaigns/${campaignId}/dm`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeftIcon aria-hidden className="size-4" /> Panel DM
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-2xl font-bold">Nepřátelé</h1>
          <Button onClick={() => setForm({})}>
            <PlusIcon aria-hidden /> Přidat nepřítele
          </Button>
        </div>
        <p className="flex items-center gap-1 text-sm text-muted-foreground">
          <EyeOffIcon aria-hidden className="size-4 shrink-0" /> Nepřátele vidíš jen ty, hráči o nich nevědí. Slouží ti k zapisování životů a hodů.
        </p>
      </div>

      <Button type="button" variant={hideRolls ? 'default' : 'outline'} aria-pressed={hideRolls} onClick={() => setHideRolls((v) => !v)} className="h-auto min-h-11 w-full justify-start whitespace-normal py-2 text-left sm:w-auto">
        <EyeOffIcon aria-hidden />
        {hideRolls ? 'Hody nepřátel jsou skryté před hráči (vidíš je jen ty)' : 'Hody nepřátel uvidí všichni hráči v logu'}
      </Button>

      {loading && <p className="text-muted-foreground">Načítám…</p>}
      {error && <p role="alert">Nepřátele se nepodařilo načíst.</p>}
      {enemies?.length === 0 && <p className="text-muted-foreground">Zatím tu nikdo není. Přidej třeba goblina, nastav mu životy a útoky.</p>}
      <ul aria-label="Nepřátelé" className="grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-2 xl:grid-cols-3">
        {enemies?.map((e) => (
          <EnemyCard key={e.id} campaignId={campaignId} enemy={e} hideRolls={hideRolls} onEdit={() => setForm({ enemy: e })} />
        ))}
      </ul>

      <DiceDock campaignId={campaignId} />
      {form && <EnemyForm key={form.enemy?.id ?? 'new'} campaignId={campaignId} enemy={form.enemy} onClose={() => setForm(null)} />}
    </>
  )
}

function EnemyCard({ campaignId, enemy, hideRolls, onEdit }: { campaignId: string; enemy: Enemy; hideRolls: boolean; onEdit: () => void }) {
  const hp = useEnemyHp(campaignId)
  const duplicate = useDuplicateEnemy(campaignId)
  const remove = useDeleteEnemy(campaignId)
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
    <li className={cn('space-y-3 rounded-xl border bg-card p-4', down && 'border-dashed bg-muted')} data-testid={`enemy-${enemy.name}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className={cn('break-words text-lg font-semibold', down && 'line-through')}>{enemy.name}</h2>
          {down && (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
              <SkullIcon aria-hidden className="size-3.5" /> Padl
            </span>
          )}
        </div>
        {enemy.ac !== null && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-muted px-3 py-1 text-sm font-medium" title="Armor Class">
            <ShieldIcon aria-hidden className="size-4" /> AC {enemy.ac}
          </span>
        )}
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
        <ul aria-label={`Útoky: ${enemy.name}`} className="divide-y rounded-lg border">
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

      <div className="flex flex-wrap gap-1 border-t pt-2">
        <Button variant="outline" onClick={onEdit} aria-label={`Upravit ${enemy.name}`}>
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

