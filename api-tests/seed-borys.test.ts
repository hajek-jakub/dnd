import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { ABILITIES, SKILLS, buildRulesBundle, computeSheet } from '../src/engine'
import { toEngineInput } from '../src/features/sheet/model'
import { createCampaign, registerUser, type TestUser } from './client'

/**
 * Seed postavy Borys Chlupatý (seed/borys.json, Barbarian 6, Path of the Berserker, Mountain Dwarf z fotky sheetu):
 * osobnost a rychlost rasy ze seedu, Unarmored Defense, Fast Movement, Rage a útoky; engine z uložených dat musí vyjít jako papír.
 */
const root = path.resolve(import.meta.dirname, '..')
const SEED = path.join(root, 'seed/borys.json')
const seed = JSON.parse(readFileSync(SEED, 'utf8'))

function runSeed(env: Record<string, string>, args: string[] = []) {
  const res = spawnSync('php', ['api/bin/seed-hajos.php', SEED, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '', DND_CONFIG: path.join(root, 'api/config.test.php'), ...env },
  })
  return { code: res.status, out: res.stdout, err: res.stderr }
}

describe('seed postavy Borys Chlupatý', () => {
  let owner: TestUser
  let campaignId: string
  let character: any

  beforeAll(async () => {
    owner = await registerUser('borysseed')
    campaignId = await createCampaign(owner, 'Mirabilis (test)')
    const res = runSeed({ SEED_OWNER_USERNAME: owner.username, SEED_CAMPAIGN_ID: campaignId })
    if (res.code !== 0) throw new Error(res.err)
    const id = (await owner.client.get(`/campaigns/${campaignId}/characters`)).body.characters.find((c: any) => c.name === 'Borys Chlupatý').id
    character = (await owner.client.get(`/characters/${id}`)).body.character
  })

  it('uloží osobnost, rasu s rychlostí 25 ft, subclass, tools a jen vstupy', () => {
    expect(character.overrides).toEqual({})
    expect(character).toMatchObject({ race: 'Dwarf', subrace: 'Mountain Dwarf', baseSpeed: 25, alignment: 'Neutral Good', background: 'Outlander (Forester)' })
    expect(character.personality).toEqual(seed.character.personality)
    expect(character.subclasses).toEqual({ barbarian: 'berserker' })
    expect(character.levels.map((l: any) => l.hpRoll)).toEqual([null, 7, 6, 5, 5, 5])
    expect(character.extraProficiencies).toEqual(['Language: Common', 'Language: Dwarvish', "Tool: Smith's Tools", "Tool: Mason's Tools"])
    expect(character.currency).toMatchObject({ sp: 11, gp: 1079 })
    expect(character.items).toHaveLength(seed.inventory.length)
    expect(character.items.find((i: any) => i.name === 'Rudý meč')).toMatchObject({ equipped: true, weapon: { damageDice: '1d8', magicBonus: 1 } })
  })

  it('engine z uložených dat vychází jako papír (AC 14, rychlost 35, HP 64, Rage 4×, útoky)', async () => {
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
    expect(sheet.resources.find((r) => r.key === 'barbarian.rage')?.max.value).toBe(v.rageMax)
    for (const row of seed.attacks) {
      const attack = sheet.attacks.find((a) => a.name === row.name)!
      expect(attack, row.name).toBeDefined()
      expect(attack.toHit.value, `${row.name}: k20`).toBe(row.toHit)
      const m = /^(\d+d\d+)([+-]\d+)/.exec(row.damage)!
      expect(attack.damageDice, `${row.name}: kostka`).toBe(m[1])
      // Rudý meč: papír má zranění +3, jako meč +1 je to +4 (discrepancies v seedu)
      expect(attack.damageBonus.value, `${row.name}: bonus`).toBe(Number(m[2]) + (row.name === 'Rudý meč' ? 1 : 0))
    }
  })

  it('taktiky berserkera: komba odkazují na existující taktiky', async () => {
    const tactics = (await owner.client.get(`/characters/${character.id}/tactics`)).body.tactics as any[]
    const count = (kind: string) => tactics.filter((t) => t.kind === kind).length
    expect({ attack: count('attack'), ki: count('ki'), passive: count('passive'), combo: count('combo'), rule: count('rule') }).toEqual({ attack: 4, ki: 3, passive: 6, combo: 4, rule: 5 })
    const frenzy = tactics.find((t) => t.title === 'Berserk naplno (Frenzy)')
    expect(frenzy.data.uses.map((u: any) => tactics.find((t) => t.id === u.id)?.title)).toEqual(['Rage', 'Greataxe v Rage', 'Frenzy: úder navíc'])
  })
})
