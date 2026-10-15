import { describe, expect, it } from 'vitest'
import { safeNextPath } from './next-path'

describe('safeNextPath', () => {
  it('propustí interní cesty', () => {
    expect(safeNextPath('/join/ABC')).toBe('/join/ABC')
    expect(safeNextPath('/campaigns/1?tab=x')).toBe('/campaigns/1?tab=x')
  })

  it('odmítne externí a podezřelé cíle', () => {
    expect(safeNextPath('https://evil.example')).toBe('/')
    expect(safeNextPath('//evil.example')).toBe('/')
    expect(safeNextPath('/\\evil.example')).toBe('/')
    expect(safeNextPath(null)).toBe('/')
    expect(safeNextPath('')).toBe('/')
  })
})
