import { useState } from 'react'
import { PencilIcon, PlusIcon, SendIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { ApiError } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useCreateDraft, useDeleteDraft, useDrafts, useSendDraft, useUpdateDraft, type MessageDraft } from './api'

type Player = { userId: string; displayName: string }

/** Komu koncept půjde: „Všem“, jeden hráč (soukromě) nebo víc hráčů (tajná zpráva). */
function targetLabel(d: MessageDraft): string {
  if (d.toAll) return 'Všem (skupina)'
  if (d.recipients.length === 0) return 'Nikdo (příjemci už nejsou v kampani)'
  if (d.recipients.length === 1) return `${d.recipients[0]!.name} (soukromě)`
  return `${d.recipients.map((r) => r.name).join(', ')} (tajná zpráva)`
}

function formatSent(iso: string): string {
  const d = new Date(iso)
  return `${d.toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric' })} ${d.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' })}`
}

/** Připravené zprávy DM: nachystá se text a příjemci předem, odešlou se jedním klepnutím. Vidí je jen DM. */
export function DraftsPanel({ campaignId, players }: { campaignId: string; players: Player[] }) {
  const { data: drafts, isPending, error } = useDrafts(campaignId, true)
  const [editing, setEditing] = useState<string | 'new' | null>(null)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 flex-1 basis-56 text-sm text-muted-foreground">Nachystej text, urči komu je, a pak ho odešli jedním klepnutím. Hráči o konceptu nevědí, dokud ho neodešleš.</p>
        {editing !== 'new' && (
          <Button onClick={() => setEditing('new')}>
            <PlusIcon aria-hidden /> Nová zpráva
          </Button>
        )}
      </div>

      {editing === 'new' && <DraftForm campaignId={campaignId} players={players} onDone={() => setEditing(null)} />}

      {isPending && <p className="text-sm text-muted-foreground">Načítám…</p>}
      {error && <p role="alert">Připravené zprávy se nepodařilo načíst.</p>}
      {drafts && drafts.length === 0 && editing !== 'new' && <p className="text-sm text-muted-foreground">Zatím nic nenachystáno. Klepni na „Nová zpráva“.</p>}

      <ul aria-label="Připravené zprávy" className="space-y-3">
        {drafts?.map((d) =>
          editing === d.id ? (
            <li key={d.id}>
              <DraftForm campaignId={campaignId} players={players} draft={d} onDone={() => setEditing(null)} />
            </li>
          ) : (
            <DraftRow key={d.id} draft={d} campaignId={campaignId} onEdit={() => setEditing(d.id)} />
          ),
        )}
      </ul>
    </div>
  )
}

function DraftRow({ draft, campaignId, onEdit }: { draft: MessageDraft; campaignId: string; onEdit: () => void }) {
  const send = useSendDraft(campaignId)
  const remove = useDeleteDraft(campaignId)
  const noTarget = !draft.toAll && draft.recipients.length === 0

  function onSend() {
    send.mutate(draft.id, {
      onSuccess: () => toast.success(`Odesláno: ${targetLabel(draft)}`),
      onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Zprávu se nepodařilo odeslat.'),
    })
  }

  function onDelete() {
    if (!window.confirm(`Smazat připravenou zprávu${draft.title ? ` „${draft.title}“` : ''}?`)) return
    remove.mutate(draft.id, { onError: () => toast.error('Smazání se nepodařilo') })
  }

  return (
    <li data-testid="draft" className={cn('space-y-3 rounded-xl border bg-card p-3', draft.sentAt && 'bg-muted/40')}>
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          {draft.title && <h3 className="min-w-0 break-words font-semibold">{draft.title}</h3>}
          {draft.sentAt && <span className="rounded-full border px-2 text-xs text-muted-foreground">Odesláno {formatSent(draft.sentAt)}</span>}
        </div>
        <p className="text-sm">
          <span className="text-muted-foreground">Komu: </span>
          <span className={cn('font-medium', noTarget && 'text-destructive')}>{targetLabel(draft)}</span>
        </p>
      </div>
      <p className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted/60 px-3 py-2 text-sm">{draft.body}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={onSend} disabled={send.isPending || noTarget} aria-label={`${draft.sentAt ? 'Poslat znovu' : 'Odeslat'}: ${draft.title || draft.body.slice(0, 30)}`}>
          <SendIcon aria-hidden /> {draft.sentAt ? 'Poslat znovu' : 'Odeslat'}
        </Button>
        <Button variant="outline" onClick={onEdit} aria-label={`Upravit: ${draft.title || draft.body.slice(0, 30)}`}>
          <PencilIcon aria-hidden /> Upravit
        </Button>
        <Button variant="ghost" size="icon" className="ml-auto" onClick={onDelete} disabled={remove.isPending} aria-label={`Smazat: ${draft.title || draft.body.slice(0, 30)}`}>
          <Trash2Icon aria-hidden />
        </Button>
      </div>
    </li>
  )
}

