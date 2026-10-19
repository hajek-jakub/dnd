import { ABILITIES, SKILLS, abilityModifier, type AbilityKey, type SkillKey } from './abilities'
import { classResources } from './resources'
import { THIRD_CASTER_SUBCLASSES, type RulesBundle } from './rules-bundle'
import { casterLevel, casterTypeOf, pactSlots, spellSlots, type ClassLevels } from './spellcasting'
import type {
  AttackInfo,
  CharacterInput,
  Computed,
  ComputedSheet,
  Effect,
  InventoryItem,
  ResourceInfo,
  SpellcastingClassInfo,
} from './types'

export const MAX_ATTUNEMENT = 3

type Source = { label: string; value: number | string }

/** Přepíše hodnotu ručním přepisem, pokud existuje. Bez přepisu vrací hodnotu podle pravidel. */
function makeComputed(key: string, base: number, sources: Source[], overrides: Record<string, number>): Computed {
  const override = overrides[key]
  const overridden = typeof override === 'number' && Number.isFinite(override)
  return { value: overridden ? override : base, base, overridden, sources }
}

function signed(n: number): string {
  return n >= 0 ? `+${n}` : `${n}`
}

/** Skupiny po sobě jdoucích levelů stejné třídy v pořadí, v jakém se třídy poprvé objevily. */
export function groupClasses(input: Pick<CharacterInput, 'levels' | 'subclasses'>): ClassLevels[] {
  const order: string[] = []
  const counts: Record<string, number> = {}
  for (const l of input.levels) {
    if (!(l.classIndex in counts)) order.push(l.classIndex)
    counts[l.classIndex] = (counts[l.classIndex] ?? 0) + 1
  }
  return order.map((classIndex) => ({ classIndex, level: counts[classIndex] ?? 0, subclassIndex: input.subclasses[classIndex] ?? null }))
}

/** Efekty, které se opravdu uplatní: DM efekty a efekty equipnutých (a případně attunovaných) itemů. */
export function activeEffects(input: Pick<CharacterInput, 'effects' | 'items'>): Effect[] {
  const fromItems = input.items
    .filter((i) => i.equipped && (!i.requiresAttunement || i.attuned))
    .flatMap((i) => i.effects.map((e) => ({ ...e, source: e.source || i.name })))
  return [...input.effects, ...fromItems]
}

/** Lze item attunovat? Maximálně 3 attunované itemy. */
export function canAttune(items: Pick<InventoryItem, 'id' | 'attuned'>[], itemId: string): boolean {
  const target = items.find((i) => i.id === itemId)
  if (!target) return false
  if (target.attuned) return true
  return items.filter((i) => i.attuned).length < MAX_ATTUNEMENT
}

function dieSides(dice: string): number {
  const m = /d(\d+)/.exec(dice)
  return m ? Number(m[1]) : 0
}

const normalizeName = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '')

