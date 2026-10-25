import { useEffect, useRef, useState } from 'react'
import { CornerUpLeftIcon, PencilIcon, SendIcon, XIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { ApiError } from '@/lib/api'
import { useEditMessage, useSendMessage, type ChatMessage } from './api'

export interface ThreadInfo {
  id: string
  label: string
  hint: string
  icon: 'group' | 'private' | 'secret' | 'language' | 'draft'
  /** název jazyka u vlákna `lang:<jazyk>` */
  language?: string
}

/** Počítač s myší: Enter odešle a Shift+Enter dá nový řádek. Na dotykovém displeji je Enter nový řádek (odesílá se tlačítkem). */
const isFinePointer = () => typeof window !== 'undefined' && window.matchMedia('(pointer: fine)').matches

/** Psaní zprávy: příjemci podle vlákna, odpověď na zprávu (citace nad polem) a úprava vlastní zprávy. */
export function Composer({
  campaignId,
  thread,
  isDm,
  recipientsForDm,
  dmId,
  replyTo,
  editing,
  onCancelReply,
  onDoneEdit,
}: {
  campaignId: string
  thread: ThreadInfo
  isDm: boolean
  recipientsForDm: { userId: string; displayName: string }[]
  dmId: string | undefined
  replyTo: ChatMessage | null
  editing: ChatMessage | null
  onCancelReply: () => void
  onDoneEdit: () => void
}) {
  const send = useSendMessage(campaignId)
  const edit = useEditMessage(campaignId)
  const [text, setText] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const area = useRef<HTMLTextAreaElement>(null)
  const [fine] = useState(isFinePointer)

  // Úprava načte text zprávy do pole (stav se upraví při vykreslení, ne v efektu); odpověď a úprava přesunou kurzor do pole.
  const editingId = editing?.id
  const [seenEditingId, setSeenEditingId] = useState<number | undefined>(undefined)
  if (editingId !== seenEditingId) {
    setSeenEditingId(editingId)
    if (editing) setText(editing.body)
  }
  const replyId = replyTo?.id
  useEffect(() => {
    if (editingId !== undefined || replyId !== undefined) area.current?.focus()
  }, [editingId, replyId])

  // Příjemci podle vlákna: skupina všem, soukromé jednomu, tajné vybraným (jen DM).
  const secret = thread.id === 'secret'
  const to: 'all' | string[] | { language: string } | null =
    thread.id === 'group' ? 'all' : thread.language ? { language: thread.language } : secret ? (isDm && picked.size >= 2 ? [...picked] : null) : thread.id.startsWith('dm:') ? [isDm ? thread.id.slice(3) : (dmId ?? '')] : null
  const canWrite = !secret || isDm
  const valid = text.trim().length > 0 && (editing !== null || (to !== null && !(Array.isArray(to) && to[0] === '')))
  const readOnly = thread.id.startsWith('lang:') && !thread.language
  const pending = send.isPending || edit.isPending

  function submit() {
    if (!valid || pending) return
    const onError = (e: Error) => toast.error(e instanceof ApiError ? e.message : 'Zprávu se nepodařilo odeslat.')
    if (editing) {
      edit.mutate(
        { id: editing.id, body: text.trim() },
        {
          onSuccess: () => {
            setText('')
            onDoneEdit()
          },
          onError,
        },
      )
      return
    }
    if (to === null) return
    send.mutate(
      { to, body: text.trim(), ...(replyTo ? { replyToId: replyTo.id } : {}) },
      {
        onSuccess: () => {
          setText('')
          onCancelReply()
        },
        onError,
      },
    )
  }

  function cancel() {
    if (editing) {
      setText('')
      onDoneEdit()
    } else onCancelReply()
  }

  if (readOnly && isDm) return <p className="text-sm text-muted-foreground">V jazyce si píšou jen hráči, kteří ho umí. Ty zprávy jen čteš.</p>
  if (readOnly) return <p className="text-sm text-muted-foreground">Tenhle jazyk už tvoje postava neumí, nové zprávy v něm psát nejde.</p>
  if (!canWrite) return <p className="text-sm text-muted-foreground">Tajné zprávy posílá jen DM. Odpovědět mu můžeš soukromě ve vlákně s DM.</p>

  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      {secret && (
        <fieldset className="space-y-1">
          <legend className="text-sm font-medium">Komu (vyber aspoň dva hráče)</legend>
          <div className="flex flex-wrap gap-2">
            {recipientsForDm.map((m) => (
              <label key={m.userId} className="flex min-h-11 items-center gap-2 rounded-lg border px-3">
                <input
                  type="checkbox"
                  className="size-5"
                  checked={picked.has(m.userId)}
                  onChange={(e) =>
                    setPicked((p) => {
                      const next = new Set(p)
                      if (e.target.checked) next.add(m.userId)
                      else next.delete(m.userId)
                      return next
                    })
                  }
                />
                {m.displayName}
              </label>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">Jednomu hráči piš soukromě v jeho vlákně.</p>
        </fieldset>
      )}
      {(replyTo || editing) && (
        <div role="status" className="flex items-center gap-2 rounded-lg border-l-4 border-primary bg-muted px-3 py-1 text-sm">
          {editing ? <PencilIcon aria-hidden className="size-4 shrink-0 text-primary" /> : <CornerUpLeftIcon aria-hidden className="size-4 shrink-0 text-primary" />}
          <span className="min-w-0 flex-1">
            <span className="block font-medium">{editing ? 'Upravuješ svou zprávu' : `Odpovídáš: ${replyTo?.senderName}`}</span>
            {replyTo && !editing && <span className="block truncate text-xs text-muted-foreground">{replyTo.body}</span>}
          </span>
          <Button type="button" variant="ghost" size="icon" aria-label={editing ? 'Zrušit úpravu' : 'Zrušit odpověď'} onClick={cancel}>
            <XIcon aria-hidden />
          </Button>
        </div>
      )}
      <Label htmlFor="message-body" className="sr-only">
        Zpráva
      </Label>
      <Textarea
        ref={area}
        id="message-body"
        rows={2}
        maxLength={4000}
        className="min-h-20"
        placeholder="Napiš zprávu…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && (editing || replyTo)) {
            e.preventDefault()
            cancel()
            return
          }
          if (e.key === 'Enter' && !e.nativeEvent.isComposing && (e.metaKey || e.ctrlKey || (fine && !e.shiftKey))) {
            e.preventDefault()
            submit()
          }
        }}
      />
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">{fine ? 'Enter odešle, Shift+Enter nový řádek' : 'Odešleš tlačítkem'}</span>
        <Button type="submit" disabled={!valid || pending}>
          <SendIcon aria-hidden /> {editing ? 'Uložit' : 'Odeslat'}
        </Button>
      </div>
    </form>
  )
}
