import type { ChatMessage, MessagesState, Reaction } from './api'

/** Rychlé reakce v akcích zprávy (jako na Messengeru); jakékoli jiné emoji jde vybrat přes „+“. */
export const QUICK_REACTIONS = ['\u{1F44D}', '\u{2764}\u{FE0F}', '\u{1F602}', '\u{1F62E}', '\u{1F622}', '\u{1F525}'] as const

/** Nabídka emoji ve výběru, po skupinách (vlastní jde i napsat nebo vložit). */
export const EMOJI_GROUPS: { name: string; emojis: string[] }[] = [
  { name: 'Výrazy', emojis: ['😀', '😁', '😂', '🤣', '😊', '😍', '🥰', '😘', '😎', '🤩', '🥳', '😏', '🙄', '😬', '😮', '😱', '😢', '😭', '😡', '🤬', '🤯', '🥶', '🤢', '😴', '🤔', '🫡', '🤐', '😇', '😈', '💀'] },
  { name: 'Gesta', emojis: ['👍', '👎', '👏', '🙌', '🙏', '🤝', '💪', '✌️', '🤞', '👌', '🤌', '👀', '🫶', '✋', '🖐️', '🤘'] },
  { name: 'Dobrodružství', emojis: ['🎲', '⚔️', '🗡️', '🛡️', '🏹', '🪓', '🔮', '🧪', '📜', '🗺️', '🧙', '🧝', '🧌', '🐉', '👑', '💰', '🪙', '💎', '🍺', '🍖', '🏰', '🕯️', '🔥', '⚡', '❄️', '🌙', '☠️', '🩸', '💥', '✨'] },
  { name: 'Symboly', emojis: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '💔', '💯', '✅', '❌', '❓', '❗', '⭐', '🎉', '🏆'] },
]

const EMOJI_PART =
  '\\u00A9\\u00AE\\u203C\\u2049\\u2122\\u2139\\u2194-\\u21AA\\u231A-\\u23FF\\u24C2\\u25AA-\\u25FE\\u2600-\\u27BF\\u2934\\u2935\\u2B00-\\u2BFF\\u3030\\u303D\\u3297\\u3299\\u{1F000}-\\u{1FAFF}'
const EMOJI_ALLOWED = new RegExp(`^[${EMOJI_PART}\\u200D\\uFE0F\\u20E3\\u{1F3FB}-\\u{1F3FF}\\u{E0020}-\\u{E007F}#*0-9]+$`, 'u')
const EMOJI_CORE = new RegExp(`[${EMOJI_PART}\\u20E3]`, 'u')

/** Je text právě jedno emoji? Stejné pravidlo jako `MessageController::isEmoji` na serveru. */
export function isSingleEmoji(value: string): boolean {
  if (value === '' || value.length > 32) return false
  const graphemes = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value)]
  return graphemes.length === 1 && EMOJI_ALLOWED.test(value) && EMOJI_CORE.test(value)
}

/** Zpráva jen z 1 až 3 emoji (mezery nevadí): ukáže se velká a bez bubliny jako na Messengeru. */
export function isEmojiOnly(body: string): boolean {
  const text = body.replace(/\s+/g, '')
  if (text === '' || text.length > 40) return false
  const graphemes = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].map((g) => g.segment)
  return graphemes.length <= 3 && graphemes.every(isSingleEmoji)
}

/** Reakce uživatele jako na Messengeru: každý má u zprávy jednu, jiné emoji ji nahradí, stejné ji zruší. Pro optimistickou aktualizaci. */
export function toggleReaction(reactions: Reaction[], emoji: string, me: { id: string; name: string }): Reaction[] {
  const had = reactions.some((r) => r.emoji === emoji && r.users.some((u) => u.id === me.id))
  const without = reactions.map((r) => ({ ...r, users: r.users.filter((u) => u.id !== me.id) })).filter((r) => r.users.length > 0)
  if (had) return without
  return without.some((r) => r.emoji === emoji) ? without.map((r) => (r.emoji === emoji ? { ...r, users: [...r.users, me] } : r)) : [...without, { emoji, users: [me] }]
}

