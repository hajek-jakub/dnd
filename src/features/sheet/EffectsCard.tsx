import { XIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ApiError } from '@/lib/api'
import { useRemoveEffect } from '@/features/dm/api'
import { DURATION_LABELS, effectLabel, formatBonus } from './effects'
import { useSheet } from './sheet-context'

/** Bonusy od DM (např. Shield of Faith). Hráč vidí odkud bonus je, zrušit ho může jen DM. */
export function EffectsCard() {
  const { character, isDm } = useSheet()
  const remove = useRemoveEffect(character.campaignId)
  if (character.effects.length === 0) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle>Bonusy od DM</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="divide-y">
          {character.effects.map((e) => (
            <li key={e.id} className="flex min-h-12 items-center justify-between gap-2 py-1">
              <span className="min-w-0">
                <span className="block font-medium">
                  {formatBonus(e.value)} {effectLabel(e.target)}
                </span>
                <span className="block truncate text-sm text-muted-foreground">
                  {e.source} · {DURATION_LABELS[e.duration]}
                </span>
              </span>
              {isDm && (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Zrušit bonus ${e.source}`}
                  title="Zrušit bonus"
                  disabled={remove.isPending}
                  onClick={() =>
                    remove.mutate(e.id, {
                      onSuccess: () => toast.success('Bonus zrušen'),
                      onError: (err) => toast.error(err instanceof ApiError ? err.message : 'Bonus se nepodařilo zrušit.'),
                    })
                  }
                >
                  <XIcon aria-hidden />
                </Button>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