function DraftForm({ campaignId, players, draft, onDone }: { campaignId: string; players: Player[]; draft?: MessageDraft; onDone: () => void }) {
  const create = useCreateDraft(campaignId)
  const update = useUpdateDraft(campaignId)
  const [title, setTitle] = useState(draft?.title ?? '')
  const [body, setBody] = useState(draft?.body ?? '')
  const [all, setAll] = useState(draft?.toAll ?? false)
  const [picked, setPicked] = useState<Set<string>>(new Set(draft?.recipients.map((r) => r.id) ?? []))
  const pending = create.isPending || update.isPending
  const valid = body.trim().length > 0 && (all || picked.size > 0)

  function toggle(id: string, on: boolean) {
    setAll(false)
    setPicked((p) => {
      const next = new Set(p)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })
  }

  function save() {
    if (!valid || pending) return
    const input = { title: title.trim(), body: body.trim(), to: all ? ('all' as const) : [...picked] }
    const options = {
      onSuccess: () => {
        toast.success(draft ? 'Zpráva uložena' : 'Zpráva nachystána')
        onDone()
      },
      onError: (e: unknown) => toast.error(e instanceof ApiError ? e.message : 'Uložení se nepodařilo.'),
    }
    if (draft) update.mutate({ id: draft.id, ...input }, options)
    else create.mutate(input, options)
  }

  const who = all ? 'všem' : picked.size === 0 ? null : picked.size === 1 ? 'jednomu hráči (soukromě)' : `${picked.size} hráčům (tajná zpráva)`

  return (
    <form
      aria-label={draft ? 'Upravit připravenou zprávu' : 'Nová připravená zpráva'}
      className="space-y-3 rounded-xl border border-primary/40 bg-card p-3"
      onSubmit={(e) => {
        e.preventDefault()
        save()
      }}
    >
      <div className="space-y-1">
        <Label htmlFor="draft-title">Název (jen pro tebe, nepovinný)</Label>
        <Input id="draft-title" maxLength={80} placeholder="Např. Vize pro Boba" value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="draft-body">Zpráva</Label>
        <Textarea id="draft-body" rows={4} maxLength={4000} className="min-h-28" placeholder="Co chceš hráčům říct nebo ukázat…" value={body} onChange={(e) => setBody(e.target.value)} />
      </div>
      <fieldset className="space-y-1">
        <legend className="text-sm font-medium">Komu</legend>
        <div className="flex flex-wrap gap-2">
          <label className={cn('flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-3', all && 'border-primary bg-primary/10')}>
            <input
              type="checkbox"
              className="size-5"
              checked={all}
              onChange={(e) => {
                setAll(e.target.checked)
                if (e.target.checked) setPicked(new Set())
              }}
            />
            Všem
          </label>
          {players.map((m) => (
            <label key={m.userId} className={cn('flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-3', picked.has(m.userId) && 'border-primary bg-primary/10')}>
              <input type="checkbox" className="size-5" checked={picked.has(m.userId)} onChange={(e) => toggle(m.userId, e.target.checked)} />
              {m.displayName}
            </label>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          {who ? `Půjde ${who}.` : 'Vyber „Všem“, jednoho hráče (soukromá zpráva) nebo víc hráčů (tajná zpráva).'}
        </p>
      </fieldset>
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" onClick={onDone}>
          Zrušit
        </Button>
        <Button type="submit" disabled={!valid || pending}>
          {draft ? 'Uložit změny' : 'Nachystat'}
        </Button>
      </div>
    </form>
  )
}
