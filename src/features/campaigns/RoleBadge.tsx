import { cn } from '@/lib/utils'

export function RoleBadge({ role, className }: { role: 'dm' | 'player'; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
        role === 'dm' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground',
        className,
      )}
    >
      {role === 'dm' ? 'Dungeon Master' : 'Hráč'}
    </span>
  )
}
