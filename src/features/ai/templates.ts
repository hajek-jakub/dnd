/**
 * Šablony zadání pro AI pomocníka: DM vyplní pár políček (počet místností, obtížnost…) a šablona z nich složí zprávu,
 * kterou ještě může upravit, než ji pošle. Level družiny AI zjistí sama (get_party), když ho DM nevyplní.
 */
export type TemplateValues = Record<string, string | number | boolean>

export type TemplateField =
  | { key: string; label: string; type: 'text'; default: string; placeholder?: string; optional?: boolean }
  | { key: string; label: string; type: 'number'; default: number; min: number; max: number }
  | { key: string; label: string; type: 'select'; default: string; options: string[] }
  | { key: string; label: string; type: 'checkbox'; default: boolean }

export interface AiTemplate {
  id: string
  title: string
  description: string
  fields: TemplateField[]
  compose: (v: TemplateValues) => string
}

export const DIFFICULTIES = ['lehká', 'střední', 'těžká', 'smrtící']

const text = (v: TemplateValues, key: string): string => String(v[key] ?? '').trim()

/** „družina je na 3. levelu“, nebo pokyn zjistit level z postav. */
function partyLevel(v: TemplateValues): string {
  const level = text(v, 'level')
  return level ? `Družina je na ${level}. levelu.` : 'Level a počet postav zjisti z družiny.'
}

/** České skloňování „místnost“ podle počtu. */
export function roomsWord(n: number): string {
  if (n === 1) return '1 místností'
  return `${n} místnostmi`
}

