import { useState } from 'react'
import { Composer, type ThreadInfo } from './Composer'
import { MessageList } from './MessageList'
import type { ChatMessage } from './api'

/** Jedno vlákno: seznam zpráv a psaní. Drží, na co se právě odpovídá nebo co se upravuje (při změně vlákna se zahodí, `key` v rodiči). */
export function ThreadChat({
  campaignId,
  thread,
  messages,
  me,
  isDm,
  recipientsForDm,
  dmId,
}: {
  campaignId: string
  thread: ThreadInfo
  messages: ChatMessage[]
  me: { id: string; name: string }
  isDm: boolean
  recipientsForDm: { userId: string; displayName: string }[]
  dmId: string | undefined
}) {
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null)
  const [editing, setEditing] = useState<ChatMessage | null>(null)
  return (
    <>
      <MessageList
        campaignId={campaignId}
        messages={messages}
        me={me}
        isDm={isDm}
        onReply={(m) => {
          setEditing(null)
          setReplyTo(m)
        }}
        onEdit={(m) => {
          setReplyTo(null)
          setEditing(m)
        }}
      />
      <Composer
        campaignId={campaignId}
        thread={thread}
        isDm={isDm}
        recipientsForDm={recipientsForDm}
        dmId={dmId}
        replyTo={replyTo}
        editing={editing}
        onCancelReply={() => setReplyTo(null)}
        onDoneEdit={() => setEditing(null)}
      />
    </>
  )
}
