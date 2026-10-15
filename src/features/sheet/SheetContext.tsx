import { useCallback, useMemo, type ReactNode } from 'react'
import { toast } from 'sonner'
import type { RulesBundle } from '@/engine'
import { useAuth } from '@/features/auth/auth-context'
import { useCampaign } from '@/features/campaigns/api'
import { engineRulesOf } from '@/features/campaigns/ruleset'
import { ApiError } from '@/lib/api'
import { useAdjust, useUpdateCharacter } from './api'
import { deriveSheet } from './model'
import { SheetContext, type SheetContextValue } from './sheet-context'
import type { AdjustOp, CharacterFull } from './types'

export function SheetProvider({ character, bundle, children }: { character: CharacterFull; bundle: RulesBundle; children: ReactNode }) {
  const { user } = useAuth()
  const { data: campaign } = useCampaign(character.campaignId)
  const adjustMutation = useAdjust(character.id)
  const updateMutation = useUpdateCharacter(character.id)

  const isDm = campaign?.role === 'dm'
  const canEdit = isDm || character.ownerId === user?.id
  const rules = useMemo(() => engineRulesOf(campaign?.settings), [campaign?.settings])
  const { sheet, hpCurrent } = useMemo(() => deriveSheet(character, bundle, rules), [character, bundle, rules])

  const onError = useCallback((e: Error) => toast.error(e instanceof ApiError ? e.message : 'Změna se nepodařila a vrátila se zpět.'), [])
  const adjust = useCallback((ops: AdjustOp[]) => adjustMutation.mutate(ops, { onError }), [adjustMutation, onError])
  const update = useCallback<SheetContextValue['update']>((patch) => updateMutation.mutate(patch, { onError }), [updateMutation, onError])
  const setOverride = useCallback(
    (key: string, value: number | null) => {
      const next = { ...character.overrides }
      if (value === null) delete next[key]
      else next[key] = value
      update({ overrides: next })
    },
    [character.overrides, update],
  )

  const value = useMemo<SheetContextValue>(
    () => ({ character, bundle, sheet, hpCurrent, canEdit, isDm, adjust, update, setOverride }),
    [character, bundle, sheet, hpCurrent, canEdit, isDm, adjust, update, setOverride],
  )
  return <SheetContext.Provider value={value}>{children}</SheetContext.Provider>
}
