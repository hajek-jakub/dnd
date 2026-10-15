import { Loader2Icon } from 'lucide-react'

export function FullPageSpinner() {
  return (
    <div role="status" aria-label="Načítám" className="flex min-h-dvh items-center justify-center">
      <Loader2Icon className="size-8 animate-spin text-muted-foreground" aria-hidden />
    </div>
  )
}
