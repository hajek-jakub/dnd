/**
 * Vrátí bezpečnou interní cestu pro přesměrování po přihlášení.
 * Odmítne cokoli, co nezačíná jedním lomítkem (ochrana proti open redirectu).
 */
export function safeNextPath(next: string | null | undefined): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.includes('\\')) return '/'
  return next
}
