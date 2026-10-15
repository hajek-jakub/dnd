import { cn } from '@/lib/utils'
import { characterPhotoUrl } from './api'

export function Avatar({ id, name, version, className }: { id: string; name: string; version: string | null; className?: string }) {
  const url = characterPhotoUrl(id, version)
  return url ? (
    <img src={url} alt={`Fotka postavy ${name}`} loading="lazy" className={cn('size-14 shrink-0 rounded-full border object-cover', className)} />
  ) : (
    <span
      aria-hidden
      className={cn(
        'flex size-14 shrink-0 items-center justify-center rounded-full border bg-muted text-lg font-semibold text-muted-foreground',
        className,
      )}
    >
      {name.trim().charAt(0).toUpperCase() || '?'}
    </span>
  )
}
