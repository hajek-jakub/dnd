export type Block =
  /** `#` = kapitola (1), `##` a `###` = podkapitola (2) */
  | { type: 'heading'; level: 1 | 2; text: string }
  /** řádky začínající `>` (citace, přísloví); po sobě jdoucí řádky jsou jedna citace */
  | { type: 'quote'; text: string }
  | { type: 'list'; items: string[] }
  | { type: 'paragraph'; text: string }
  /** prázdné řádky navíc mezi nadpisem nebo odrážkami a dalším textem (první prázdný řádek dělá okraj bloku) */
  | { type: 'gap'; lines: number }

/** Rozdělí text na bloky tak, aby se zobrazil, jak byl napsaný: odstavec drží každý Enter i prázdné řádky uvnitř. */
export function parseBlocks(text: string): Block[] {
  const blocks: Block[] = []
  let paragraph: string[] = []
  let list: string[] = []
  let quote: string[] = []
  let blank = 0
  const flushParagraph = () => {
    // prázdné řádky na konci odstavce patří až před další blok
    while (paragraph.length > 0 && paragraph.at(-1) === '') {
      paragraph.pop()
      blank++
    }
    if (paragraph.length > 0) blocks.push({ type: 'paragraph', text: paragraph.join('\n') })
    paragraph = []
  }
  const flushList = () => {
    if (list.length > 0) blocks.push({ type: 'list', items: list })
    list = []
  }
  const flushQuote = () => {
    if (quote.length > 0) blocks.push({ type: 'quote', text: quote.join('\n') })
    quote = []
  }
  const gap = () => {
    if (blank > 1 && blocks.length > 0) blocks.push({ type: 'gap', lines: blank - 1 })
    blank = 0
  }
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trimEnd()
    const heading = /^(#{1,3})\s+(.+)$/.exec(line)
    const item = /^\s*[-*]\s+(.+)$/.exec(line)
    const quoted = /^\s*>\s?(.*)$/.exec(line)
    if (line.trim() === '') {
      if (paragraph.length > 0) paragraph.push('')
      else {
        flushList()
        flushQuote()
        blank++
      }
    } else if (heading) {
      flushParagraph()
      flushList()
      flushQuote()
      gap()
      blocks.push({ type: 'heading', level: heading[1]!.length === 1 ? 1 : 2, text: heading[2]! })
    } else if (quoted) {
      flushParagraph()
      flushList()
      if (quote.length === 0) gap()
      quote.push(quoted[1]!)
    } else if (item) {
      flushParagraph()
      flushQuote()
      if (list.length === 0) gap()
      list.push(item[1]!)
    } else {
      flushList()
      flushQuote()
      if (paragraph.length === 0) gap()
      paragraph.push(line)
    }
  }
  flushParagraph()
  flushList()
  flushQuote()
  return blocks
}
