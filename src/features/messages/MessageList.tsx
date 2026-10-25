import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDownIcon, CopyIcon, CornerUpLeftIcon, PencilIcon, PlusIcon, SmilePlusIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useDeleteMessage, useReact, type ChatMessage } from './api'
import { QUICK_REACTIONS, dayKey, dayLabel, formatTime, myReaction, reactionSummary, rememberEmoji } from './chat-utils'
import { EmojiPickerDialog, ReactionsDialog } from './ReactionDialogs'

/** Text citace odpovědi: podle zprávy, kterou klient zná (je aktuální po úpravě i smazání), jinak podle náhledu ze serveru. */
function quoteText(reply: NonNullable<ChatMessage['replyTo']>, original: ChatMessage | undefined): string {
  if (reply.hidden) return 'na zprávu, kterou nevidíš'
  if (original) return original.deletedAt ? 'Smazaná zpráva' : original.body
  return reply.deleted ? 'Smazaná zpráva' : reply.snippet
}

/**
 * Chat: bubliny s odpověďmi (citace původní zprávy), emoji reakce (jako na Messengeru: jedna na člověka, souhrn v jedné bublině), úprava a smazání, oddělovače dnů a posun na nejnovější.
 * Klepnutí na zprávu (nebo na tlačítko vedle ní) otevře její akce: reakce, odpovědět, kopírovat, upravit, smazat.
 */
