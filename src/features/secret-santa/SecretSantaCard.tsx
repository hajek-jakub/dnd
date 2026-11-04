import { useState } from 'react'
import { GiftIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { lastDayLabel, useSecretSanta } from './api'
import { SecretSantaDialog } from './SecretSantaDialog'

/** Secret Santa na úvodní stránce kampaně: komu dávám dárek (do konce losování), nebo tlačítko k odkrytí. */
export function SecretSantaCard({ campaignId }: { campaignId: string }) {
  const { data } = useSecretSanta()
  const [open, setOpen] = useState(false)
  const draw = data?.find((d) => d.campaignId === campaignId)
  if (!draw) return null

  return (
    <section
      aria-label={draw.title}
      data-testid="secret-santa-card"
      className="relative overflow-hidden rounded-2xl border border-[#e4ae39]/60 bg-gradient-to-br from-red-900 via-red-800 to-emerald-900 p-4 text-white shadow-sm"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h2 className="flex items-center gap-2 font-display text-lg font-semibold">
            <GiftIcon aria-hidden className="size-5 text-[#f0c25a]" /> {draw.title}
          </h2>
          {draw.revealed && draw.receiver ? (
            <p className="text-lg">
              Dárek dáváš: <strong data-testid="secret-santa-card-receiver" className="font-display text-2xl text-[#f0c25a]">{draw.receiver}</strong>
            </p>
          ) : (
            <p>Ještě nevíš, komu dáváš dárek.</p>
          )}
          <p className="text-sm text-white/80">Platí do {lastDayLabel(draw.visibleUntil)}. Nikomu to neprozraď.</p>
        </div>
        <Button
          onClick={() => setOpen(true)}
          className={draw.revealed ? 'border border-white/40 bg-white/10 text-white hover:bg-white/20' : 'bg-[#e4ae39] font-bold text-zinc-950 hover:bg-[#f0c25a]'}
        >
          {draw.revealed ? 'Přehrát losování' : 'Zjistit, komu dávám'}
        </Button>
      </div>
      {open && <SecretSantaDialog draw={draw} open onClose={() => setOpen(false)} />}
    </section>
  )
}
