import { describe, expect, it } from 'vitest'
import { buildInviteLink, extractInviteCode, isValidInviteCode, normalizeInviteCode } from './invite'

describe('invite helpers', () => {
  it('normalizuje kód', () => {
    expect(normalizeInviteCode(' abcd-efgh 23 ')).toBe('ABCDEFGH23')
  })

  it('vytáhne kód z odkazu i z holého kódu', () => {
    expect(extractInviteCode('https://dnd.hajekjakub.cz/join/abcdefgh23')).toBe('ABCDEFGH23')
    expect(extractInviteCode('abcdefgh23')).toBe('ABCDEFGH23')
  })

  it('validuje formát kódu', () => {
    expect(isValidInviteCode('ABCDEFGH23')).toBe(true)
    expect(isValidInviteCode('ABCDEFGH2')).toBe(false)
    expect(isValidInviteCode('ABCDEFGHI0')).toBe(false) // I a 0 se nepoužívají
  })

  it('sestaví odkaz pro kořen i podsložku', () => {
    expect(buildInviteLink('ABCDEFGH23', 'https://dnd.hajekjakub.cz', '/')).toBe(
      'https://dnd.hajekjakub.cz/join/ABCDEFGH23',
    )
    expect(buildInviteLink('ABCDEFGH23', 'https://example.cz', '/dnd/')).toBe('https://example.cz/dnd/join/ABCDEFGH23')
    expect(buildInviteLink('ABCDEFGH23', 'https://example.cz', '/dnd')).toBe('https://example.cz/dnd/join/ABCDEFGH23')
  })
})
