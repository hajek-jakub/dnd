import { useRef, useState, type ReactNode } from 'react'
import { BoldIcon, EyeIcon, ItalicIcon, ListIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { RichText } from '@/components/RichText'

/**
 * Textové pole s jednoduchým formátováním (**tučně**, *kurzíva*, odrážky) a náhledem. Tlačítka obalí označený text značkami,
 * takže to jde i na telefonu bez znalosti zápisu. Náhled ukáže text tak, jak se pak zobrazí (výchozí jako v deníku, popisy itemů přes `renderPreview`).
 */
export function FormattingTextarea({
  id,
  value,
  onChange,
  rows = 4,
  maxLength,
  placeholder,
  label,
  renderPreview = (text) => <RichText text={text} />,
}: {
  id: string
  value: string
  onChange: (value: string) => void
  rows?: number
  maxLength?: number
  placeholder?: string
  /** Popisek pro čtečky, když pole nemá vlastní `<Label htmlFor>`. */
  label?: string
  renderPreview?: (text: string) => ReactNode
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const [preview, setPreview] = useState(false)

  function wrap(before: string, after: string, fallback: string) {
    const el = ref.current
    if (!el) return
    const start = el.selectionStart
    const end = el.selectionEnd
    const selected = value.slice(start, end) || fallback
    const next = `${value.slice(0, start)}${before}${selected}${after}${value.slice(end)}`
    onChange(next)
    // Po překreslení se označí vložený text, ať jde hned přepsat.
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(start + before.length, start + before.length + selected.length)
    })
  }

  function bullet() {
    const el = ref.current
    if (!el) return
    const start = el.selectionStart
    const lineStart = value.lastIndexOf('\n', start - 1) + 1
    onChange(`${value.slice(0, lineStart)}- ${value.slice(lineStart)}`)
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(start + 2, start + 2)
    })
  }

  return (
    <div className="space-y-1">
      <div role="toolbar" aria-label="Formátování textu" className="flex flex-wrap gap-1">
        <Button type="button" variant="outline" size="icon" aria-label="Tučně" title="Tučně (**text**)" onClick={() => wrap('**', '**', 'tučný text')} disabled={preview}>
          <BoldIcon aria-hidden />
        </Button>
        <Button type="button" variant="outline" size="icon" aria-label="Kurzíva" title="Kurzíva (*text*)" onClick={() => wrap('*', '*', 'kurzíva')} disabled={preview}>
          <ItalicIcon aria-hidden />
        </Button>
        <Button type="button" variant="outline" size="icon" aria-label="Odrážka" title="Odrážka (- text)" onClick={bullet} disabled={preview}>
          <ListIcon aria-hidden />
        </Button>
        <Button type="button" variant={preview ? 'default' : 'outline'} aria-pressed={preview} onClick={() => setPreview((p) => !p)} className="ml-auto">
          <EyeIcon aria-hidden /> Náhled
        </Button>
      </div>
      {preview ? (
        <div className="min-h-24 rounded-lg border bg-background p-3 text-sm" data-testid="formatting-preview">
          {value.trim() ? renderPreview(value) : <p className="text-muted-foreground">Zatím nic k zobrazení.</p>}
        </div>
      ) : (
        <Textarea
          ref={ref}
          id={id}
          aria-label={label}
          rows={rows}
          maxLength={maxLength}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  )
}
