import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { CheckIcon, FolderIcon, LayoutTemplateIcon, LoaderCircleIcon, PlusIcon, SendHorizontalIcon, SkullIcon, SparklesIcon, SquareIcon, Trash2Icon, XIcon } from 'lucide-react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { RichText } from '@/components/RichText'
import { Button } from '@/components/ui/button'
import { NativeSelect } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { ITEM_KIND_SHORT } from '@/features/sheet/labels'
import { ApiError } from '@/lib/api'
import { cn } from '@/lib/utils'
import {
  aiApi,
  aiConversationKey,
  aiStatusKey,
  useAiConversation,
  useAiStatus,
  useApplyProposal,
  useDiscardProposal,
  type AiConversation,
  type AiItem,
  type AiProposal,
  type AiProposalEntry,
} from './api'
import { TemplatePanel } from './TemplatePanel'

/** Pojistka proti nekonečné smyčce kroků v prohlížeči (server má vlastní limit). */
const MAX_CLIENT_STEPS = 30

/**
 * AI pomocník DM: chat, ve kterém AI hledá v pravidlech a navrhuje loot. Návrhy se ukážou jako karty a do lootu se dostanou až potvrzením.
 * Každý krok AI je jeden požadavek na server (kvůli časovému limitu PHP); prohlížeč posílá další kroky, dokud AI pracuje, a jde ho zastavit.
 */
