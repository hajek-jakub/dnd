/** Normalizace kódu pozvánky: velká písmena, bez mezer a pomlček. */
export function normalizeInviteCode(input: string): string {
  return input.replace(/[\s-]+/g, '').toUpperCase()
}

/** Vytáhne kód z odkazu (.../join/KOD) nebo z holého kódu. */
export function extractInviteCode(input: string): string {
  const trimmed = input.trim()
  const match = trimmed.match(/\/join\/([A-Za-z0-9-]+)/)
  return normalizeInviteCode(match?.[1] ?? trimmed)
}

/** Kód pozvánky má 10 znaků z abecedy bez zaměnitelných znaků (0/O, 1/I/L). */
export function isValidInviteCode(code: string): boolean {
  return /^[A-HJKMNP-Z2-9]{10}$/.test(code)
}

/** Úplný odkaz pro pozvání (respektuje base path, např. při nasazení do podsložky). */
export function buildInviteLink(code: string, origin = window.location.origin, base = import.meta.env.BASE_URL): string {
  const normalizedBase = base.endsWith('/') ? base : `${base}/`
  return `${origin}${normalizedBase}join/${code}`
}
