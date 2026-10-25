import { describe, expect, it } from 'vitest'
import type { ChatMessage, MessagesState, Reaction } from './api'
import { dayLabel, isEmojiOnly, isSingleEmoji, mergeMessages, myReaction, reactionSummary, timeDivider, toggleReaction } from './chat-utils'

const me = { id: 'u1', name: 'Bob' }
const other = { id: 'u2', name: 'Carol' }

const msg = (id: number, extra: Partial<ChatMessage> = {}): ChatMessage => ({
  id,
  senderId: 'u2',
  senderName: 'Carol',
  thread: 'group',
  recipients: [],
  body: `zpráva ${id}`,
  createdAt: '2026-10-25T10:00:00Z',
  editedAt: null,
  deletedAt: null,
  replyTo: null,
  reactions: [],
  ...extra,
})
const state = (messages: ChatMessage[], extra: Partial<MessagesState> = {}): MessagesState => ({ messages, unread: {}, languages: [], ...extra })

describe('reakce', () => {
  it('jako na Messengeru: jedna reakce na uživatele, jiné emoji ji nahradí, stejné zruší', () => {
    let r: Reaction[] = []
    r = toggleReaction(r, '👍', me)
    expect(r).toEqual([{ emoji: '👍', users: [me] }])
    r = toggleReaction(r, '👍', other)
    expect(r[0]!.users).toEqual([me, other])
    r = toggleReaction(r, '🐉', me)
    expect(r).toEqual([
      { emoji: '👍', users: [other] },
      { emoji: '🐉', users: [me] },
    ])
    r = toggleReaction(r, '🐉', me)
    expect(r).toEqual([{ emoji: '👍', users: [other] }])
    r = toggleReaction(r, '👍', other)
    expect(r).toEqual([])
  })

  it('nemění původní pole a ví, čím jsem reagoval', () => {
    const before: Reaction[] = [{ emoji: '🔥', users: [me] }]
    toggleReaction(before, '😂', me)
    expect(before[0]!.users).toEqual([me])
    expect(myReaction([...before, { emoji: '🎲', users: [other] }], me.id)).toBe('🔥')
    expect(myReaction([{ emoji: '🎲', users: [other] }], me.id)).toBeNull()
  })

  it('souhrn do jedné bubliny: nejčastější emoji (nejvýš 3) a celkový počet', () => {
    const third = { id: 'u3', name: 'Dan' }
    const fourth = { id: 'u4', name: 'Eva' }
    expect(reactionSummary([])).toEqual({ emojis: [], total: 0 })
    expect(
      reactionSummary([
        { emoji: '👍', users: [me] },
        { emoji: '🔥', users: [other, third] },
        { emoji: '😂', users: [fourth] },
        { emoji: '🎲', users: [{ id: 'u5', name: 'F' }] },
      ]),
    ).toEqual({ emojis: ['🔥', '👍', '😂'], total: 5 })
  })

  it('vlastní emoji: právě jedno, včetně barvy pleti, vlajek a sekvencí; text ne', () => {
    for (const ok of ['👍', '❤️', '👨‍👩‍👧', '🇨🇿', '👍🏽', '1️⃣', '🐉', '⚔️', '🏴󠁧󠁢󠁥󠁮󠁧󠁿']) expect(isSingleEmoji(ok), ok).toBe(true)
    for (const bad of ['', 'x', 'ab', '👍👍', 'a👍', '<b>', '1', '#', '\u200D']) expect(isSingleEmoji(bad), bad).toBe(false)
  })
})

describe('skládání průběžných odpovědí', () => {
  it('přidá nové zprávy a nezdvojí známé', () => {
    const prev = state([msg(1), msg(2)])
    const merged = mergeMessages(prev, state([msg(2), msg(3)], { unread: { group: 1 } }), 1)
    expect(merged.messages.map((m) => m.id)).toEqual([1, 2, 3])
    expect(merged.unread).toEqual({ group: 1 })
  })

  it('přepíše reakce, úpravu a smazání podle marks, zpráva bez marks přijde o reakce', () => {
    const prev = state([msg(1, { reactions: [{ emoji: '👍', users: [me] }] }), msg(2, { reactions: [{ emoji: '🔥', users: [me] }] }), msg(3)])
    const marks = [
      { id: 2, body: 'nový text', editedAt: '2026-10-25T10:05:00Z', deletedAt: null, reactions: [{ emoji: '❤️', users: [other] }] },
      { id: 3, body: '', editedAt: null, deletedAt: '2026-10-25T10:06:00Z', reactions: [] },
    ]
    const merged = mergeMessages(prev, state([], { marks }), 1)
    expect(merged.messages[0]!.reactions).toEqual([]) // reakce zrušena
    expect(merged.messages[1]).toMatchObject({ body: 'nový text', editedAt: expect.any(String), reactions: [{ emoji: '❤️' }] })
    expect(merged.messages[2]).toMatchObject({ body: '', deletedAt: expect.any(String) })
  })

  it('zprávy před `from` a odpověď bez `from` nic nemění', () => {
    const prev = state([msg(1, { reactions: [{ emoji: '👍', users: [me] }] }), msg(2)])
    expect(mergeMessages(prev, state([], { marks: [] }), 2).messages[0]!.reactions).toHaveLength(1)
    expect(mergeMessages(prev, state([]), 0).messages[0]!.reactions).toHaveLength(1)
  })
})

describe('oddělovače dnů', () => {
  const now = new Date(2026, 9, 25, 12, 0, 0)
  it('Dnes, Včera a datum', () => {
    expect(dayLabel(new Date(2026, 9, 25, 8).toISOString(), now)).toBe('Dnes')
    expect(dayLabel(new Date(2026, 9, 24, 23, 59).toISOString(), now)).toBe('Včera')
    expect(dayLabel(new Date(2026, 9, 20, 8).toISOString(), now)).toBe('20. 10. 2026')
  })

  it('čas jen na začátku dne a po pauze aspoň 15 minut', () => {
    const at = (h: number, m: number, day = 25) => new Date(2026, 9, day, h, m).toISOString()
    expect(timeDivider(undefined, at(9, 5), now)).toBe('Dnes 09:05')
    expect(timeDivider(at(23, 50, 24), at(0, 10), now)).toBe('Dnes 00:10')
    expect(timeDivider(at(9, 5), at(9, 19), now)).toBeNull()
    expect(timeDivider(at(9, 5), at(9, 20), now)).toBe('09:20')
    expect(timeDivider(undefined, at(20, 0, 24), now)).toBe('Včera 20:00')
  })
})

describe('isEmojiOnly', () => {
  it('1 až 3 emoji (i s mezerami) ano, text, víc emoji nebo číslo ne', () => {
    expect(['🍺', '😀😀😀', '👍 ❤️', '👨‍👩‍👧', '🇨🇿'].every(isEmojiOnly)).toBe(true)
    expect(['', 'Ok', 'Super 👍', '😀😀😀😀', '1', '  '].some(isEmojiOnly)).toBe(false)
  })
})
