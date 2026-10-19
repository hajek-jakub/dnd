import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { ABILITIES, SKILLS, buildRulesBundle, computeSheet } from '../src/engine'
import { toEngineInput } from '../src/features/sheet/model'
import { createCampaign, registerUser, type TestUser } from './client'

/**
 * Seed postavy Pedro (seed/pedro.json, Ranger 6 z PDF sheetu): vlastní předměty mimo pravidla, homebrew pistole s vlastními hodnotami,
 * Fighting Style Archery jako trvalý bonus a HP z hodů. Engine z uložených dat musí vyjít jako papír.
 */
const root = path.resolve(import.meta.dirname, '..')
const SEED = path.join(root, 'seed/pedro.json')
const seed = JSON.parse(readFileSync(SEED, 'utf8'))

function runSeed(env: Record<string, string>, args: string[] = []) {
  const res = spawnSync('php', ['api/bin/seed-hajos.php', SEED, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '', DND_CONFIG: path.join(root, 'api/config.test.php'), ...env },
  })
  return { code: res.status, out: res.stdout, err: res.stderr }
}

describe('seed postavy Pedro', () => {
  let owner: TestUser
  let campaignId: string
  let character: any

  beforeAll(async () => {
    owner = await registerUser('pedroseed')
    campaignId = await createCampaign(owner, 'Mirabilis (test)')
    // hráč si Pedra založil sám (jen staty a dovednosti), seed ho s --force založí znovu se vším
    await owner.client.post(`/campaigns/${campaignId}/characters`, {
      name: 'Pedro',
      race: 'Human',
      abilityScores: { str: 9, dex: 18, con: 13, int: 11, wis: 15, cha: 14 },
      levels: Array.from({ length: 6 }, () => ({ classIndex: 'ranger', hpRoll: null })),
    })
  })

  it('--check projde bez zápisu, bez --force existujícího Pedra nechá být', async () => {
    const check = runSeed({ SEED_OWNER_USERNAME: owner.username, SEED_CAMPAIGN_ID: campaignId }, ['--check'])
    expect(check.code, check.err).toBe(0)
    const plain = runSeed({ SEED_OWNER_USERNAME: owner.username, SEED_CAMPAIGN_ID: campaignId })
    expect(plain.code, plain.err).toBe(0)
    const list = (await owner.client.get(`/campaigns/${campaignId}/characters`)).body.characters.filter((c: any) => c.name === 'Pedro')
    expect(list).toHaveLength(1)
    expect((await owner.client.get(`/characters/${list[0].id}`)).body.character.items).toHaveLength(0)
  })

  it('--force založí Pedra znovu se vším z papíru', async () => {
    const res = runSeed({ SEED_OWNER_USERNAME: owner.username, SEED_CAMPAIGN_ID: campaignId }, ['--force'])
    expect(res.code, res.err).toBe(0)
    const list = (await owner.client.get(`/campaigns/${campaignId}/characters`)).body.characters.filter((c: any) => c.name === 'Pedro')
    expect(list).toHaveLength(1)
    character = (await owner.client.get(`/characters/${list[0].id}`)).body.character
    expect(character.overrides).toEqual({})
    expect(character.levels.map((l: any) => l.hpRoll)).toEqual([null, 6, 5, 5, 5, 5])
    expect(character.subclasses).toEqual({})
    expect(character.extraProficiencies).toEqual(['Language: Common', 'Language: Elvish', 'Language: Giant', 'Language: Infernal', 'Weapon: Firearms (Cowboy Marksmanship)', "Tool: Tinker's Tools"])
    expect(character.currency).toMatchObject({ cp: 13, sp: 90, gp: 372, pp: 12 })
    expect(character.description).toContain('El Rayo')
    expect(character.notes).toContain('TO_CONFIRM: Find Steed')
  })

  it('vlastní předměty, homebrew pistole s vlastními hodnotami a SRD vybavení', () => {
    const byName = (n: string) => character.items.find((i: any) => i.name === n)
    expect(character.items).toHaveLength(seed.inventory.length)
    expect(byName('Pistol')).toMatchObject({ quantity: 2, kind: 'weapon', equipped: true, weapon: { damageDice: '1d6', damageType: 'Fire', category: 'martial', range: 'ranged' } })
    expect(byName('Bullets')).toMatchObject({ quantity: 22, kind: 'other', consumable: true, ruleId: null })
    expect(byName('Robo pavouk na poplach')).toMatchObject({ kind: 'wondrous', description: expect.stringContaining('poplach'), notes: expect.stringMatching(/^TO_CONFIRM/) })
    expect(byName('Dýka z rudé oceli')).toMatchObject({ kind: 'weapon', equipped: false, weapon: { damageDice: '1d4' } })
    expect(byName('Leather Armor')).toMatchObject({ kind: 'armor', equipped: true })
    expect(byName('Rations (1 day)').quantity).toBe(10)
    expect(byName('Dagger').equipped).toBe(true)
    expect(character.spells.map((s: any) => s.name).sort()).toEqual(['Animal Friendship', 'Find Steed', 'Goodberry', "Hunter's Mark", 'Silence', 'Speak with Animals'])
    expect(character.effects).toEqual([expect.objectContaining({ target: 'attack.ranged', value: 2, source: 'Fighting Style: Archery', duration: 'permanent' })])
  })

  it('engine z uložených dat vychází jako papír (AC, HP 42, útoky s Archery, kouzla)', async () => {
    const raw = (await owner.client.get('/rules/engine')).body
    const sheet = computeSheet(toEngineInput(character), buildRulesBundle(raw.classes, raw.levels))
    const v = seed.sheetValues
    expect(sheet.proficiencyBonus.value).toBe(v.proficiencyBonus)
    for (const a of ABILITIES) {
      expect(sheet.abilities[a].modifier, a).toBe(v.modifiers[a.toUpperCase()])
      expect(sheet.saves[a].value, `save ${a}`).toBe(v.savingThrows[a.toUpperCase()])
    }
    for (const s of SKILLS) {
      const label = Object.keys(v.skills).find((k) => k.toLowerCase().replace(/ /g, '-') === s.key)!
      expect(sheet.skills[s.key].value, label).toBe(v.skills[label])
    }
    expect(sheet.hp.max.value).toBe(v.hitPointMax)
    expect(sheet.passivePerception.value).toBe(v.passivePerception)
    expect(sheet.ac.value).toBe(v.armorClass)
    expect(sheet.initiative.value).toBe(v.initiative)
    expect(sheet.speed.value).toBe(v.speed)
    expect(sheet.attacksPerAction).toBe(2)
    for (const row of seed.attacks) {
      const attack = sheet.attacks.find((a) => a.name === row.name)!
      expect(attack, row.name).toBeDefined()
      expect(attack.toHit.value, `${row.name}: k20`).toBe(row.toHit)
      const m = /^(\d+d\d+)([+-]\d+)/.exec(row.damage)!
      expect(attack.damageDice, `${row.name}: kostka`).toBe(m[1])
      expect(attack.damageBonus.value, `${row.name}: bonus`).toBe(Number(m[2]))
    }
    const ranger = sheet.spellcasting.classes.find((c) => c.classIndex === 'ranger')!
    expect(ranger.saveDc.value).toBe(v.spellSaveDC)
    expect(ranger.attackBonus.value).toBe(v.spellAttack)
    expect(Object.fromEntries(sheet.spellcasting.slots.filter((s) => s.max > 0).map((s) => [String(s.level), s.max]))).toEqual(v.spellSlots)
  })

  it('taktiky: pistole střílí kulkami a s Hunter\'s Mark, komba odkazují na existující taktiky', async () => {
    const tactics = (await owner.client.get(`/characters/${character.id}/tactics`)).body.tactics as any[]
    const count = (kind: string) => tactics.filter((t) => t.kind === kind).length
    expect({ attack: count('attack'), spell: count('spell'), ki: count('ki'), passive: count('passive'), combo: count('combo'), rule: count('rule') }).toEqual({ attack: 4, spell: 6, ki: 3, passive: 5, combo: 6, rule: 6 })
    const pistol = tactics.find((t) => t.title === 'Pistole')
    expect(pistol.data).toMatchObject({ toHit: 'd20+9', roll: '1d6+4', count: 2, hex: true, ammo: character.items.find((i: any) => i.name === 'Bullets').id })
    const hunt = tactics.find((t) => t.title === "Lov: Hunter's Mark a 2 výstřely")
    expect(hunt.data.uses.map((u: any) => tactics.find((t) => t.id === u.id)?.title)).toEqual(["Hunter's Mark", 'Pistole'])
  })
})
