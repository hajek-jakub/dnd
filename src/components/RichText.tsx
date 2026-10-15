import { Fragment, type ReactNode } from 'react'
import { parseBlocks } from './rich-text'

/**
 * Jednoduché formátování textů (deník, popisy) bez HTML: odstavce, `# nadpis`, `- odrážky`, **tučně**, *kurzíva* a odkazy http(s).
 * Vše se vykresluje jako React prvky, takže se z textu nikdy nevykoná žádné HTML ani skript.
 */
export function RichText({ text, className }: { text: string; className?: string }) {
  const blocks = parseBlocks(text)
  return (
    <div className={className}>
      {blocks.map((b, i) =>
        b.type === 'heading' ? (
          <h4 key={i} className="mt-3 font-semibold first:mt-0">
            {inline(b.text)}
          </h4>
        ) : b.type === 'list' ? (
          <ul key={i} className="my-2 list-disc space-y-1 pl-5">
            {b.items.map((item, j) => (
              <li key={j}>{inline(item)}</li>
            ))}
          </ul>
        ) : (
          <p key={i} className="my-2 whitespace-pre-line first:mt-0 last:mb-0">
            {inline(b.text)}
          </p>
        ),
      )}
    </div>
  )
}

const TOKEN = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|https?:\/\/[^\s<>()]+)/g

function inline(text: string): ReactNode {
  return text.split(TOKEN).map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) return <strong key={i}>{part.slice(2, -2)}</strong>
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) return <em key={i}>{part.slice(1, -1)}</em>
    if (/^https?:\/\//.test(part)) {
      return (
        <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="break-all text-primary underline underline-offset-2">
          {part}
        </a>
      )
    }
    return <Fragment key={i}>{part}</Fragment>
  })
}
