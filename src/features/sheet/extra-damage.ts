export interface ExtraDamage {
  dice: string
  type: string
}

/** "1d4 Fire, 1d6 Cold" -> [{dice, type}]; nesrozumitelné části se vynechají. */
export function parseExtraDamage(text: string): ExtraDamage[] {
  return text
    .split(',')
    .map((part) => /^\s*(\d{1,2}d\d{1,3})\s+(\S.{0,28})\s*$/i.exec(part))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({ dice: m[1]!.toLowerCase(), type: m[2]!.trim().replace(/^./, (c) => c.toUpperCase()) }))
}

export function formatExtraDamage(list: ExtraDamage[]): string {
  return list.map((x) => `${x.dice} ${x.type}`).join(', ')
}
