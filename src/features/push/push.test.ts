import { describe, expect, it } from 'vitest'
import { appPath, keyToBytes } from './push'

describe('push: pomocné funkce', () => {
  it('veřejný klíč VAPID z base64url převede na bajty (bez výplně, s - a _)', () => {
    expect([...keyToBytes('AQID')]).toEqual([1, 2, 3])
    // bajty 0xfb 0xff 0xfe se v base64url zapíšou jako "-__-"
    expect([...keyToBytes('-__-')]).toEqual([0xfb, 0xff, 0xfe])
    expect([...keyToBytes('AQI')]).toEqual([1, 2])
    expect(keyToBytes('')).toHaveLength(0)
  })

  it('cesta z notifikace se převede na cestu v aplikaci', () => {
    expect(appPath('/campaigns/abc/messages')).toBe('/campaigns/abc/messages')
    expect(appPath('campaigns/abc')).toBe('/campaigns/abc')
    expect(appPath('/characters/x?tab=inventory')).toBe('/characters/x?tab=inventory')
  })
})
