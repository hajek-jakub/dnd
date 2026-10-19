import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { SearchIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Input } from '@/components/ui/input'
import { useRules } from '@/features/rules/api'
import { api, ApiError } from '@/lib/api'
import type { EnemyTemplate, RuleDetail } from '@/lib/types'

/** Hledání nestvůry ze SRD; vybraná vrátí šablonu nepřítele (HP, AC, iniciativa, útoky, poznámka, CR). */
export function MonsterPicker({ onPick }: { onPick: (template: EnemyTemplate) => void }) {
  const [text, setText] = useState('')
  const [q, setQ] = useState('')
  const queryClient = useQueryClient()
  const [loading, setLoading] = useState<string | null>(null)
  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), 250)
    return () => clearTimeout(t)
  }, [text])
  const rules = useRules({ kinds: ['monster'], q: q || undefined })
  const entries = rules.data?.pages[0]?.entries.slice(0, 8) ?? []

  async function pick(id: string) {
    setLoading(id)
    try {
      const entry = await queryClient.fetchQuery({ queryKey: ['rule', id], queryFn: async () => (await api.get<{ entry: RuleDetail }>(`/rules/${id}`)).entry })
      if (entry.enemyTemplate) onPick(entry.enemyTemplate)
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Nestvůru se nepodařilo načíst.')
    } finally {
      setLoading(null)
    }
  }

  return (
    <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
      <div className="relative">
        <SearchIcon aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input aria-label="Hledat nestvůru" className="pl-9" placeholder="Goblin, Ogre, Skeleton…" value={text} autoFocus onChange={(e) => setText(e.target.value)} />
      </div>
      <ul className="scroll-area max-h-64 space-y-1 overflow-y-auto" aria-label="Nestvůry ze SRD">
        {entries.map((e) => (
          <li key={e.id}>
            <button
              type="button"
              disabled={loading !== null}
              onClick={() => void pick(e.id)}
              aria-label={`Použít ${e.name}`}
              className="flex min-h-11 w-full flex-col items-start rounded-lg px-3 py-2 text-left hover:bg-muted disabled:opacity-60"
            >
              <span className="font-medium">{loading === e.id ? `${e.name}…` : e.name}</span>
              <span className="text-xs text-muted-foreground">{e.summary.split('\n')[0]}</span>
            </button>
          </li>
        ))}
      </ul>
      {!rules.isPending && entries.length === 0 && <p className="text-sm text-muted-foreground">Nic nenalezeno. Nestvůry jsou anglicky (SRD 5.1).</p>}
    </div>
  )
}