export default function AiPanel({ campaignId, onClose }: { campaignId: string; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const stopRef = useRef(false)
  const qc = useQueryClient()
  const { data: status } = useAiStatus(campaignId, true)
  const [selected, setSelected] = useState<string | null>(() => status?.conversations[0]?.id ?? null)
  const { data: conv, isPending: loadingConv } = useAiConversation(selected)
  const [draft, setDraft] = useState('')
  const [pendingText, setPendingText] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showTemplates, setShowTemplates] = useState(false)
  const messageRef = useRef<HTMLTextAreaElement>(null)

  /** Šablona složí zprávu do pole; DM ji může upravit a pak odeslat. */
  function insertTemplate(text: string) {
    setDraft(text)
    setShowTemplates(false)
    requestAnimationFrame(() => messageRef.current?.focus())
  }

  useEffect(() => {
    const dialog = ref.current
    if (dialog && !dialog.open) dialog.showModal()
  }, [])

  const itemCount = conv?.items.length ?? 0
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [itemCount, pendingText, running, error])

  const put = (c: AiConversation) => {
    qc.setQueryData(aiConversationKey(c.id), c)
    setSelected(c.id)
  }

  /** Pošle první požadavek a pak další kroky, dokud AI pracuje (nebo dokud ji DM nezastaví). */
  async function run(start: () => Promise<{ conversation: AiConversation; error?: { message: string } }>): Promise<boolean> {
    setRunning(true)
    setError(null)
    stopRef.current = false
    try {
      let res = await start()
      put(res.conversation)
      if (res.error) {
        setError(res.error.message)
        return true
      }
      for (let i = 0; i < MAX_CLIENT_STEPS && res.conversation.state === 'working' && !stopRef.current; i++) {
        res = await aiApi.step(res.conversation.id)
        put(res.conversation)
      }
      return true
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Něco se pokazilo. Zkus to znovu.')
      return false
    } finally {
      setRunning(false)
      void qc.invalidateQueries({ queryKey: aiStatusKey(campaignId) })
    }
  }

  async function send(text: string) {
    const t = text.trim()
    if (t === '' || running) return
    setDraft('')
    setPendingText(t)
    const id = selected
    const ok = await run(() => (id ? aiApi.message(id, t) : aiApi.create(campaignId, t)))
    setPendingText(null)
    if (!ok && id) {
      // Zpráva se mohla uložit i při chybě (např. vyčerpaný rozpočet); když na serveru není, vrátí se do pole.
      const fresh = await qc.fetchQuery({ queryKey: aiConversationKey(id), queryFn: () => aiApi.get(id) }).catch(() => null)
      if (lastUserText(fresh?.items ?? []) !== t) setDraft(t)
    } else if (!ok) {
      setDraft(t)
    }
  }

  async function remove() {
    if (!selected || !window.confirm('Smazat tuhle konverzaci s AI?')) return
    try {
      await aiApi.remove(selected)
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Konverzaci se nepodařilo smazat.')
      return
    }
    qc.removeQueries({ queryKey: aiConversationKey(selected) })
    setSelected(null)
    void qc.invalidateQueries({ queryKey: aiStatusKey(campaignId) })
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void send(draft)
    }
  }

  const conversations = status?.conversations ?? []
  const items = selected ? (conv?.items ?? []) : []
  const lastActivity = [...items].reverse().find((i) => i.type === 'activity')

  return (
    <dialog
      ref={ref}
      aria-label="AI pomocník"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) ref.current?.close() // klik na pozadí
      }}
      className="fixed inset-0 m-0 h-dvh max-h-none w-full max-w-none overflow-hidden border-0 bg-background p-0 text-foreground backdrop:bg-black/50 lg:left-auto lg:w-[34rem] lg:border-l lg:shadow-xl"
    >
      <div className="flex h-full min-w-0 flex-col">
        <header className="space-y-2 border-b px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 font-display text-lg font-semibold">
              <SparklesIcon aria-hidden className="size-5 text-primary" /> AI pomocník
            </h2>
            <Button variant="ghost" size="icon" aria-label="Zavřít" onClick={() => ref.current?.close()}>
              <XIcon aria-hidden />
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <label htmlFor="ai-conversation" className="sr-only">
              Konverzace
            </label>
            <NativeSelect id="ai-conversation" value={selected ?? ''} disabled={running} onChange={(e) => setSelected(e.target.value === '' ? null : e.target.value)}>
              <option value="">Nová konverzace</option>
              {conversations.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title || 'Bez názvu'}
                </option>
              ))}
            </NativeSelect>
            <Button variant="outline" size="icon" aria-label="Nová konverzace" title="Nová konverzace" disabled={running || selected === null} onClick={() => setSelected(null)}>
              <PlusIcon aria-hidden />
            </Button>
            <Button variant="ghost" size="icon" aria-label="Smazat konverzaci" title="Smazat konverzaci" disabled={running || selected === null} onClick={() => void remove()}>
              <Trash2Icon aria-hidden />
            </Button>
          </div>
        </header>

        <div role="log" aria-label="Konverzace s AI" className="scroll-area min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
          {selected === null && pendingText === null && (
            <div className="space-y-3 text-sm">
              <p className="text-muted-foreground">
                Napiš, co chceš připravit, nebo vyber šablonu. AI dohledá nestvůry a itemy v pravidlech a navrhne přípravu do <strong className="text-foreground">Lootu</strong>: složky,
                nepřátele a loot, který z nich padá. Nic se nevytvoří, dokud návrh nepotvrdíš. Ptát se můžeš i na pravidla.
              </p>
              <TemplatePanel onInsert={insertTemplate} />
            </div>
          )}
          {selected !== null && loadingConv && <p className="text-sm text-muted-foreground">Načítám…</p>}
          {items.map((item) =>
            item.type === 'user' ? (
              <p key={item.id} className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-3 py-2 break-words whitespace-pre-wrap text-primary-foreground">
                {item.text}
              </p>
            ) : item.type === 'assistant' ? (
              <div key={item.id} className="w-fit max-w-[92%] rounded-2xl rounded-bl-sm bg-muted px-3 py-2 break-words">
                <RichText text={item.text} />
              </div>
            ) : item.type === 'activity' ? (
              <p key={item.id} className="flex items-center gap-2 text-sm text-muted-foreground">
                <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-muted-foreground/60" /> {item.text}
              </p>
            ) : (
              <ProposalCard key={item.id} proposal={item.proposal} campaignId={campaignId} conversationId={conv?.id ?? ''} onNavigate={() => ref.current?.close()} />
            ),
          )}
          {pendingText !== null && lastUserText(items) !== pendingText && (
            <p className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-sm bg-primary/80 px-3 py-2 break-words whitespace-pre-wrap text-primary-foreground">{pendingText}</p>
          )}
          {running && (
            <div role="status" className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <LoaderCircleIcon aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />
              <span>AI pracuje…{lastActivity && lastActivity.type === 'activity' ? ` ${lastActivity.text}` : ''}</span>
              <Button variant="ghost" size="sm" onClick={() => (stopRef.current = true)}>
                <SquareIcon aria-hidden /> Zastavit
              </Button>
            </div>
          )}
          {!running && conv && selected !== null && conv.state === 'stopped' && conv.notice && (
            <p role="status" className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
              {conv.notice}
            </p>
          )}
          {error && (
            <div role="alert" className="space-y-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">
              <p>{error}</p>
              {conv && selected !== null && conv.state === 'working' && (
                <Button variant="outline" size="sm" onClick={() => void run(() => aiApi.step(conv.id))}>
                  Zkusit znovu
                </Button>
              )}
            </div>
          )}
          {!running && !error && conv && selected !== null && conv.state === 'working' && (
            <div role="status" className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span>AI odpověď nedokončila.</span>
              <Button variant="outline" size="sm" onClick={() => void run(() => aiApi.step(conv.id))}>
                Pokračovat
              </Button>
            </div>
          )}
          {showTemplates && selected !== null && <TemplatePanel onInsert={insertTemplate} onClose={() => setShowTemplates(false)} />}
          <div ref={endRef} />
        </div>

        <form
          className="space-y-2 border-t px-4 py-3"
          onSubmit={(e) => {
            e.preventDefault()
            void send(draft)
          }}
        >
          <div className="flex items-end gap-2">
            <label htmlFor="ai-message" className="sr-only">
              Zpráva pro AI
            </label>
            <Textarea
              id="ai-message"
              ref={messageRef}
              value={draft}
              maxLength={4000}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Napiš, co připravit… (Shift+Enter = nový řádek)"
              className="max-h-48 min-h-20 resize-y"
            />
            <Button type="submit" size="icon" aria-label="Odeslat" disabled={running || draft.trim() === ''}>
              <SendHorizontalIcon aria-hidden />
            </Button>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-x-3">
            {status && (
              <p className="text-xs text-muted-foreground">
                Útrata tento měsíc ${status.spentUsd.toFixed(2)} z ${status.budgetUsd.toFixed(2)} · {status.model}
              </p>
            )}
            {selected !== null && (
              <Button type="button" variant="ghost" size="sm" className="min-h-11" aria-expanded={showTemplates} onClick={() => setShowTemplates((v) => !v)}>
                <LayoutTemplateIcon aria-hidden /> Šablony
              </Button>
            )}
          </div>
        </form>
      </div>
    </dialog>
  )
}

