export type Block = { type: 'heading'; text: string } | { type: 'list'; items: string[] } | { type: 'paragraph'; text: string }

export function parseBlocks(text: string): Block[] {
  const blocks: Block[] = []
  let paragraph: string[] = []
  let list: string[] = []
  const flush = () => {
    if (paragraph.length > 0) blocks.push({ type: 'paragraph', text: paragraph.join('\n') })
    if (list.length > 0) blocks.push({ type: 'list', items: list })
    paragraph = []
    list = []
  }
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd()
    const heading = /^#{1,3}\s+(.+)$/.exec(line)
    const item = /^\s*[-*]\s+(.+)$/.exec(line)
    if (line.trim() === '') flush()
    else if (heading) {
      flush()
      blocks.push({ type: 'heading', text: heading[1]! })
    } else if (item) {
      if (paragraph.length > 0) flush()
      list.push(item[1]!)
    } else {
      if (list.length > 0) flush()
      paragraph.push(line)
    }
  }
  flush()
  return blocks
}

