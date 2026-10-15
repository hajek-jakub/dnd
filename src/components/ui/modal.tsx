import { useEffect, useRef, type ReactNode } from 'react'
import { XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'

/** Dialog postavený na nativním <dialog>: focus trap, Esc a čtečky obrazovky fungují samy. */
export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      aria-label={title}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose() // klik na pozadí
      }}
      className="m-auto w-[calc(100%-2rem)] max-w-lg overflow-hidden rounded-2xl border bg-background p-0 text-foreground shadow-xl backdrop:bg-black/50"
    >
      {open && (
        <div className="scroll-area max-h-[85dvh] p-5 pr-3">
          <div className="mb-4 flex items-start justify-between gap-3">
            <h2 className="text-lg font-semibold">{title}</h2>
            <Button variant="ghost" size="icon" aria-label="Zavřít" onClick={onClose}>
              <XIcon aria-hidden />
            </Button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  )
}
