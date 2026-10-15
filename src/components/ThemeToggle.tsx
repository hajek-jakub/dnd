import { MonitorIcon, MoonIcon, SunIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTheme, type Theme } from '@/components/theme-context'

const order: readonly Theme[] = ['system', 'light', 'dark']

const labels: Record<Theme, string> = {
  system: 'Motiv podle systému',
  light: 'Světlý motiv',
  dark: 'Tmavý motiv',
}

export function ThemeToggle() {
  const { theme: current, setTheme } = useTheme()
  const next = order[(order.indexOf(current) + 1) % order.length] ?? 'system'
  const Icon = current === 'dark' ? MoonIcon : current === 'light' ? SunIcon : MonitorIcon

  return (
    <Button variant="ghost" size="icon" aria-label={`${labels[current]} (změnit)`} title={labels[current]} onClick={() => setTheme(next)}>
      <Icon aria-hidden />
    </Button>
  )
}
