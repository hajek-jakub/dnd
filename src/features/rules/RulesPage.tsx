import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, Outlet, useLocation, useMatch, useSearchParams } from 'react-router-dom'
import { PlusIcon, SearchIcon } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect } from '@/components/ui/native-select'
import { cn } from '@/lib/utils'
import { useCampaign, useMyCampaigns } from '@/features/campaigns/api'
import { rulesetOf } from '@/features/campaigns/ruleset'
import type { RuleSummary } from '@/lib/types'
import { useRuleFacets, useRules, type RuleFilters } from './api'
import { GROUPS, HOMEBREW_KIND_LABELS, capitalize, groupById, metaLine, newWord } from './labels'

const CAMPAIGN_KEY = 'dnd-rules-campaign'

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return debounced
}

export function RulesPage() {
  const [params, setParams] = useSearchParams()
  const location = useLocation()
  const detailOpen = useMatch('/rules/:id/*') !== null
  const { data: campaigns } = useMyCampaigns()

  const group = groupById(params.get('g'))
  const urlQ = params.get('q') ?? ''
  const [queryInput, setQueryInput] = useState(urlQ)
  const debouncedQ = useDebounced(queryInput, 300)

  // Vybraná kampaň (kvůli homebrew) se pamatuje; platí jen, pokud v ní uživatel ještě je.
  const storedCampaign = typeof window !== 'undefined' ? window.localStorage.getItem(CAMPAIGN_KEY) : null
  const campaignParam = params.get('campaign') ?? storedCampaign ?? ''
  const campaignId = campaigns?.some((c) => c.id === campaignParam) ? campaignParam : ''

  function update(changes: Record<string, string | null>, options: { replace?: boolean } = { replace: true }) {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        for (const [key, value] of Object.entries(changes)) {
          if (value === null || value === '') next.delete(key)
          else next.set(key, value)
        }
        return next
      },
      { replace: options.replace },
    )
  }

  // Hledaný text se do URL zapisuje se zpožděním, ať se nepřekresluje při každém písmenu.
  // Přes ref se volá vždy aktuální update(), jinak by zastaralá kopie přepsala filtry, které si uživatel mezitím vybral.
  const latest = useRef({ update, urlQ })
  useEffect(() => {
    latest.current = { update, urlQ }
  })
  useEffect(() => {
    if (debouncedQ !== latest.current.urlQ) latest.current.update({ q: debouncedQ })
  }, [debouncedQ])

  const filters: RuleFilters = useMemo(
    () => ({
      kinds: group.kinds,
      q: urlQ,
      level: params.get('level') ?? undefined,
      category: params.get('category') ?? undefined,
      rarity: params.get('rarity') ?? undefined,
      attunement: params.get('attunement') ?? undefined,
      source: params.get('source') ?? undefined,
      tag: params.get('tag') ?? undefined,
      scope: params.get('scope') ?? undefined,
      campaignId: campaignId || undefined,
      sort: group.id === 'spells' || group.id === 'features' ? 'level' : undefined,
    }),
    [group, params, urlQ, campaignId],
  )

  const { data: campaign } = useCampaign(campaignId || undefined)
  const { data: facets } = useRuleFacets(group.kinds, campaignId || undefined)
  const { data, isPending, isFetching, error, fetchNextPage, hasNextPage, isFetchingNextPage } = useRules(filters)
  const entries = data?.pages.flatMap((p) => p.entries) ?? []
  const total = data?.pages[0]?.total ?? 0

  const hasFilters = ['level', 'category', 'rarity', 'attunement', 'source', 'tag', 'scope'].some((k) => params.get(k))
  const showLevel = group.id === 'spells' || group.id === 'features'
  const homebrewKind = group.homebrewKind

  function selectCampaign(id: string) {
    if (id) window.localStorage.setItem(CAMPAIGN_KEY, id)
    else window.localStorage.removeItem(CAMPAIGN_KEY)
    update({ campaign: id || null, scope: params.get('scope') === 'homebrew' && !id ? null : params.get('scope') })
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] lg:items-start">
      <section className={cn('min-w-0 space-y-4', detailOpen && 'hidden lg:block')} aria-label="Seznam pravidel">
        <h1 className="text-2xl font-bold">Pravidla a obsah</h1>
        {campaignId && rulesetOf(campaign?.settings) === '2024' && (
          <p data-testid="ruleset-notice" className="rounded-lg border border-amber-500 bg-amber-500/10 p-3 text-sm">
            Kampaň hraje podle pravidel 2024, ale itemy, kouzla a třídy tu jsou zatím jen ze SRD 5.1 (2014). Na kartě postavy už se
            počítá podle 2024 (martial arts kostka, monk zbraně, Focus Points); u konkrétních itemů a kouzel si rozdíly hlídej podle příručky.
          </p>
        )}

        <nav aria-label="Druh obsahu" className="-mx-4 overflow-x-auto px-4 pb-1">
          <ul className="flex gap-2">
            {GROUPS.map((g) => (
              <li key={g.id} className="shrink-0">
                <button
                  type="button"
                  aria-pressed={g.id === group.id}
                  onClick={() => {
                    setQueryInput('')
                    setParams(
                      (prev) => {
                        // Při přepnutí skupiny se zahodí filtry, zůstává jen výběr kampaně.
                        const next = new URLSearchParams()
                        next.set('g', g.id)
                        if (prev.get('campaign')) next.set('campaign', prev.get('campaign')!)
                        return next
                      },
                      { replace: true },
                    )
                  }}
                  className={cn(
                    'inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-medium transition-colors',
                    g.id === group.id ? 'border-primary bg-primary text-primary-foreground' : 'bg-background hover:bg-muted',
                  )}
                >
                  {g.label}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <div className="relative">
          <SearchIcon
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            aria-label="Hledat podle názvu"
            placeholder="Hledat podle názvu…"
            className="pl-9"
            value={queryInput}
            onChange={(e) => setQueryInput(e.target.value)}
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          {showLevel && facets && facets.levels.length > 0 && (
            <NativeSelect
              aria-label={group.id === 'spells' ? 'Úroveň' : 'Level'}
              value={params.get('level') ?? ''}
              onChange={(e) => update({ level: e.target.value })}
            >
              <option value="">{group.id === 'spells' ? 'Všechny úrovně' : 'Všechny levely'}</option>
              {facets.levels.map((l) => (
                <option key={l} value={l}>
                  {group.id === 'spells' && l === 0 ? 'Cantrip' : `Level ${l}`}
                </option>
              ))}
            </NativeSelect>
          )}
          {facets && facets.categories.length > 1 && group.id !== 'features' && group.id !== 'classes' && (
            <NativeSelect
              aria-label={group.id === 'spells' ? 'Škola' : 'Kategorie'}
              value={params.get('category') ?? ''}
              onChange={(e) => update({ category: e.target.value })}
            >
              <option value="">{group.id === 'spells' ? 'Všechny školy' : 'Všechny kategorie'}</option>
              {facets.categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </NativeSelect>
          )}
          {facets && facets.tags.length > 0 && (group.id === 'spells' || group.id === 'features') && (
            <NativeSelect aria-label="Třída" value={params.get('tag') ?? ''} onChange={(e) => update({ tag: e.target.value })}>
              <option value="">Všechny třídy</option>
              {facets.tags.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </NativeSelect>
          )}
          {group.id === 'items' && facets && (
            <>
              <NativeSelect
                aria-label="Vzácnost"
                value={params.get('rarity') ?? ''}
                onChange={(e) => update({ rarity: e.target.value })}
              >
                <option value="">Všechny vzácnosti</option>
                {facets.rarities.map((r) => (
                  <option key={r} value={r}>
                    {capitalize(r)}
                  </option>
                ))}
              </NativeSelect>
              <NativeSelect
                aria-label="Attunement"
                value={params.get('attunement') ?? ''}
                onChange={(e) => update({ attunement: e.target.value })}
              >
                <option value="">Attunement: vše</option>
                <option value="1">Vyžaduje attunement</option>
                <option value="0">Bez attunementu</option>
              </NativeSelect>
              <NativeSelect
                aria-label="Zdroj"
                value={params.get('source') ?? ''}
                onChange={(e) => update({ source: e.target.value })}
              >
                <option value="">Všechny zdroje</option>
                {facets.sources.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </NativeSelect>
            </>
          )}
          <NativeSelect
            aria-label="Původ obsahu"
            value={params.get('scope') ?? ''}
            onChange={(e) => update({ scope: e.target.value })}
          >
            <option value="">Všechen obsah</option>
            <option value="srd">Jen SRD 5.1</option>
            {group.id === 'items' && <option value="other">Mimo SRD (jen fakta)</option>}
            {campaignId && <option value="homebrew">Jen homebrew</option>}
          </NativeSelect>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-0 flex-1 space-y-1">
            <label htmlFor="rules-campaign" className="text-sm text-muted-foreground">
              Homebrew z kampaně
            </label>
            <NativeSelect id="rules-campaign" value={campaignId} onChange={(e) => selectCampaign(e.target.value)}>
              <option value="">Žádná (jen oficiální obsah)</option>
              {campaigns?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          {campaignId && homebrewKind && (
            <Link
              to={{ pathname: '/rules/new', search: `?kind=${homebrewKind}&campaign=${campaignId}&g=${group.id}` }}
              className={buttonVariants({ variant: 'secondary' })}
            >
              <PlusIcon aria-hidden /> {newWord(homebrewKind)} {HOMEBREW_KIND_LABELS[homebrewKind]}
            </Link>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground" role="status" aria-live="polite">
          <span>
            {isPending ? 'Načítám…' : `${total} ${total === 1 ? 'záznam' : total >= 2 && total <= 4 ? 'záznamy' : 'záznamů'}`}
            {isFetching && !isPending && ' · aktualizuji…'}
          </span>
          {hasFilters && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                update({ level: null, category: null, rarity: null, attunement: null, source: null, tag: null, scope: null })
              }
            >
              Zrušit filtry
            </Button>
          )}
        </div>

        {error && (
          <p role="alert" className="text-destructive">
            Seznam se nepodařilo načíst.
          </p>
        )}

        <ul className="space-y-2">
          {entries.map((entry) => (
            <RuleListItem key={entry.id} entry={entry} search={location.search} />
          ))}
        </ul>
        {!isPending && entries.length === 0 && !error && (
          <p className="text-muted-foreground">Nic nenalezeno. Zkus upravit hledání nebo filtry.</p>
        )}

        {hasNextPage && (
          <Button variant="outline" className="w-full" onClick={() => void fetchNextPage()} disabled={isFetchingNextPage}>
            {isFetchingNextPage ? 'Načítám…' : `Načíst další (${entries.length} z ${total})`}
          </Button>
        )}
      </section>

      <section className={cn('min-w-0 lg:sticky lg:top-20', !detailOpen && 'hidden lg:block')} aria-label="Detail">
        {detailOpen ? (
          <Outlet />
        ) : (
          <p className="hidden rounded-xl border border-dashed p-8 text-center text-muted-foreground lg:block">
            Vyber položku ze seznamu.
          </p>
        )}
      </section>
    </div>
  )
}

function RuleListItem({ entry, search }: { entry: RuleSummary; search: string }) {
  const active = useMatch(`/rules/${entry.id}`)
  return (
    <li>
      <Link
        to={{ pathname: `/rules/${entry.id}`, search }}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'block min-h-16 rounded-xl border bg-card p-3 transition-colors hover:bg-muted',
          active && 'border-primary bg-muted',
        )}
      >
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{entry.name}</span>
          {entry.isHomebrew && (
            <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground">Homebrew</span>
          )}
          {!entry.isSrd && !entry.isHomebrew && <span className="rounded-full border px-2 py-0.5 text-xs">{entry.source}</span>}
        </span>
        <span className="mt-0.5 block text-sm text-muted-foreground">{metaLine(entry)}</span>
        {entry.summary && <span className="mt-1 line-clamp-2 block text-sm text-muted-foreground/90">{entry.summary}</span>}
      </Link>
    </li>
  )
}
