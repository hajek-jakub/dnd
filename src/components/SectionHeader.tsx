import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** Nadpis sekce a vpravo tlačítka akcí (u všech sekcí stejně, na telefonu se zalomí pod nadpis). */
export function SectionHeader({ title, actions, level = 2, className }: { title: ReactNode; actions?: ReactNode; level?: 1 | 2; className?: string }) {
  const Heading = level === 1 ? 'h1' : 'h2'
  return (
    <div className={cn('flex flex-wrap items-center justify-between gap-2', className)}>
      <Heading className={level === 1 ? 'text-2xl font-bold' : 'font-display text-xl font-semibold'}>{title}</Heading>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}
