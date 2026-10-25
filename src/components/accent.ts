/**
 * Barva motivu (accent) uživatele: z libovolné barvy #rrggbb se vezme odstín a sytost (OKLCH) a světlost se nastaví pevně
 * pro světlý a tmavý režim, takže tlačítka i text v barvě mají vždy dost kontrastu (WCAG AA) bez ohledu na zvolenou barvu.
 */

export interface AccentPreset {
  id: string
  label: string
  /** null = výchozí červená z `index.css` */
  hex: string | null
}

export const ACCENT_PRESETS: AccentPreset[] = [
  { id: 'blood', label: 'Krev (výchozí)', hex: null },
  { id: 'forest', label: 'Druidský les', hex: '#2e7d32' },
  { id: 'emerald', label: 'Elfí smaragd', hex: '#00897b' },
  { id: 'sea', label: 'Mořská hlubina', hex: '#0e7490' },
  { id: 'arcane', label: 'Arkánní modř', hex: '#1e5bd8' },
  { id: 'astral', label: 'Astrální indigo', hex: '#4338ca' },
  { id: 'warlock', label: 'Paktová fialová', hex: '#7e22ce' },
  { id: 'infernal', label: 'Pekelný purpur', hex: '#be185d' },
  { id: 'ember', label: 'Dračí oheň', hex: '#c2410c' },
  { id: 'gold', label: 'Dračí zlato', hex: '#b7791f' },
  { id: 'steel', label: 'Kovářská ocel', hex: '#475569' },
]

export const isAccentHex = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)

interface Lch {
  l: number
  c: number
  h: number
}

const toLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
const fromLinear = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055)

export function hexToOklch(hex: string): Lch {
  const n = Number.parseInt(hex.slice(1), 16)
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => toLinear(v / 255)) as [number, number, number]
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  const c = Math.hypot(A, B)
  const h = ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360
  return { l: L, c, h }
}

/** OKLCH → sRGB (0–1, může být mimo rozsah, když barva není v gamutu). */
export function oklchToRgb({ l: L, c, h }: Lch): [number, number, number] {
  const a = c * Math.cos((h * Math.PI) / 180)
  const b = c * Math.sin((h * Math.PI) / 180)
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    fromLinear(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    fromLinear(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    fromLinear(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ]
}

const inGamut = (lch: Lch) => oklchToRgb(lch).every((v) => v >= -0.001 && v <= 1.001)

/** Sníží sytost, dokud barva nejde zobrazit v sRGB (jinak by ji prohlížeč ořízl a posunul odstín). */
function fit(lch: Lch): Lch {
  if (inGamut(lch)) return lch
  let lo = 0
  let hi = lch.c
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2
    if (inGamut({ ...lch, c: mid })) lo = mid
    else hi = mid
  }
  return { ...lch, c: lo }
}

const css = ({ l, c, h }: Lch) => `oklch(${l.toFixed(3)} ${c.toFixed(3)} ${h.toFixed(1)})`

/** Světlost podle režimu: ve světlém tmavší (bílý text na tlačítku), v tmavém světlejší (tmavý text). */
const LEVELS = {
  light: { primary: 0.5, ring: 0.58, foreground: 'oklch(0.986 0.01 88)' },
  dark: { primary: 0.7, ring: 0.62, foreground: 'oklch(0.16 0.012 40)' },
} as const

export function accentVars(hex: string, mode: 'light' | 'dark'): Record<string, string> {
  const { c, h } = hexToOklch(hex)
  const chroma = Math.min(c, 0.2)
  const level = LEVELS[mode]
  return {
    '--primary': css(fit({ l: level.primary, c: chroma, h })),
    '--ring': css(fit({ l: level.ring, c: Math.min(chroma, 0.17), h })),
    '--primary-foreground': level.foreground,
  }
}

/** Barva pro vzorník a `theme-color` (#rrggbb) ve světlém režimu. */
export function accentHex(hex: string, mode: 'light' | 'dark' = 'light'): string {
  const { c, h } = hexToOklch(hex)
  const rgb = oklchToRgb(fit({ l: LEVELS[mode].primary, c: Math.min(c, 0.2), h }))
  return `#${rgb.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('')}`
}

export const ACCENT_VARS = ['--primary', '--ring', '--primary-foreground'] as const
