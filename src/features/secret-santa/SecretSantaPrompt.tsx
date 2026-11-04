import { useState } from 'react'
import { useSecretSanta } from './api'
import { SecretSantaDialog } from './SecretSantaDialog'

const LATER_KEY = 'dnd.santaLater'

function laterIds(): string[] {
  try {
    return JSON.parse(window.sessionStorage.getItem(LATER_KEY) ?? '[]') as string[]
  } catch {
    return []
  }
}

/**
 * Hned po otevření aplikace nabídne losování, které uživatel ještě neodkryl. Zavřené bez odkrytí se v tomhle otevření
 * aplikace (karta prohlížeče) už nevnucuje, příště zase ano; odkrýt jde kdykoli z karty na úvodu kampaně.
 */
export function SecretSantaPrompt() {
  const { data } = useSecretSanta()
  const [later, setLater] = useState(laterIds)
  const pendingId = data?.find((d) => !d.revealed && !later.includes(d.id))?.id
  // Otevřené losování drží dialog i po odkrytí (pak už není „neodkryté“, ale animace ještě běží).
  const [activeId, setActiveId] = useState<string | null>(null)
  if (!activeId && pendingId) setActiveId(pendingId)
  const draw = data?.find((d) => d.id === activeId)
  if (!draw) return null

  return (
    <SecretSantaDialog
      key={draw.id}
      draw={draw}
      open
      onClose={() => {
        const next = [...later, draw.id]
        try {
          window.sessionStorage.setItem(LATER_KEY, JSON.stringify(next))
        } catch {
          // bez úložiště se jen v tomhle otevření aplikace nezobrazí znovu
        }
        setLater(next)
        setActiveId(null)
      }}
    />
  )
}
