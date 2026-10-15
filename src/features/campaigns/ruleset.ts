import type { Ruleset } from '@/engine'

export const RULESETS: { value: Ruleset; label: string }[] = [
  { value: '2014', label: '2014 (D&D 5e, SRD 5.1)' },
  { value: '2024', label: '2024 (D&D 5.5e, SRD 5.2)' },
]

export function rulesetOf(settings: Record<string, unknown> | undefined): Ruleset {
  return settings?.ruleset === '2024' ? '2024' : '2014'
}

/** Pravidla kampaně pro engine (nosnost a sada pravidel). Kampaně bez nastavení hrají podle 2014. */
export function engineRulesOf(settings: Record<string, unknown> | undefined): { encumbrance: boolean; ruleset: Ruleset } {
  return { encumbrance: settings?.encumbrance === true, ruleset: rulesetOf(settings) }
}
