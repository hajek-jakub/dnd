import { Link } from 'react-router-dom'
import { PlusIcon } from 'lucide-react'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useCampaign } from '@/features/campaigns/api'
import { Avatar } from './Avatar'
import { useCharacters } from './api'
import type { CharacterListItem } from './types'

/** Družina (postavy hráčů) a NPC. Vlastní postavy a pro DM všechny mají odkaz na sheet, ostatní jen veřejný náhled. */
export function CharactersSection({ campaignId }: { campaignId: string }) {
  const { data, isPending, error } = useCharacters(campaignId)
  const { data: campaign } = useCampaign(campaignId)
  const isDm = campaign?.role === 'dm'
  const party = data?.filter((c) => c.kind !== 'npc') ?? []
  const npcs = data?.filter((c) => c.kind === 'npc') ?? []
  return (
    <>
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
          <CardTitle className="font-display text-lg">Družina</CardTitle>
          {!isDm && (
            <Link to={`/campaigns/${campaignId}/characters/new`} className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
              <PlusIcon aria-hidden /> Nová postava
            </Link>
          )}
        </CardHeader>
        <CardContent>
          {isPending && <p className="text-muted-foreground">Načítám…</p>}
          {error && <p role="alert">Postavy se nepodařilo načíst.</p>}
          {data && party.length === 0 && <p className="text-muted-foreground">V kampani zatím nejsou žádné postavy hráčů.</p>}
          <CharacterList list={party} />
        </CardContent>
      </Card>

      {(isDm || npcs.length > 0) && (
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
            <CardTitle className="font-display text-lg">NPC</CardTitle>
            {isDm && (
              <Link to={`/campaigns/${campaignId}/characters/new?npc=1`} className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
                <PlusIcon aria-hidden /> Nové NPC
              </Link>
            )}
          </CardHeader>
          <CardContent>
            {npcs.length === 0 && <p className="text-muted-foreground">Zatím žádné NPC. Za NPC hraje DM, hráči mu můžou třeba předat peníze.</p>}
            <CharacterList list={npcs} />
          </CardContent>
        </Card>
      )}
    </>
  )
}

function CharacterList({ list }: { list: CharacterListItem[] }) {
  return (
    <ul className="divide-y">
      {list.map((c) => {
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
  )
}
