import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

/** Společný rámec přihlašovací a registrační stránky. */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-6 p-4">
      <div className="space-y-1 text-center">
        <h1 className="text-3xl font-bold tracking-tight">D&amp;D kampaně</h1>
        <p className="text-muted-foreground">Postavy, kostky a mapy pro tvoji družinu.</p>
      </div>
      {children}
      <p className="text-center text-sm text-muted-foreground">
        <Link to="/about" className="inline-flex min-h-11 items-center underline underline-offset-4 hover:text-foreground">
          O aplikaci a licence SRD 5.1
        </Link>
      </p>
    </main>
  )
}
