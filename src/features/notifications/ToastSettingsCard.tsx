import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { TOAST_CATEGORIES, setToastEnabled, useToastEnabled, type ToastCategory } from './toast-settings'

/** Výběr upozornění v otevřené aplikaci (toasty) pro toto zařízení. */
export function ToastSettingsCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Upozornění v aplikaci</CardTitle>
        <CardDescription>Krátká okénka dole na obrazovce, když je aplikace otevřená. Platí pro toto zařízení.</CardDescription>
      </CardHeader>
      <CardContent>
        <fieldset className="space-y-1">
          <legend className="mb-1 text-sm font-medium">Co chceš vidět</legend>
          {TOAST_CATEGORIES.map((c) => (
            <ToastToggle key={c.id} id={c.id} label={c.label} hint={c.hint} />
          ))}
        </fieldset>
      </CardContent>
    </Card>
  )
}

function ToastToggle({ id, label, hint }: { id: ToastCategory; label: string; hint: string }) {
  const enabled = useToastEnabled(id)
  return (
    <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-md py-2">
      <input type="checkbox" className="mt-0.5 size-5 shrink-0" checked={enabled} onChange={(e) => setToastEnabled(id, e.target.checked)} />
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-sm text-muted-foreground">{hint}</span>
      </span>
    </label>
  )
}
