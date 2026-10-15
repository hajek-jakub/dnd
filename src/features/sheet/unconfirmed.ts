/**
 * Údaje přepsané z papírového sheetu, které čekají na potvrzení, se ukládají jako text začínající "TO_CONFIRM".
 * Datový model tak nemusí mít zvláštní příznak a nic se neztratí.
 */
const PREFIX = /^\s*TO_CONFIRM\b:?\s*/i

export function isUnconfirmed(line: string): boolean {
  return PREFIX.test(line)
}

export function stripUnconfirmed(line: string): string {
  return line.replace(PREFIX, '')
}

/** Řádky poznámky, které jsou označené jako nepotvrzené (bez prefixu). */
export function unconfirmedLines(text: string | null | undefined): string[] {
  return (text ?? '')
    .split('\n')
    .filter(isUnconfirmed)
    .map(stripUnconfirmed)
    .filter((l) => l.trim() !== '')
}
