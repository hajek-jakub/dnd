/**
 * Práce s kalendářními daty jako s textem RRRR-MM-DD (bez časových pásem): datum session je místní datum bez času,
 * takže se nikdy nepřevádí přes `new Date('2026-10-25')` (to by v některém pásmu ukázalo jiný den).
 */

const pad = (n: number) => String(n).padStart(2, '0')

export function toIso(y: number, m: number, d: number): string {
  return `${y}-${pad(m)}-${pad(d)}`
}

function utc(iso: string): Date {
  const [y = 1970, m = 1, d = 1] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

function fromUtc(date: Date): string {
  return toIso(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate())
}

export function addDays(iso: string, days: number): string {
  const d = utc(iso)
  d.setUTCDate(d.getUTCDate() + days)
  return fromUtc(d)
}

/** Počet dní od `from` do `to` (záporný, je-li `to` dřív). */
export function daysBetween(from: string, to: string): number {
  return Math.round((utc(to).getTime() - utc(from).getTime()) / 86_400_000)
}

/** Den v týdnu s pondělím jako 0 a nedělí jako 6. */
export function weekdayIndex(iso: string): number {
  return (utc(iso).getUTCDay() + 6) % 7
}

export const WEEKDAYS_SHORT = ['Po', 'Út', 'St', 'Čt', 'Pá', 'So', 'Ne'] as const
const WEEKDAYS_ABBR = ['po', 'út', 'st', 'čt', 'pá', 'so', 'ne']

/** „so 25. 10. 2026“ */
export function formatShort(iso: string): string {
  const d = utc(iso)
  return `${WEEKDAYS_ABBR[weekdayIndex(iso)]} ${d.getUTCDate()}. ${d.getUTCMonth() + 1}. ${d.getUTCFullYear()}`
}

/** „sobota 25. října 2026“ */
export function formatLong(iso: string): string {
  return utc(iso).toLocaleDateString('cs-CZ', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
}

export function formatMonth(year: number, month: number): string {
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString('cs-CZ', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}

/** Týdny měsíce (pondělí až neděle), včetně dní sousedních měsíců, které vyplní první a poslední týden. */
export function monthWeeks(year: number, month: number): string[][] {
  const first = toIso(year, month, 1)
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const last = toIso(year, month, lastDay)
  const start = addDays(first, -weekdayIndex(first))
  const end = addDays(last, 6 - weekdayIndex(last))
  const weeks: string[][] = []
  for (let day = start; day <= end; day = addDays(day, 7)) {
    weeks.push(Array.from({ length: 7 }, (_, i) => addDays(day, i)))
  }
  return weeks
}

/** Všechny soboty a neděle v měsíci od `from` (včetně) dál. */
export function weekendsOfMonth(year: number, month: number, from: string): string[] {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const out: string[] = []
  for (let d = 1; d <= lastDay; d++) {
    const iso = toIso(year, month, d)
    if (iso >= from && weekdayIndex(iso) >= 5) out.push(iso)
  }
  return out
}

/** Za kolik dní je `iso` od `today`: „dnes“, „zítra“, „za 5 dní“. */
export function relativeDays(today: string, iso: string): string {
  const n = daysBetween(today, iso)
  if (n === 0) return 'dnes'
  if (n === 1) return 'zítra'
  if (n < 0) return 'proběhlo'
  return `za ${n} ${n >= 2 && n <= 4 ? 'dny' : 'dní'}`
}
