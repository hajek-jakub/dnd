import { Link } from 'react-router-dom'
import { PlusIcon } from 'lucide-react'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Avatar } from './Avatar'
import { useCharacters } from './api'

/** Postavy v kampani: vlastní a (pro DM) všechny s odkazem na sheet, ostatní jen veřejný náhled. */
export function CharactersSection({ campaignId }: { campaignId: string }) {
  const { data, isPending, error } = useCharacters(campaignId)
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="font-display text-lg">Družina</CardTitle>
        <Link to={`/campaigns/${campaignId}/characters/new`} className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
          <PlusIcon aria-hidden /> Nová postava
        </Link>
      </CardHeader>
      <CardContent>
        {isPending && <p className="text-muted-foreground">Načítám…</p>}
        {error && <p role="alert">Postavy se nepodařilo načíst.</p>}
        {data?.length === 0 && <p className="text-muted-foreground">V kampani zatím nejsou žádné postavy.</p>}
        <ul className="divide-y">
          {data?.map((c) => {
            const body = (
              <>
                <Avatar id={c.id} name={c.name} version={c.photoVersion} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{c.name}</span>
                  <span className="block truncate text-sm text-muted-foreground">
                    {[c.race, c.classSummary].filter(Boolean).join(' · ')} · level {c.level}
                  </span>
                </span>
              </>
            )
            return (
              <li key={c.id}>
                {c.access === 'full' ? (
                  <Link to={`/characters/${c.id}`} className="flex min-h-16 items-center gap-3 py-2 hover:bg-muted/50">
                    {body}
                  </Link>
                ) : (
                  <div className="flex min-h-16 items-center gap-3 py-2">{body}</div>
                )}
              </li>
            )
          })}
        </ul>
      </CardContent>
    </Card>
  )
}