/** Moje reakce na zprávu (nejvýš jedna), nebo null. */
export function myReaction(reactions: Reaction[], userId: string): string | null {
  return reactions.find((r) => r.users.some((u) => u.id === userId))?.emoji ?? null
}

/** Souhrn do jedné bubliny reakcí: nejčastější emoji (nejvýš 3) a celkový počet reakcí. */
export function reactionSummary(reactions: Reaction[]): { emojis: string[]; total: number } {
  const sorted = [...reactions].sort((a, b) => b.users.length - a.users.length)
  return { emojis: sorted.slice(0, 3).map((r) => r.emoji), total: reactions.reduce((sum, r) => sum + r.users.length, 0) }
}

const RECENT_KEY = 'dnd.recentEmoji'

/** Naposledy použitá emoji z výběru (v tomto prohlížeči). */
export function recentEmojis(): string[] {
  try {
    const list: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')
    return Array.isArray(list) ? list.filter((e): e is string => typeof e === 'string' && isSingleEmoji(e)).slice(0, 8) : []
  } catch {
    return []
  }
}

export function rememberEmoji(emoji: string): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([emoji, ...recentEmojis().filter((e) => e !== emoji)].slice(0, 8)))
  } catch {
    // úložiště může být vypnuté, výběr funguje i bez něj
  }
}

/**
 * Složí odpověď průběžného dotazu k tomu, co už klient má: nové zprávy se přidají a zprávám od `from` se přepíše stav, který se mohl změnit
 * (reakce, úprava, smazání). Zpráva, která v `marks` chybí, nemá reakce ani úpravy; mimo rozsah (před `from`) se nic nemění.
 */
export function mergeMessages(prev: MessagesState, res: MessagesState, from: number): MessagesState {
  const known = new Set(prev.messages.map((m) => m.id))
  const marks = new Map((res.marks ?? []).map((m) => [m.id, m]))
  const updated = prev.messages.map((m): ChatMessage => {
    if (from <= 0 || m.id < from) return m
    const mark = marks.get(m.id)
    if (!mark) return m.reactions.length > 0 ? { ...m, reactions: [] } : m
    return { ...m, body: mark.body, editedAt: mark.editedAt, deletedAt: mark.deletedAt, reactions: mark.reactions }
  })
  return { messages: [...updated, ...res.messages.filter((m) => !known.has(m.id))], unread: res.unread, languages: res.languages }
}

/** Den zprávy jako klíč (místní čas), podle něj se zprávy dělí oddělovači dnů. */
export function dayKey(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}

/** „Dnes“, „Včera“, jinak datum („25. 10. 2026“). */
export function dayLabel(iso: string, now: Date = new Date()): string {
  const d = new Date(iso)
  if (dayKey(iso) === dayKey(now.toISOString())) return 'Dnes'
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (dayKey(iso) === dayKey(yesterday.toISOString())) return 'Včera'
  return d.toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric' })
}

/** Pauza v konverzaci, po které se nad další zprávou ukáže čas (jako na Messengeru). */
export const TIME_GAP_MS = 15 * 60_000

const clock = (iso: string) => new Date(iso).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' })

/**
 * Oddělovač nad zprávou místo času u každé zprávy: na začátku dne den a čas („Dnes 21:30“), po pauze aspoň 15 minut jen čas,
 * jinak nic (rychlá výměna zpráv tak nezabírá místo; přesný čas je v akcích zprávy).
 */
export function timeDivider(prevIso: string | undefined, iso: string, now: Date = new Date()): string | null {
  if (prevIso === undefined || dayKey(prevIso) !== dayKey(iso)) return `${dayLabel(iso, now)} ${clock(iso)}`
  return new Date(iso).getTime() - new Date(prevIso).getTime() >= TIME_GAP_MS ? clock(iso) : null
}

/** Čas zprávy: dnes jen hodiny, jinak i datum. */
export function formatTime(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  const time = d.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' })
  return d.toDateString() === today.toDateString() ? time : `${d.toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric' })} ${time}`
}

