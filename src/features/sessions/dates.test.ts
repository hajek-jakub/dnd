import { describe, expect, it } from 'vitest'
import { addDays, daysBetween, formatShort, monthWeeks, relativeDays, weekdayIndex, weekendsOfMonth } from './dates'

describe('kalendářní data', () => {
  it('den v týdnu a formát', () => {
    expect(weekdayIndex('2026-10-25')).toBe(6) // neděle
    expect(weekdayIndex('2026-12-13')).toBe(6)
    expect(formatShort('2026-10-25')).toBe('ne 25. 10. 2026')
  })

  it('přičítání přes konec měsíce a roku a přechod na zimní čas', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(daysBetween('2026-10-24', '2026-10-26')).toBe(2) // 25. 10. 2026 má 25 hodin
    expect(daysBetween('2026-10-26', '2026-10-24')).toBe(-2)
  })

  it('týdny měsíce začínají pondělím a končí nedělí', () => {
    const weeks = monthWeeks(2026, 10)
    expect(weeks[0]![0]).toBe('2026-09-28')
    expect(weeks.at(-1)!.at(-1)).toBe('2026-11-01')
    expect(weeks.every((w) => w.length === 7 && weekdayIndex(w[0]!) === 0)).toBe(true)
    expect(weeks.flat()).toContain('2026-10-25')
  })

  it('víkendy měsíce od daného dne', () => {
    expect(weekendsOfMonth(2026, 10, '2026-10-01')).toEqual(['2026-10-03', '2026-10-04', '2026-10-10', '2026-10-11', '2026-10-17', '2026-10-18', '2026-10-24', '2026-10-25', '2026-10-31'])
    expect(weekendsOfMonth(2026, 10, '2026-10-20')).toEqual(['2026-10-24', '2026-10-25', '2026-10-31'])
  })

  it('relativní dny', () => {
    expect(relativeDays('2026-10-21', '2026-10-21')).toBe('dnes')
    expect(relativeDays('2026-10-21', '2026-10-22')).toBe('zítra')
    expect(relativeDays('2026-10-21', '2026-10-24')).toBe('za 3 dny')
    expect(relativeDays('2026-10-21', '2026-10-26')).toBe('za 5 dní')
  })
})
