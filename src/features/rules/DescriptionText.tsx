import { Fragment, type ReactNode } from 'react'

/** Pár znaků markdownu, které SRD používá: **tučné**, *kurzíva*, odrážky "- " a tabulky "| a | b |". Žádné HTML. */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g).map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) return <strong key={i}>{part.slice(2, -2)}</strong>
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) return <em key={i}>{part.slice(1, -1)}</em>
    return <Fragment key={i}>{part}</Fragment>
  })
}

function cells(row: string): string[] {
  return row
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim())
}

type Block = { type: 'p'; text: string } | { type: 'ul'; items: string[] } | { type: 'table'; rows: string[] }

function toBlocks(text: string): Block[] {
  const blocks: Block[] = []
  for (const paragraph of text.split(/\n\n+/)) {
    const trimmed = paragraph.trim()
    if (!trimmed) continue
    const last = blocks[blocks.length - 1]
    if (trimmed.startsWith('|')) {
      // Řádky tabulky jsou v datech samostatné odstavce, spojí se do jedné tabulky.
      if (last?.type === 'table') last.rows.push(trimmed)
      else blocks.push({ type: 'table', rows: [trimmed] })
    } else if (trimmed.startsWith('- ')) {
      const items = trimmed.split('\n').map((l) => l.replace(/^-\s*/, ''))
      if (last?.type === 'ul') last.items.push(...items)
      else blocks.push({ type: 'ul', items })
    } else {
      blocks.push({ type: 'p', text: trimmed })
    }
  }
  return blocks
}

export function DescriptionText({ text }: { text: string }) {
  const blocks = toBlocks(text)
  return (
    <div className="space-y-3 leading-relaxed">
      {blocks.map((block, i) => {
        if (block.type === 'ul') {
          return (
            <ul key={i} className="list-disc space-y-1 pl-5">
              {block.items.map((item, j) => (
                <li key={j}>{inline(item)}</li>
              ))}
            </ul>
          )
        }
        if (block.type === 'table') {
          const rows = block.rows.filter((r) => !/^\|?[\s:-]+(\|[\s:-]*)+\|?$/.test(r))
          const [head, ...body] = rows
          return (
            <div key={i} className="overflow-x-auto rounded-lg border">
              <table className="w-full text-left text-sm">
                {head && (
                  <thead className="bg-muted">
                    <tr>
                      {cells(head).map((c, j) => (
                        <th key={j} className="px-3 py-2 font-medium">
                          {inline(c)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                )}
                <tbody className="divide-y">
                  {body.map((row, j) => (
                    <tr key={j}>
                      {cells(row).map((c, k) => (
                        <td key={k} className="px-3 py-2 align-top">
                          {inline(c)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
        return <p key={i}>{inline(block.text)}</p>
      })}
    </div>
  )
}