export function MessageList({
  campaignId,
  messages,
  me,
  isDm,
  onReply,
  onEdit,
}: {
  campaignId: string
  messages: ChatMessage[]
  me: { id: string; name: string }
  isDm: boolean
  onReply: (m: ChatMessage) => void
  onEdit: (m: ChatMessage) => void
}) {
  const box = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const [showJump, setShowJump] = useState(false)
  const [openId, setOpenId] = useState<number | null>(null)
  const [flashId, setFlashId] = useState<number | null>(null)
  const [pickerFor, setPickerFor] = useState<number | null>(null)
  const [detailFor, setDetailFor] = useState<number | null>(null)
  const react = useReact(campaignId)
  const remove = useDeleteMessage(campaignId)
  const byId = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages])
  const count = messages.length
  const pickerTarget = pickerFor === null ? undefined : byId.get(pickerFor)
  const detailTarget = detailFor === null ? undefined : byId.get(detailFor)
  const lastMine = messages.at(-1)?.senderId === me.id

  // Nové zprávy: dole zůstaneš, jen když jsi už dole (nebo jsi psal ty); jinak se ukáže tlačítko „Nové zprávy“.
  useEffect(() => {
    const el = box.current
    if (!el) return
    if (stick.current || lastMine) {
      el.scrollTop = el.scrollHeight
      stick.current = true
      setShowJump(false)
    } else {
      setShowJump(true)
    }
  }, [count, lastMine])

  // Otevřené akce zprávy se posunou do viditelné části seznamu (jinak by je u poslední zprávy zakrylo políčko pro psaní).
  useEffect(() => {
    if (openId === null) return
    document.getElementById(`toolbar-${openId}`)?.scrollIntoView({ block: 'nearest' })
  }, [openId])

  useEffect(() => {
    if (flashId === null) return
    const t = window.setTimeout(() => setFlashId(null), 1600)
    return () => window.clearTimeout(t)
  }, [flashId])

  function onScroll() {
    const el = box.current
    if (!el) return
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    if (stick.current) setShowJump(false)
  }

  function jumpTo(id: number) {
    const el = document.getElementById(`msg-${id}`)
    if (!el) return
    el.scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
    setFlashId(id)
  }

  function toggleReaction(m: ChatMessage, emoji: string) {
    if (myReaction(m.reactions, me.id) !== emoji) rememberEmoji(emoji)
    react.mutate({ id: m.id, emoji, me }, { onError: () => toast.error('Reakci se nepodařilo uložit.') })
  }

  async function copy(m: ChatMessage) {
    try {
      await navigator.clipboard.writeText(m.body)
      toast.success('Zpráva zkopírována')
    } catch {
      toast.error('Zprávu se nepodařilo zkopírovat')
    }
  }

  function removeMessage(m: ChatMessage) {
    if (!window.confirm('Smazat tuhle zprávu? Text zmizí všem.')) return
    remove.mutate(m.id, { onError: () => toast.error('Zprávu se nepodařilo smazat') })
  }

  return (
    <div className="relative">
      <div ref={box} onScroll={onScroll} role="log" aria-label="Zprávy" aria-live="polite" className="scroll-area max-h-[50dvh] min-h-40 space-y-3 pr-2">
        {messages.length === 0 && <p className="text-sm text-muted-foreground">Zatím tu nic není. Napiš první zprávu.</p>}
        {messages.map((m, index) => {
          const mine = m.senderId === me.id
          const deleted = m.deletedAt !== null
          const open = openId === m.id
          const myEmoji = myReaction(m.reactions, me.id)
          const summary = reactionSummary(m.reactions)
          const separator = index === 0 || dayKey(m.createdAt) !== dayKey(messages[index - 1]!.createdAt)
          const original = m.replyTo ? byId.get(m.replyTo.id) : undefined
          return (
            <div key={m.id}>
              {separator && (
                <p className="my-2 flex items-center gap-3 text-xs font-medium text-muted-foreground">
                  <span aria-hidden className="h-px flex-1 bg-border" />
                  <span>{dayLabel(m.createdAt)}</span>
                  <span aria-hidden className="h-px flex-1 bg-border" />
                </p>
              )}
              <div id={`msg-${m.id}`} className={cn('flex flex-col rounded-xl transition-shadow', mine ? 'items-end' : 'items-start', flashId === m.id && 'ring-2 ring-primary/60 ring-offset-2 ring-offset-background')}>
                <p className="text-xs text-muted-foreground">
                  {mine ? 'Ty' : m.senderName} · {formatTime(m.createdAt)}
                  {m.editedAt && !deleted && ' · upraveno'}
                  {(m.thread === 'secret' || m.thread.startsWith('lang:')) && m.recipients.length > 0 && ` · pro: ${m.recipients.map((r) => (r.id === me.id ? 'tebe' : r.name)).join(', ')}`}
                </p>
                <div className={cn('flex max-w-full items-end gap-1', mine && 'flex-row-reverse')}>
                  <div
                    onClick={() => !deleted && setOpenId(open ? null : m.id)}
                    className={cn(
                      'min-w-0 max-w-[calc(100%-3rem)] break-words rounded-2xl px-3 py-2',
                      deleted ? 'border border-dashed text-muted-foreground italic' : mine ? 'bg-primary text-primary-foreground' : 'bg-muted',
                    )}
                  >
                    {m.replyTo && !deleted && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          if (!m.replyTo?.hidden) jumpTo(m.replyTo!.id)
                        }}
                        disabled={m.replyTo.hidden}
                        aria-label={m.replyTo.hidden ? 'Odpověď na zprávu, kterou nevidíš' : `Přejít na zprávu od ${original?.senderName ?? m.replyTo.senderName}`}
                        className="mb-1 flex min-h-11 w-full min-w-0 flex-col justify-center rounded-lg border-l-4 border-current bg-black/10 px-2 py-1 text-left text-xs not-italic disabled:cursor-default dark:bg-white/10"
                      >
                        <span className="font-semibold">{m.replyTo.hidden ? 'Odpověď' : (original?.senderName ?? m.replyTo.senderName)}</span>
                        <span className="line-clamp-2 break-words opacity-90">{quoteText(m.replyTo, original)}</span>
                      </button>
                    )}
                    <p className="whitespace-pre-wrap break-words">{deleted ? 'Zpráva byla smazána' : m.body}</p>
                  </div>
                  {!deleted && (
                    <button
                      type="button"
                      aria-label={`Akce zprávy z ${formatTime(m.createdAt)}`}
                      aria-expanded={open}
                      onClick={() => setOpenId(open ? null : m.id)}
                      className={cn('flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground', open && 'bg-muted text-foreground')}
                    >
                      <SmilePlusIcon aria-hidden className="size-5" />
                    </button>
                  )}
                </div>

                {summary.total > 0 && !deleted && (
                  <button
                    type="button"
                    aria-label={`Reakce ${summary.total}: ${m.reactions.map((r) => `${r.emoji} ${r.users.length}`).join(', ')}`}
                    title={m.reactions.map((r) => `${r.emoji} ${r.users.map((u) => (u.id === me.id ? 'ty' : u.name)).join(', ')}`).join('\n')}
                    onClick={() => setDetailFor(m.id)}
                    className={cn('-mt-2 flex min-h-11 min-w-11 items-center justify-center', mine ? 'mr-12' : 'ml-1')}
                  >
                    <span className={cn('inline-flex h-7 items-center gap-0.5 rounded-full border bg-card px-1.5 text-sm shadow-sm', myEmoji && 'border-primary')}>
                      <span aria-hidden className="tracking-tighter">
                        {summary.emojis.join('')}
                      </span>
                      {summary.total > 1 && (
                        <span aria-hidden className="ml-0.5 text-xs tabular-nums text-muted-foreground">
                          {summary.total}
                        </span>
                      )}
                    </span>
                  </button>
                )}

                {open && !deleted && (
                  <div id={`toolbar-${m.id}`} role="toolbar" aria-label="Akce zprávy" className="mt-1 w-full max-w-md rounded-xl border bg-card p-2 shadow-sm">
                    <div role="group" aria-label="Reagovat emoji" className="flex flex-wrap gap-1">
                      {QUICK_REACTIONS.map((emoji) => (
                        <button
                          key={emoji}
                          type="button"
                          aria-label={`Reagovat ${emoji}`}
                          aria-pressed={myEmoji === emoji}
                          onClick={() => {
                            toggleReaction(m, emoji)
                            setOpenId(null)
                          }}
                          className={cn('flex size-11 items-center justify-center rounded-full text-2xl hover:bg-muted', myEmoji === emoji && 'bg-primary/15 ring-1 ring-primary')}
                        >
                          <span aria-hidden>{emoji}</span>
                        </button>
                      ))}
                      {myEmoji && !(QUICK_REACTIONS as readonly string[]).includes(myEmoji) && (
                        <button
                          type="button"
                          aria-label={`Reagovat ${myEmoji}`}
                          aria-pressed
                          onClick={() => {
                            toggleReaction(m, myEmoji)
                            setOpenId(null)
                          }}
                          className="flex size-11 items-center justify-center rounded-full bg-primary/15 text-2xl ring-1 ring-primary"
                        >
                          <span aria-hidden>{myEmoji}</span>
                        </button>
                      )}
                      <button
                        type="button"
                        aria-label="Jiné emoji"
                        onClick={() => setPickerFor(m.id)}
                        className="flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground hover:text-foreground"
                      >
                        <PlusIcon aria-hidden className="size-5" />
                      </button>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      <Button
                        variant="outline"
                        onClick={() => {
                          setOpenId(null)
                          onReply(m)
                        }}
                      >
                        <CornerUpLeftIcon aria-hidden /> Odpovědět
                      </Button>
                      <Button variant="outline" onClick={() => void copy(m)}>
                        <CopyIcon aria-hidden /> Kopírovat
                      </Button>
                      {mine && (
                        <Button
                          variant="outline"
                          onClick={() => {
                            setOpenId(null)
                            onEdit(m)
                          }}
                        >
                          <PencilIcon aria-hidden /> Upravit
                        </Button>
                      )}
                      {(mine || isDm) && (
                        <Button
                          variant="ghost"
                          onClick={() => {
                            setOpenId(null)
                            removeMessage(m)
                          }}
                        >
                          <Trash2Icon aria-hidden /> Smazat
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
      {showJump && (
        <Button
          type="button"
          size="sm"
          className="absolute bottom-2 left-1/2 -translate-x-1/2 shadow-md"
          onClick={() => {
            const el = box.current
            if (el) el.scrollTop = el.scrollHeight
            stick.current = true
            setShowJump(false)
          }}
        >
          <ArrowDownIcon aria-hidden /> Nové zprávy
        </Button>
      )}
      <EmojiPickerDialog
        open={pickerTarget !== undefined}
        current={pickerTarget ? myReaction(pickerTarget.reactions, me.id) : null}
        onClose={() => setPickerFor(null)}
        onPick={(emoji) => {
          if (pickerTarget) toggleReaction(pickerTarget, emoji)
          setPickerFor(null)
          setOpenId(null)
        }}
      />
      <ReactionsDialog
        open={detailTarget !== undefined && detailTarget.reactions.length > 0}
        reactions={detailTarget?.reactions ?? []}
        me={me}
        onClose={() => setDetailFor(null)}
        onRemove={(emoji) => {
          if (detailTarget) toggleReaction(detailTarget, emoji)
          setDetailFor(null)
        }}
      />
    </div>
  )
}
