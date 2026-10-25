import { describe, expect, it } from 'vitest'
import { ACCENT_PRESETS, accentHex, accentVars, hexToOklch, oklchToRgb } from './accent'

/** Relativní jas podle WCAG ze sRGB (0–1). */
function luminance(rgb: [number, number, number]) {
  const lin = rgb.map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)) as [number, number, number]
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2]
}
const contrast = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
const parse = (v: string) => {
  const [l, c, h] = /oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)/.exec(v)!.slice(1).map(Number) as [number, number, number]
  return oklchToRgb({ l, c, h }).map((x) => Math.min(1, Math.max(0, x))) as [number, number, number]
}

describe('barva motivu', () => {
  it('převod hex → OKLCH sedí se známými hodnotami', () => {
    const white = hexToOklch('#ffffff')
    expect(white.l).toBeCloseTo(1, 3)
    expect(white.c).toBeLessThan(0.001)
    const red = hexToOklch('#ff0000')
    expect(red.l).toBeCloseTo(0.628, 2)
    expect(red.h).toBeCloseTo(29.2, 0)
  })

  it('každá barva (předvolby i extrémy) má v obou režimech kontrast aspoň 4.5 : 1 s textem tlačítka i s pozadím', () => {
    const lightBg = luminance(parse('oklch(0.948 0.024 86)'))
    const darkCard = luminance(parse('oklch(0.22 0.009 42)'))
    const hexes = [...ACCENT_PRESETS.flatMap((p) => (p.hex ? [p.hex] : [])), '#ffff00', '#00ffff', '#ffffff', '#000000', '#00ff00', '#ff00ff']
    for (const hex of hexes) {
      const light = accentVars(hex, 'light')
      const dark = accentVars(hex, 'dark')
      const lp = luminance(parse(light['--primary']!))
      const dp = luminance(parse(dark['--primary']!))
      expect(contrast(lp, luminance(parse(light['--primary-foreground']!))), `${hex} světlý tlačítko`).toBeGreaterThanOrEqual(4.5)
      expect(contrast(lp, lightBg), `${hex} světlý text`).toBeGreaterThanOrEqual(4.5)
      expect(contrast(dp, luminance(parse(dark['--primary-foreground']!))), `${hex} tmavý tlačítko`).toBeGreaterThanOrEqual(4.5)
      expect(contrast(dp, darkCard), `${hex} tmavý text`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('zachová odstín: zelená zůstane zelená', () => {
    expect(accentHex('#2e7d32')).toMatch(/^#[0-9a-f]{6}$/)
    const h = hexToOklch(accentHex('#2e7d32')).h
    expect(h).toBeGreaterThan(120)
    expect(h).toBeLessThan(160)
  })
})