export function computeSheet(input: CharacterInput, bundle: RulesBundle): ComputedSheet {
  const ov = input.overrides
  const ruleset = input.rules?.ruleset ?? '2014'
  const classes = groupClasses(input)
  const totalLevel = Math.max(1, input.levels.length)
  const effects = activeEffects(input)
  const effectsFor = (...targets: string[]) => effects.filter((e) => targets.includes(e.target))
  const sumEffects = (...targets: string[]) => effectsFor(...targets).reduce((n, e) => n + e.value, 0)
  const effectSources = (...targets: string[]): Source[] => effectsFor(...targets).map((e) => ({ label: e.source, value: signed(e.value) }))

  // --- proficiency bonus
  const pbBase = 2 + Math.floor((totalLevel - 1) / 4) + sumEffects('proficiency')
  const proficiencyBonus = makeComputed(
    'proficiencyBonus',
    pbBase,
    [{ label: `Celkový level ${totalLevel}`, value: 2 + Math.floor((totalLevel - 1) / 4) }, ...effectSources('proficiency')],
    ov,
  )
  const pb = proficiencyBonus.value

  // --- vlastnosti
  const abilities = {} as ComputedSheet['abilities']
  for (const a of ABILITIES) {
    const raw = input.abilityScores[a]
    const score = makeComputed(
      `ability.${a}`,
      raw + sumEffects(`ability.${a}`),
      [{ label: 'Základ', value: raw }, ...effectSources(`ability.${a}`)],
      ov,
    )
    abilities[a] = { score, modifier: abilityModifier(score.value) }
  }
  const mod = (a: AbilityKey) => abilities[a].modifier

  // --- proficiencies
  const firstClass = classes[0] ? bundle.classes[classes[0].classIndex] : undefined
  const classProfs = (firstClass?.proficiencies ?? []).filter((p) => !/^(Saving Throw|Skill):/.test(p))
  const proficiencies = [...new Set([...classProfs, ...input.extraProficiencies])]

  // --- záchranné hody (z výchozí třídy)
  const saveProf = new Set<AbilityKey>([...(firstClass?.saves ?? []), ...input.extraSaveProficiencies])
  const saves = {} as ComputedSheet['saves']
  for (const a of ABILITIES) {
    const proficient = saveProf.has(a)
    const sources: Source[] = [{ label: `Modifikátor ${a.toUpperCase()}`, value: signed(mod(a)) }]
    if (proficient) sources.push({ label: 'Proficiency', value: signed(pb) })
    sources.push(...effectSources('save.all', `save.${a}`))
    const base = mod(a) + (proficient ? pb : 0) + sumEffects('save.all', `save.${a}`)
    saves[a] = { ...makeComputed(`save.${a}`, base, sources, ov), proficient }
  }

  // --- dovednosti
  const skills = {} as ComputedSheet['skills']
  for (const s of SKILLS) {
    const prof = input.skillProficiencies[s.key as SkillKey] ?? 0
    const sources: Source[] = [{ label: `Modifikátor ${s.ability.toUpperCase()}`, value: signed(mod(s.ability)) }]
    if (prof === 1) sources.push({ label: 'Proficiency', value: signed(pb) })
    if (prof === 2) sources.push({ label: 'Expertise', value: signed(pb * 2) })
    sources.push(...effectSources('skill.all', `skill.${s.key}`))
    const base = mod(s.ability) + prof * pb + sumEffects('skill.all', `skill.${s.key}`)
    skills[s.key] = { ...makeComputed(`skill.${s.key}`, base, sources, ov), proficiency: prof, ability: s.ability }
  }

  // --- pasivní vnímání
  const passivePerception = makeComputed(
    'passivePerception',
    10 + skills.perception.value + sumEffects('passive.perception'),
    [{ label: 'Základ', value: 10 }, { label: 'Vnímání', value: signed(skills.perception.value) }, ...effectSources('passive.perception')],
    ov,
  )

  // --- iniciativa
  const initiative = makeComputed(
    'initiative',
    mod('dex') + sumEffects('initiative'),
    [{ label: 'Modifikátor DEX', value: signed(mod('dex')) }, ...effectSources('initiative')],
    ov,
  )

  // --- vybavení pro AC, rychlost a martial arts
  // Zbroj a štít se počítají jen nošené a s hodnotami (stejně pro AC, Unarmored Defense, rychlost i martial arts); z víc nošených ten nejlepší.
  // Magický bonus itemu s attunementem platí až po attunementu (Demon Armor, Sun Blade), základní AC zbroje platí vždy.
  const dex = mod('dex')
  const attunementOk = (i: InventoryItem) => !i.requiresAttunement || i.attuned
  const magicOf = (i: InventoryItem, bonus: number | undefined) => (attunementOk(i) ? (bonus ?? 0) : 0)
  const armorDex = (a: NonNullable<InventoryItem['armor']>) => (a.dexBonus ? (a.maxDexBonus == null ? dex : Math.min(dex, a.maxDexBonus)) : 0)
  const armorAc = (i: InventoryItem) => (i.armor ? i.armor.base + armorDex(i.armor) + magicOf(i, i.armor.magicBonus) : 0)
  const bestOf = (list: InventoryItem[]) => list.reduce<InventoryItem | undefined>((b, i) => (b === undefined || armorAc(i) > armorAc(b) ? i : b), undefined)
  const equipped = input.items.filter((i) => i.equipped)
  const armor = bestOf(equipped.filter((i) => i.kind === 'armor' && i.armor))
  const shield = bestOf(equipped.filter((i) => i.kind === 'shield' && i.armor))
  const heavyArmor = !!armor?.armor && !armor.armor.dexBonus

  // --- AC
  const acSources: Source[] = []
  let acBase: number
  if (armor?.armor) {
    const a = armor.armor
    const dexPart = armorDex(a)
    const magic = magicOf(armor, a.magicBonus)
    acBase = a.base + dexPart + magic
    acSources.push({ label: armor.name, value: a.base })
    if (a.dexBonus) acSources.push({ label: `DEX${a.maxDexBonus != null ? ` (max ${a.maxDexBonus})` : ''}`, value: signed(dexPart) })
    if (magic) acSources.push({ label: `${armor.name}: magický bonus`, value: signed(magic) })
  } else {
    // Bez zbroje: základ 10 + DEX; barbar, mnich a draconic sorcerer mají vlastní vzorec (bere se nejvýhodnější).
    const options: { label: string; value: number; parts: Source[] }[] = [
      {
        label: 'Bez zbroje',
        value: 10 + dex,
        parts: [
          { label: 'Základ', value: 10 },
          { label: 'DEX', value: signed(dex) },
        ],
      },
    ]
    if (classes.some((c) => c.classIndex === 'barbarian')) {
      options.push({
        label: 'Unarmored Defense (barbar)',
        value: 10 + dex + mod('con'),
        parts: [
          { label: 'Unarmored Defense: základ', value: 10 },
          { label: 'DEX', value: signed(dex) },
          { label: 'CON', value: signed(mod('con')) },
        ],
      })
    }
    if (classes.some((c) => c.classIndex === 'monk') && !shield) {
      options.push({
        label: 'Unarmored Defense (mnich)',
        value: 10 + dex + mod('wis'),
        parts: [
          { label: 'Unarmored Defense: základ', value: 10 },
          { label: 'DEX', value: signed(dex) },
          { label: 'WIS', value: signed(mod('wis')) },
        ],
      })
    }
    // Draconic Resilience (sorcerer, Draconic Bloodline): 2014 13 + DEX, 2024 (od 3. levelu) 10 + DEX + CHA; štít smí.
    const draconic = classes.find((c) => c.classIndex === 'sorcerer' && c.subclassIndex === 'draconic')
    if (draconic && ruleset !== '2024') {
      options.push({
        label: 'Draconic Resilience',
        value: 13 + dex,
        parts: [
          { label: 'Draconic Resilience: základ', value: 13 },
          { label: 'DEX', value: signed(dex) },
        ],
      })
    } else if (draconic && draconic.level >= 3) {
      options.push({
        label: 'Draconic Resilience',
        value: 10 + dex + mod('cha'),
        parts: [
          { label: 'Draconic Resilience: základ', value: 10 },
          { label: 'DEX', value: signed(dex) },
          { label: 'CHA', value: signed(mod('cha')) },
        ],
      })
    }
    const best = options.reduce((a, b) => (b.value > a.value ? b : a))
    acBase = best.value
    acSources.push(...best.parts)
  }
  if (shield?.armor) {
    const bonus = shield.armor.base + magicOf(shield, shield.armor.magicBonus)
    acBase += bonus
    acSources.push({ label: shield.name, value: signed(bonus) })
  }
  // Ať je v rozpisu vidět, proč se něco nepočítá.
  for (const i of [armor, shield]) {
    if (i?.armor?.magicBonus && !attunementOk(i)) acSources.push({ label: `${i.name}: magický bonus až po attunementu`, value: 'neplatí' })
  }
  for (const i of equipped) {
    if ((i.kind === 'armor' || i.kind === 'shield') && !i.armor) acSources.push({ label: `${i.name}: chybí hodnoty zbroje`, value: 'nepočítá se' })
  }
  // Podmíněné bonusy: ac.armored jen ve zbroji (Fighting Style: Defense), ac.unarmored jen bez zbroje a štítu (Bracers of Defense).
  const acTargets = ['ac', ...(armor ? ['ac.armored'] : []), ...(!armor && !shield ? ['ac.unarmored'] : [])]
  acBase += sumEffects(...acTargets)
  acSources.push(...effectSources(...acTargets))
  const ac = makeComputed('ac', acBase, acSources, ov)

  // --- rychlost
  const speedSources: Source[] = [{ label: 'Základní rychlost', value: input.baseSpeed }]
  let speedBase = input.baseSpeed
  const monk = classes.find((c) => c.classIndex === 'monk')
  if (monk && !armor && !shield) {
    const bonus = Number(bundle.classes.monk?.levels[monk.level]?.classSpecific.unarmored_movement ?? 0)
    if (bonus > 0) {
      speedBase += bonus
      speedSources.push({ label: 'Unarmored Movement', value: signed(bonus) })
    }
  }
  const barbarian = classes.find((c) => c.classIndex === 'barbarian')
  if (barbarian && barbarian.level >= 5 && !heavyArmor) {
    speedBase += 10
    speedSources.push({ label: 'Fast Movement', value: '+10' })
  }
  speedBase += sumEffects('speed')
  speedSources.push(...effectSources('speed'))
  const speed = makeComputed('speed', speedBase, speedSources, ov)

  // --- HP
  let hpBase = 0
  const conMod = mod('con')
  const perLevelBonus = sumEffects('hp.perLevel')
  input.levels.forEach((entry, i) => {
    const die = bundle.classes[entry.classIndex]?.hitDie ?? 8
    const gain = i === 0 ? die : (entry.hpRoll ?? Math.floor(die / 2) + 1)
    hpBase += Math.max(1, gain + conMod + perLevelBonus)
  })
  const hpSources: Source[] = [{ label: `Hit dice a CON (${signed(conMod)} za level)`, value: hpBase }]
  if (perLevelBonus) hpSources.push({ label: 'Bonus za level', value: signed(perLevelBonus * totalLevel) })
  // Draconic Resilience: +1 HP za každý level sorcerera (2024 od 3. levelu, kdy je to celkem také +1 za level).
  const draconicSorcerer = classes.find((c) => c.classIndex === 'sorcerer' && c.subclassIndex === 'draconic')
  const draconicHp = !draconicSorcerer ? 0 : ruleset === '2024' && draconicSorcerer.level < 3 ? 0 : draconicSorcerer.level
  if (draconicHp) {
    hpBase += draconicHp
    hpSources.push({ label: 'Draconic Resilience', value: signed(draconicHp) })
  }
  const hpFlat = sumEffects('hp.max')
  hpBase += hpFlat
  hpSources.push(...effectSources('hp.max'))
  const hpMax = makeComputed('hp.max', hpBase, hpSources, ov)

  // --- hit dice
  const diceTotals: Record<string, number> = {}
  for (const c of classes) {
    const die = `d${bundle.classes[c.classIndex]?.hitDie ?? 8}`
    diceTotals[die] = (diceTotals[die] ?? 0) + c.level
  }
  const hitDice = Object.entries(diceTotals)
    .sort(([a], [b]) => dieSides(b) - dieSides(a))
    .map(([die, total]) => {
      const used = Math.min(total, input.state.hitDiceUsed[die] ?? 0)
      return { die, total, used, remaining: total - used }
    })

  // --- featury
  const features: ComputedSheet['features'] = []
  for (const c of classes) {
    const cls = bundle.classes[c.classIndex]
    if (!cls) continue
    for (let lvl = 1; lvl <= c.level; lvl++) {
      for (const f of cls.levels[lvl]?.features ?? []) features.push({ name: f.name, className: cls.name, level: lvl, source: 'class' })
    }
    const sub = c.subclassIndex ? bundle.subclasses[c.subclassIndex] : undefined
    if (sub) {
      for (let lvl = 1; lvl <= c.level; lvl++) {
        for (const f of sub.features[lvl] ?? []) features.push({ name: f.name, className: sub.name, level: lvl, source: 'subclass' })
      }
    }
  }

  // --- martial arts
  let martialArtsDie: string | null = null
  if (monk) {
    const ma = bundle.classes.monk?.levels[monk.level]?.classSpecific.martial_arts as
      { dice_count?: number; dice_value?: number } | undefined
    // 2024: martial arts kostka je o jeden stupeň vyšší (d6, d8, d10, d12 místo d4, d6, d8, d10).
    if (ma?.dice_value) martialArtsDie = `${ma.dice_count ?? 1}d${ruleset === '2024' ? ma.dice_value + 2 : ma.dice_value}`
  }

  // --- Extra Attack (nesčítá se mezi třídami)
  let extraAttacks = 0
  for (const c of classes) {
    const specific = bundle.classes[c.classIndex]?.levels[c.level]?.classSpecific
    const fighterExtra = Number(specific?.extra_attacks ?? 0)
    const hasFeature = features.some((f) => f.name === 'Extra Attack' && f.className === bundle.classes[c.classIndex]?.name)
    extraAttacks = Math.max(extraAttacks, fighterExtra, hasFeature ? 1 : 0)
  }

  // --- útoky
  const attacks: AttackInfo[] = []
  // „Weapon: Longbow“ z extra proficiencies (rasa, seed, ruční zápis) je proficiency s longbow: předpona se při porovnání zahodí
  const profKey = new Set(proficiencies.map((p) => normalizeName(p.replace(/^(weapons?|armou?r|tools?)\s*:\s*/i, ''))))
  const isProficientWith = (w: InventoryItem) => {
    const cat = w.weapon?.category === 'martial' ? 'martialweapons' : 'simpleweapons'
    if (profKey.has(cat)) return true
    const n = normalizeName(w.name)
    return [...profKey].some((p) => p.startsWith(n) || n.startsWith(p.replace(/s$/, '')))
  }
  const addAttack = (id: string, name: string, w: InventoryItem | null) => {
    const stats = w?.weapon
    const props = (stats?.properties ?? []).map((p) => p.toLowerCase())
    const ranged = stats?.range === 'ranged'
    // Martial Arts platí jen bez zbroje a bez štítu.
    const monkWeapon =
      !!monk &&
      !armor &&
      !shield &&
      (w === null ||
        (stats?.range === 'melee' &&
          !props.includes('two-handed') &&
          !props.includes('heavy') &&
          // 2014: simple melee zbraně a shortsword; 2024: simple melee zbraně a martial melee zbraně s vlastností Light
          (stats.category === 'simple' || (ruleset === '2024' ? props.includes('light') : /^shortsword$/i.test(w.name)))))
    const candidates: AbilityKey[] = ranged ? ['dex'] : props.includes('finesse') || monkWeapon ? ['str', 'dex'] : ['str']
    const ability = candidates.reduce((best, a) => (mod(a) > mod(best) ? a : best))
    const proficient = w === null ? true : isProficientWith(w)
    const magic = w ? magicOf(w, stats?.magicBonus) : 0
    const notes: string[] = []
    let dice = stats?.damageDice ?? '1'
    if (monkWeapon && martialArtsDie) {
      if (w === null) dice = martialArtsDie
      else if (dieSides(martialArtsDie) > dieSides(dice)) dice = martialArtsDie
      notes.push('Martial Arts')
    }
    if (props.includes('finesse')) notes.push('Finesse')
    const kindTarget = ranged ? 'attack.ranged' : 'attack.melee'
    const hitSources: Source[] = [{ label: `Modifikátor ${ability.toUpperCase()}`, value: signed(mod(ability)) }]
    if (proficient) hitSources.push({ label: 'Proficiency', value: signed(pb) })
    if (magic) hitSources.push({ label: 'Magický bonus', value: signed(magic) })
    hitSources.push(...effectSources('attack.all', kindTarget))
    const toHitBase = mod(ability) + (proficient ? pb : 0) + magic + sumEffects('attack.all', kindTarget)
    const dmgSources: Source[] = [{ label: `Modifikátor ${ability.toUpperCase()}`, value: signed(mod(ability)) }]
    if (magic) dmgSources.push({ label: 'Magický bonus', value: signed(magic) })
    dmgSources.push(...effectSources('damage.all'))
    const dmgBase = mod(ability) + magic + sumEffects('damage.all')
    attacks.push({
      id,
      name,
      toHit: makeComputed(`attack.${id}.toHit`, toHitBase, hitSources, ov),
      damageDice: dice,
      damageBonus: makeComputed(`attack.${id}.damage`, dmgBase, dmgSources, ov),
      damageType: stats?.damageType ?? 'Bludgeoning',
      extraDamage: stats?.extraDamage ?? [],
      ability,
      proficient,
      notes,
    })
  }
  addAttack('unarmed', 'Unarmed Strike', null)
  for (const w of equipped.filter((i) => i.kind === 'weapon' && i.weapon)) addAttack(w.id, w.name, w)

  // --- sesílání
  const spellClasses: SpellcastingClassInfo[] = []
  for (const c of classes) {
    const cls = bundle.classes[c.classIndex]
    if (!cls) continue
    const type = casterTypeOf(bundle, c)
    if (type === 'none') continue
    const ability = cls.spellcastingAbility ?? (c.subclassIndex ? THIRD_CASTER_SUBCLASSES[c.subclassIndex]?.ability : undefined)
    if (!ability) continue
    const table = cls.levels[c.level]?.spellcasting ?? null
    const dcSources: Source[] = [
      { label: 'Základ', value: 8 },
      { label: 'Proficiency', value: signed(pb) },
      { label: `Modifikátor ${ability.toUpperCase()}`, value: signed(mod(ability)) },
      ...effectSources('spell.dc'),
    ]
    const atkSources: Source[] = [
      { label: 'Proficiency', value: signed(pb) },
      { label: `Modifikátor ${ability.toUpperCase()}`, value: signed(mod(ability)) },
      ...effectSources('spell.attack'),
    ]
    let preparedMax: number | null = null
    if (c.classIndex === 'cleric' || c.classIndex === 'druid') preparedMax = Math.max(1, mod('wis') + c.level)
    if (c.classIndex === 'wizard') preparedMax = Math.max(1, mod('int') + c.level)
    if (c.classIndex === 'paladin') preparedMax = Math.max(1, mod('cha') + Math.floor(c.level / 2))
    spellClasses.push({
      classIndex: c.classIndex,
      className: cls.name,
      ability,
      saveDc: makeComputed(`spellDc.${c.classIndex}`, 8 + pb + mod(ability) + sumEffects('spell.dc'), dcSources, ov),
      attackBonus: makeComputed(`spellAttack.${c.classIndex}`, pb + mod(ability) + sumEffects('spell.attack'), atkSources, ov),
      cantripsKnown: table && 'cantrips_known' in table ? (table.cantrips_known ?? null) : null,
      spellsKnown: table && 'spells_known' in table ? (table.spells_known ?? null) : null,
      preparedMax,
    })
  }
  const slotRow = spellSlots(bundle, classes)
  const slots = slotRow
    .map((max, i) => {
      const override = ov[`slots.${i + 1}`]
      const effective = typeof override === 'number' ? override : max
      return { level: i + 1, max: effective, used: Math.min(effective, input.state.slotsUsed[String(i + 1)] ?? 0) }
    })
    .filter((s) => s.max > 0)
  const pactBase = pactSlots(bundle, classes)
  const pactCount = pactBase ? (typeof ov['pact.count'] === 'number' ? ov['pact.count'] : pactBase.count) : 0
  const pact =
    pactBase && pactCount > 0 ? { count: pactCount, level: pactBase.level, used: Math.min(pactCount, input.state.pactSlotsUsed) } : null

  // --- zdroje
  const resources: ResourceInfo[] = []
  for (const c of classes) {
    for (const def of classResources(bundle, c.classIndex, c.level, mod, ruleset)) {
      const max = makeComputed(`resource.${def.key}.max`, def.max, [{ label: def.source, value: def.max }], ov)
      resources.push({
        key: def.key,
        name: def.name,
        max,
        current: Math.max(0, Math.min(max.value, input.state.resources[def.key] ?? max.value)),
        recharge: def.recharge,
        source: def.source,
        custom: false,
      })
    }
  }
  for (const r of input.customResources) {
    const max = makeComputed(`resource.${r.key}.max`, r.max, [{ label: 'Vlastní zdroj', value: r.max }], ov)
    resources.push({
      key: r.key,
      name: r.name,
      max,
      current: Math.max(0, Math.min(max.value, input.state.resources[r.key] ?? max.value)),
      recharge: r.recharge,
      source: 'Vlastní',
      custom: true,
    })
  }

  return {
    totalLevel,
    classSummary: classes.map((c) => `${bundle.classes[c.classIndex]?.name ?? c.classIndex} ${c.level}`).join(' / '),
    proficiencyBonus,
    abilities,
    saves,
    skills,
    passivePerception,
    initiative,
    speed,
    ac,
    hp: { max: hpMax, current: Math.max(0, input.state.hpCurrent), temp: Math.max(0, input.state.hpTemp) },
    hitDice,
    attacks,
    attacksPerAction: 1 + extraAttacks,
    spellcasting: { classes: spellClasses, casterLevel: casterLevel(bundle, classes), slots, pact },
    resources,
    features,
    martialArtsDie,
    attunement: { used: input.items.filter((i) => i.attuned).length, max: MAX_ATTUNEMENT },
    proficiencies,
  }
}
