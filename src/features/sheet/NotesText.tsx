import { isUnconfirmed, stripUnconfirmed } from './unconfirmed'

/** Poznámky po řádcích; řádky označené TO_CONFIRM dostanou štítek "ke ověření". */
export function NotesText({ text, className }: { text: string; className?: string }) {
  const lines = text.split('\n')
  return (
    <div className={className}>
      {lines.map((line, i) =>
        isUnconfirmed(line) ? (
          <p key={i} data-testid="unconfirmed">
            <span className="mr-2 rounded-full border border-amber-500 bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-foreground">ke ověření</span>
            {stripUnconfirmed(line)}
          </p>
        ) : (
          <p key={i} className="whitespace-pre-line">
            {line}
          </p>
        ),
      )}
    </div>
  )
}

export function NotFilled({ children = 'nedoplněno' }: { children?: string }) {
  return <span className="italic text-muted-foreground">{children}</span>
}
