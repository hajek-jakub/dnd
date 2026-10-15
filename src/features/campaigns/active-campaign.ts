import { useEffect } from 'react'
import { useMatch } from 'react-router-dom'
import type { CampaignSummary } from '@/lib/types'
import { useMyCampaigns } from './api'

const KEY = 'dnd-active-campaign'
const CHARACTER_KEY = 'dnd-active-character'

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // úložiště nemusí být dostupné (soukromý režim); aplikace funguje i bez zapamatování
  }
}

export const rememberCampaign = (id: string) => write(KEY, id)
export const rememberCharacter = (campaignId: string, characterId: string) => write(`${CHARACTER_KEY}:${campaignId}`, characterId)
export const rememberedCharacter = (campaignId: string): string | null => read(`${CHARACTER_KEY}:${campaignId}`)

/**
 * Kampaň, ve které se zrovna hraje. Zapamatuje se při otevření jakékoli stránky kampaně; kdo má jednu kampaň, ji má vždy.
 * Bez zapamatované (nebo když už v ní uživatel není) se vezme první. Přepnutí je v Profilu → Moje kampaně.
 */
export function useActiveCampaign(): { campaigns: CampaignSummary[] | undefined; active: CampaignSummary | null; loading: boolean } {
  const { data: campaigns, isPending } = useMyCampaigns()
  const match = useMatch('/campaigns/:campaignId/*')
  const routeId = match?.params.campaignId

  const inRoute = campaigns?.find((c) => c.id === routeId)
  useEffect(() => {
    if (inRoute) rememberCampaign(inRoute.id)
  }, [inRoute])

  if (!campaigns) return { campaigns, active: null, loading: isPending }
  const remembered = campaigns.find((c) => c.id === read(KEY))
  return { campaigns, active: inRoute ?? remembered ?? campaigns[0] ?? null, loading: false }
}
