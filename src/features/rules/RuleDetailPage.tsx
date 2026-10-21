import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeftIcon, ExternalLinkIcon, PencilIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { DescriptionText } from './DescriptionText'
import { useDeleteHomebrew, useRule } from './api'
import { factsFor } from './facts'
import { KIND_LABELS } from './labels'
import { usePageTitle } from '@/lib/page-title'

export function RuleDetailPage() {
  usePageTitle('Pravidla')
  const { id } = useParams<{ id: string }>()
  const location = useLocation()
  const navigate = useNavigate()
  const { data: entry, isPending, error } = useRule(id)
  const remove = useDeleteHomebrew(id ?? '')

  // Odkazy zachovávají filtry (query string), aby se po návratu seznam nezměnil.
  const listLink = { pathname: '/rules', search: location.search }

  if (isPending) return <p className="text-muted-foreground">Načítám…</p>
  if (error || !entry) {
    return (
      <Card>
        <CardContent className="space-y-3 pt-6">
          <p role="alert">Záznam nenalezen. Možná ho autor smazal, nebo k němu nemáš přístup.</p>
          <Link to={listLink} className={buttonVariants({ variant: 'outline' })}>
            Zpět na seznam
          </Link>
        </CardContent>
      </Card>
    )
  }

  const facts = factsFor(entry)
  const missingText = !entry.isSrd && !entry.isHomebrew && entry.description === ''

  function onDelete() {
    if (!entry || !window.confirm(`Smazat „${entry.name}“? Tohle nejde vrátit.`)) return
    remove.mutate(undefined, {
      onSuccess: () => {
        toast.success('Smazáno')
        void navigate(listLink)
      },
      onError: () => toast.error('Smazání se nepodařilo'),
    })
  }

  return (
    <article className="space-y-4" aria-labelledby="rule-title">
      <Link
        to={listLink}
        className="inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground hover:text-foreground tab:hidden"
      >
        <ArrowLeftIcon aria-hidden className="size-4" /> Zpět na seznam
      </Link>

      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded-full bg-secondary px-2.5 py-0.5 font-medium text-secondary-foreground">
            {KIND_LABELS[entry.kind]}
          </span>
          {entry.isHomebrew && (
            <span className="rounded-full bg-primary px-2.5 py-0.5 font-medium text-primary-foreground">Homebrew</span>
          )}
          {!entry.isSrd && !entry.isHomebrew && (
            <span className="rounded-full border px-2.5 py-0.5">Mimo SRD · {entry.source}</span>
          )}
          {entry.isSrd && <span className="rounded-full border px-2.5 py-0.5">SRD 5.1</span>}
          {entry.visibility === 'private' && <span className="rounded-full border px-2.5 py-0.5">Soukromé</span>}
        </div>
        <h2 id="rule-title" className="text-2xl font-bold">
          {entry.name}
        </h2>
        {entry.nameCs && <p className="text-muted-foreground">{entry.nameCs}</p>}
        {entry.isHomebrew && entry.ownerName && <p className="text-sm text-muted-foreground">Autor: {entry.ownerName}</p>}
      </header>

      {facts.length > 0 && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-xl border bg-card p-4 text-sm">
          {facts.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="font-medium">{value}</dd>
            </div>
          ))}
        </dl>
      )}

      {entry.kind === 'magic_item' && typeof entry.data.header === 'string' && entry.data.header !== '' && (
        <p className="italic text-muted-foreground">{entry.data.header}</p>
      )}

      {entry.description !== '' && <DescriptionText text={entry.description} />}

      {typeof entry.data.higher_level === 'string' && entry.data.higher_level !== '' && (
        <section className="space-y-2">
          <h3 className="font-semibold">Na vyšší úrovni</h3>
          <DescriptionText text={entry.data.higher_level} />
        </section>
      )}

      {missingText && (
        <Card>
          <CardContent className="space-y-3 pt-6">
            <p>
              Popis tohoto itemu není součástí SRD, a proto ho aplikace neobsahuje. Najdeš ho v příručce{' '}
              <strong>{entry.source}</strong>
              {entry.refUrl ? ' nebo na stránce itemu na aidedd.org.' : '.'}
            </p>
            {entry.refUrl && (
              <a href={entry.refUrl} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: 'outline' })}>
                <ExternalLinkIcon aria-hidden /> Popis na aidedd.org
              </a>
            )}
          </CardContent>
        </Card>
      )}

      {entry.isSrd && entry.refUrl && (
        <a
          href={entry.refUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
        >
          <ExternalLinkIcon aria-hidden className="size-4" /> Stránka itemu na aidedd.org
        </a>
      )}

      {entry.canEdit && (
        <div className={cn('flex flex-wrap gap-2 border-t pt-4')}>
          <Link
            to={{ pathname: `/rules/${entry.id}/edit`, search: location.search }}
            className={buttonVariants({ variant: 'secondary' })}
          >
            <PencilIcon aria-hidden /> Upravit
          </Link>
          <Button variant="destructive" onClick={onDelete} disabled={remove.isPending}>
            <Trash2Icon aria-hidden /> Smazat
          </Button>
        </div>
      )}
    </article>
  )
}
