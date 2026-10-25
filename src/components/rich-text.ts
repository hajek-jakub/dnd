export type Block =
  | { type: 'heading'; text: string }
  | { type: 'list'; items: string[] }
  | { type: 'paragraph'; text: string }
  /** prázdné řádky navíc mezi nadpisem nebo odrážkami a dalším textem (první prázdný řádek dělá okraj bloku) */
  | { type: 'gap'; lines: number }

/** Rozdělí text na bloky tak, aby se zobrazil, jak byl napsaný: odstavec drží každý Enter i prázdné řádky uvnitř. */
export function parseBlocks(text: string): Block[] {
  const blocks: Block[] = []
  let paragraph: string[] = []
  let list: string[] = []
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
  const gap = () => {
    if (blank > 1 && blocks.length > 0) blocks.push({ type: 'gap', lines: blank - 1 })
    blank = 0
  }
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trimEnd()
    const heading = /^#{1,3}\s+(.+)$/.exec(line)
    const item = /^\s*[-*]\s+(.+)$/.exec(line)
    if (line.trim() === '') {
      if (paragraph.length > 0) paragraph.push('')
      else {
        flushList()
        blank++
      }
    } else if (heading) {
      flushParagraph()
      flushList()
      gap()
      blocks.push({ type: 'heading', text: heading[1]! })
    } else if (item) {
      flushParagraph()
      if (list.length === 0) gap()
      list.push(item[1]!)
    } else {
      flushList()
      if (paragraph.length === 0) gap()
      paragraph.push(line)
    }
  }
  flushParagraph()
  flushList()
  return blocks
}
