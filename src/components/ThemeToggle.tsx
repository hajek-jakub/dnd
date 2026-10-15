import { MonitorIcon, MoonIcon, SunIcon } from 'lucide-react'
import { useTheme } from 'next-themes'
import { Button } from '@/components/ui/button'

const order = ['system', 'light', 'dark'] as const
type Theme = (typeof order)[number]

const labels: Record<Theme, string> = {
  system: 'Motiv podle systému',
  light: 'Světlý motiv',
  dark: 'Tmavý motiv',
}

export function ThemeToggle() {
  const { theme = 'system', setTheme } = useTheme()
  const current: Theme = order.includes(theme as Theme) ? (theme as Theme) : 'system'
  const next = order[(order.indexOf(current) + 1) % order.length] ?? 'system'
  const Icon = current === 'dark' ? MoonIcon : current === 'light' ? SunIcon : MonitorIcon

  return (
    <Button variant="ghost" size="icon" aria-label={`${labels[current]} (změnit)`} title={labels[current]} onClick={() => setTheme(next)}>
      <Icon aria-hidden />
    </Button>
  )
}
