import type { Sender } from './senders'
import { cn } from '@/lib/utils'

export function SenderAvatar({ sender, fallbackName, className }: { sender: Sender | undefined; fallbackName: string; className?: string }) {
  const name = sender?.name ?? fallbackName
  const base = cn('size-10 shrink-0 rounded-full border', className)
  if (sender?.photoUrl) return <img src={sender.photoUrl} alt="" title={name} loading="lazy" decoding="async" className={cn(base, 'object-cover')} data-testid="sender-avatar" />
  return (
    <span
      aria-hidden
      title={name}
      data-testid="sender-avatar"
      className={cn(base, 'flex items-center justify-center text-xs font-bold', sender?.dm ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground')}
    >
      {sender?.dm ? 'DM' : name.trim().charAt(0).toUpperCase() || '?'}
    </span>
  )
}
