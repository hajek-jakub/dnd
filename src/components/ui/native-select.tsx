import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

/** Nativní <select> ve stylu Input: na telefonu otevře systémový výběr, což je pohodlnější než vlastní menu. */
export function NativeSelect({ className, ...props }: ComponentProps<'select'>) {
  return (
    <select
      data-slot="native-select"
      className={cn(
        'h-11 w-full min-w-0 rounded-lg border border-input bg-background px-3 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive dark:bg-input/30 md:text-sm',
        className,
      )}
      {...props}
    />
  )
}