export const AI_TEMPLATES: AiTemplate[] = [
  {
    id: 'dungeon',
    title: 'Dungeon',
    description: 'Lokace s místnostmi, nepřáteli, pastmi a pokladem.',
    fields: [
      { key: 'name', label: 'Název', type: 'text', default: 'Hrobka krále' },
      { key: 'rooms', label: 'Počet místností', type: 'number', default: 5, min: 1, max: 15 },
      { key: 'theme', label: 'Téma', type: 'text', default: 'starobylá hrobka s nemrtvými', placeholder: 'goblinní jeskyně, zatopený chrám…' },
      { key: 'difficulty', label: 'Obtížnost setkání', type: 'select', default: 'střední', options: DIFFICULTIES },
      { key: 'treasure', label: 'Poklad', type: 'select', default: 'běžný', options: ['skromný', 'běžný', 'bohatý'] },
      { key: 'level', label: 'Level družiny', type: 'text', default: '', placeholder: 'prázdné = podle postav', optional: true },
    ],
    compose: (v) =>
      [
        `Připrav dungeon „${text(v, 'name')}“ s ${roomsWord(Number(v.rooms))}${text(v, 'theme') ? `, téma: ${text(v, 'theme')}` : ''}.`,
        `Obtížnost setkání: ${text(v, 'difficulty')}. ${partyLevel(v)} Poklad: ${text(v, 'treasure')}.`,
        'Ke každé místnosti napiš krátký popis a navrhni nepřátele ze SRD s lootem, který z nich padá, a poklad místnosti. Některé místnosti můžou být bez boje (past, hádanka, odpočinek).',
        'Každou místnost dej jako samostatný návrh, složka dungeonu a v ní místnosti.',
      ].join('\n'),
  },
  {
    id: 'encounter',
    title: 'Setkání',
    description: 'Jeden souboj vyvážený podle družiny, s lootem z nepřátel.',
    fields: [
      { key: 'place', label: 'Kde', type: 'text', default: 'lesní cesta', placeholder: 'lesní cesta, krčma, bažina…' },
      { key: 'enemies', label: 'Nepřátelé', type: 'text', default: '', placeholder: 'prázdné = vyber sám (banditi, vlci…)', optional: true },
      { key: 'difficulty', label: 'Obtížnost', type: 'select', default: 'střední', options: DIFFICULTIES },
      { key: 'folder', label: 'Složka', type: 'text', default: 'Setkání' },
      { key: 'level', label: 'Level družiny', type: 'text', default: '', placeholder: 'prázdné = podle postav', optional: true },
      { key: 'loot', label: 'S lootem z nepřátel', type: 'checkbox', default: true },
    ],
    compose: (v) =>
      [
        `Připrav setkání: ${text(v, 'place')}${text(v, 'enemies') ? `, nepřátelé: ${text(v, 'enemies')}` : ', nepřátele vyber sám ze SRD tak, aby k místu seděli'}.`,
        `Obtížnost: ${text(v, 'difficulty')}. ${partyLevel(v)}`,
        v.loot ? 'Přidej loot, který z nepřátel padá (mince a drobnosti podle CR).' : 'Loot nepřidávej, jen nepřátele.',
        `Dej to do složky „${text(v, 'folder')}“ a napiš, jak nepřátelé bojují (taktika v jedné dvou větách).`,
      ].join('\n'),
  },
  {
    id: 'shop',
    title: 'Obchod',
    description: 'Sortiment s cenami z pravidel, hráči si koupí, co chtějí.',
    fields: [
      { key: 'name', label: 'Název', type: 'text', default: 'Kovárna u Bruna' },
      { key: 'type', label: 'Druh', type: 'select', default: 'kovář a zbrojíř', options: ['kovář a zbrojíř', 'alchymista a léčitel', 'obchod s magickými předměty', 'smíšené zboží', 'lukostřelec a lovec'] },
      { key: 'settlement', label: 'Osada', type: 'select', default: 'město', options: ['vesnice', 'město', 'velkoměsto'] },
      { key: 'count', label: 'Počet položek', type: 'number', default: 10, min: 3, max: 40 },
    ],
    compose: (v) =>
      [
        `Udělej obchod „${text(v, 'name')}“ (${text(v, 'type')}) v osadě typu ${text(v, 'settlement')}, asi ${Number(v.count)} položek.`,
        'Všechno s cenou z pravidel (cena je za celou položku), magické předměty jen takové, jaké se v takové osadě dají sehnat.',
        'Dej to do složky s názvem obchodu.',
      ].join('\n'),
  },
  {
    id: 'treasure',
    title: 'Poklad',
    description: 'Poklad podle tabulek z DMG pro daný CR.',
    fields: [
      { key: 'where', label: 'Kde', type: 'text', default: 'dračí doupě' },
      { key: 'cr', label: 'Úroveň (CR)', type: 'select', default: 'CR 0–4', options: ['CR 0–4', 'CR 5–10', 'CR 11–16', 'CR 17+'] },
      { key: 'kind', label: 'Druh', type: 'select', default: 'poklad doupěte (hoard)', options: ['poklad doupěte (hoard)', 'kapsy jednoho nepřítele (individual)'] },
    ],
    compose: (v) =>
      [
        `Připrav poklad: ${text(v, 'where')}, ${text(v, 'cr')}, ${text(v, 'kind')}.`,
        'Řiď se tabulkami pokladů z DMG 2014 (mince, drahokamy a umělecké předměty jako zlato s popiskem, magické itemy ze SRD nebo katalogu). Napiš, co jsi hodil nebo vybral.',
        `Dej to do složky „${text(v, 'where')}“.`,
      ].join('\n'),
  },
  {
    id: 'boss',
    title: 'Boss',
    description: 'Hlavní záporák s doprovodem a pořádným lootem.',
    fields: [
      { key: 'who', label: 'Kdo', type: 'text', default: 'nekromant v podzemí', placeholder: 'mladý drak, vůdce banditů…' },
      { key: 'difficulty', label: 'Obtížnost', type: 'select', default: 'těžká', options: DIFFICULTIES },
      { key: 'folder', label: 'Složka', type: 'text', default: 'Boss' },
      { key: 'level', label: 'Level družiny', type: 'text', default: '', placeholder: 'prázdné = podle postav', optional: true },
      { key: 'minions', label: 'S doprovodem', type: 'checkbox', default: true },
    ],
    compose: (v) =>
      [
        `Připrav boss fight: ${text(v, 'who')}. Obtížnost: ${text(v, 'difficulty')}. ${partyLevel(v)}`,
        v.minions ? 'Přidej doprovod (slabší nepřátele), ať je souboj zajímavější.' : 'Bez doprovodu, jen boss.',
        'Bosse vyber ze SRD (nebo uprav nejbližší nestvůru a napiš co), přidej loot, který z něj padá, včetně jednoho magického itemu odpovídajícího levelu, a napiš jeho taktiku.',
        `Dej to do složky „${text(v, 'folder')}“.`,
      ].join('\n'),
  },
  {
    id: 'rules',
    title: 'Pravidla',
    description: 'Zeptej se, jak něco funguje.',
    fields: [{ key: 'question', label: 'Na co se chceš zeptat', type: 'text', default: '', placeholder: 'grappling, Bag of Holding a Portable Hole…' }],
    compose: (v) => `Vysvětli mi podle pravidel: ${text(v, 'question')}`,
  },
]

export function defaults(t: AiTemplate): TemplateValues {
  return Object.fromEntries(t.fields.map((f) => [f.key, f.default]))
}

/** Chybí povinné políčko? (Text bez `optional` nesmí být prázdný.) */
export function missing(t: AiTemplate, v: TemplateValues): string | null {
  const field = t.fields.find((f) => f.type === 'text' && !f.optional && String(v[f.key] ?? '').trim() === '')
  return field ? field.label : null
}