function entryDetail(e: AiProposalEntry): string {
  if (e.kind === 'gold') return e.coins ?? ''
  if (e.kind === 'enemy') return [e.cr ? `CR ${e.cr}` : null, e.ac !== null ? `AC ${e.ac}` : null, e.hpMax !== null ? `HP ${e.hpMax}` : null].filter(Boolean).join(' · ')
  return [ITEM_KIND_SHORT[e.kind] ?? e.kind, e.rarity, e.attunement ? 'attunement' : null, e.quantity > 1 ? `${e.quantity} ks` : null].filter(Boolean).join(', ')
}

function lastUserText(items: AiItem[]): string | null {
  const last = [...items].reverse().find((i) => i.type === 'user')
  return last && last.type === 'user' ? last.text : null
}

function ProposalCard({ proposal, campaignId, conversationId, onNavigate }: { proposal: AiProposal; campaignId: string; conversationId: string; onNavigate: () => void }) {
  const apply = useApplyProposal(campaignId, conversationId)
  const discard = useDiscardProposal(conversationId)
  const groups = new Map<string, AiProposalEntry[]>()
  for (const f of proposal.folders) groups.set(f, [])
  // ve složce nejdřív nepřátelé, pak loot
  for (const e of [...proposal.entries].sort((a, b) => Number(b.kind === 'enemy') - Number(a.kind === 'enemy'))) groups.set(e.folder, [...(groups.get(e.folder) ?? []), e])
  const busy = apply.isPending || discard.isPending
  const fail = (e: unknown) => toast.error(e instanceof ApiError ? e.message : 'Nepodařilo se.')

  return (
    <section aria-label={`Návrh: ${proposal.title}`} data-testid="ai-proposal" className={cn('space-y-3 rounded-xl border bg-card p-3', proposal.status === 'discarded' && 'opacity-60')}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold break-words">{proposal.title}</h3>
        <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
          {proposal.status === 'pending' ? 'Návrh' : proposal.status === 'applied' ? 'Vytvořeno' : 'Zahozeno'}
        </span>
      </div>
      <ul className="space-y-2">
        {[...groups].map(([folder, list]) => (
          <li key={folder} className="space-y-1">
            <p className="flex items-center gap-1.5 text-sm font-medium">
              <FolderIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" /> {folder === '' ? 'Nezařazené' : folder}
            </p>
            {list.length > 0 && (
              <ul className="space-y-1 border-l pl-3 text-sm">
                {list.map((e, i) => (
                  <li key={i} className="flex flex-wrap items-baseline gap-x-2">
                    {e.kind === 'enemy' && <SkullIcon aria-label="nepřítel" className="size-3.5 shrink-0 self-center text-red-600 dark:text-red-400" />}
                    <span className={cn('font-medium break-words', e.kind === 'enemy' && 'text-red-700 dark:text-red-400')}>
                      {e.kind === 'enemy' && e.count > 1 ? `${e.count}× ` : ''}
                      {e.label}
                    </span>
                    <span className="text-muted-foreground">{entryDetail(e)}</span>
                    {e.dropFrom && <span className="text-xs text-muted-foreground">padá z: {e.dropFrom}</span>}
                    {e.price && <span className="font-medium text-amber-700 dark:text-amber-400">za {e.price}</span>}
                    {e.curse && <span className="text-destructive">kletba</span>}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
      {proposal.status === 'pending' ? (
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy} onClick={() => apply.mutate(proposal.id, { onSuccess: () => toast.success('Vytvořeno v lootu.'), onError: fail })}>
            <CheckIcon aria-hidden /> {apply.isPending ? 'Vytvářím…' : 'Vytvořit v lootu'}
          </Button>
          <Button variant="ghost" disabled={busy} onClick={() => discard.mutate(proposal.id, { onError: fail })}>
            Zahodit
          </Button>
        </div>
      ) : proposal.status === 'applied' ? (
        <Link to={`/campaigns/${campaignId}/dm/loot`} onClick={onNavigate} className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline underline-offset-2">
          Otevřít loot
        </Link>
      ) : null}
    </section>
  )
}
