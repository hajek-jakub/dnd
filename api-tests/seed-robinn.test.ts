import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { ABILITIES, SKILLS, buildRulesBundle, computeSheet } from '../src/engine'
import { toEngineInput } from '../src/features/sheet/model'
import { createCampaign, expectStatus, registerUser, type TestUser } from './client'

/**
 * Seed postavy Robinn (seed/robinn.json, Rogue 6 Thief) v režimu --update: postava už je rozehraná (předměty, přejmenovaný prsten,
 * inspirace), seed ji jen doplní. Nic nesmaže ani nezdvojí, chybějící itemy přidá, staty, dovednosti a HP přepíše podle papíru.
 */
const root = path.resolve(import.meta.dirname, '..')
const SEED = path.join(root, 'seed/robinn.json')
const seed = JSON.parse(readFileSync(SEED, 'utf8'))

function runSeed(env: Record<string, string>, args: string[] = []) {
  const res = spawnSync('php', ['api/bin/seed-hajos.php', SEED, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '', DND_CONFIG: path.join(root, 'api/config.test.php'), ...env },
  })
  return { code: res.status, out: res.stdout, err: res.stderr }
}

async function rule(user: TestUser, kind: string, name: string): Promise<string> {
  const res = await user.client.get(`/rules?kinds=${kind}&q=${encodeURIComponent(name)}&limit=10`)
  return res.body.entries.find((e: any) => e.name === name).id
}

describe('seed postavy Robinn (--update rozehrané postavy)', () => {
  let owner: TestUser
  let campaignId: string
  let id: string
  let character: any

  beforeAll(async () => {
    owner = await registerUser('robinnseed')
    campaignId = await createCampaign(owner, 'Mirabilis (test)')
    // jako na ostrém serveru: hráč si Robinna založil, dal mu předměty a inspiraci, vlastnosti nechal na 10
    const created = await owner.client.post(`/campaigns/${campaignId}/characters`, {
      name: 'Robinn',
      race: 'Drow elf',
      baseSpeed: 40,
      abilityScores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
      levels: Array.from({ length: 6 }, () => ({ classIndex: 'rogue', hpRoll: null })),
      subclasses: { rogue: 'thief' },
    })
    expectStatus(created, 201)
    id = created.body.character.id
    await owner.client.patch(`/characters/${id}`, { inspiration: true, notes: 'Moje poznámka.' })
    await owner.client.post(`/characters/${id}/items`, { ruleId: await rule(owner, 'magic_item', 'Boots of Elvenkind') })
    await owner.client.post(`/characters/${id}/items`, { ruleId: await rule(owner, 'magic_item', 'Ring of Mind Shielding'), name: 'Prsten Runové Vůle' })
    await owner.client.post(`/characters/${id}/items`, { name: 'Magic Key', kind: 'wondrous', description: 'Má 5% šanci na to, otevřít jakýkoliv zámek.' })
  })

  it('bez existující postavy nebo s jinými levely se --update zastaví a nic nezapíše', async () => {
    const missing = runSeed({ SEED_OWNER_USERNAME: owner.username, SEED_CAMPAIGN_ID: campaignId, SEED_CHARACTER_NAME: 'Neexistuje' }, ['--update'])
    expect(missing.code).toBe(3)
    expect(missing.err).toContain('neexistuje')
    const other = await owner.client.post(`/campaigns/${campaignId}/characters`, {
      name: 'Robinn 2',
      abilityScores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
      levels: Array.from({ length: 5 }, () => ({ classIndex: 'rogue', hpRoll: null })),
    })
    const wrongLevels = runSeed({ SEED_OWNER_USERNAME: owner.username, SEED_CAMPAIGN_ID: campaignId, SEED_CHARACTER_NAME: 'Robinn 2' }, ['--update'])
    expect(wrongLevels.code).toBe(3)
    expect(wrongLevels.err).toContain('nesedí')
    expect((await owner.client.get(`/characters/${other.body.character.id}`)).body.character.abilityScores.dex).toBe(10)
  })

  it('doplní staty, dovednosti, HP a chybějící itemy; nic nesmaže ani nezdvojí', async () => {
    const res = runSeed({ SEED_OWNER_USERNAME: owner.username, SEED_CAMPAIGN_ID: campaignId }, ['--update'])
    expect(res.code, res.err).toBe(0)
    expect(res.out).toContain('Už je měla (nechané beze změny): Boots of Elvenkind, Ring of Mind Shielding, Magic Key')
    character = (await owner.client.get(`/characters/${id}`)).body.character
    expect(character.abilityScores).toEqual({ str: 10, dex: 16, con: 8, int: 13, wis: 12, cha: 16 })
    expect(character.skillProficiencies).toEqual({ acrobatics: 1, deception: 1, perception: 2, 'sleight-of-hand': 2, stealth: 2 })
    expect(character.levels.map((l: any) => l.hpRoll)).toEqual([null, 6, 6, 5, 5, 5])
    expect(character.state.hpCurrent).toBe(29)
    expect(character.inspiration).toBe(true)
    expect(character.race).toBe('Drow elf')
    expect(character.background).toBe('Criminal (Spy)')
    expect(character.notes).toMatch(/^Moje poznámka\.\nRasa: Darkvision 120 ft/)
    expect(character.extraProficiencies).toEqual(['Language: Common', 'Language: Elvish', "Language: Thieves' Cant", 'Weapon: Longbow', 'Tool: Dice set', 'Tool: Flute'])
    const names = character.items.map((i: any) => i.name).sort()
    expect(names).toEqual(['Boots of Elvenkind', 'Cloak of Elvenkind', 'Dagger', 'Leather Armor', 'Longbow', 'Magic Key', 'Masquerade Tattoo', 'Prsten Runové Vůle', 'Shortsword', "Thieves' Tools"])
    expect(character.items.find((i: any) => i.name === 'Leather Armor').equipped).toBe(true)
    expect(character.items.find((i: any) => i.name === 'Cloak of Elvenkind')).toMatchObject({ attuned: true })

    // podruhé už nic nepřidá
    const again = runSeed({ SEED_OWNER_USERNAME: owner.username, SEED_CAMPAIGN_ID: campaignId }, ['--update'])
    expect(again.code, again.err).toBe(0)
    expect(again.out).toContain('Přidané itemy: žádné')
    const after = (await owner.client.get(`/characters/${id}`)).body.character
    expect(after.items).toHaveLength(character.items.length)
    expect(after.notes).toBe(character.notes)
  })

  it('engine vychází jako papír (kromě iniciativy a bonusů zbraní, které se ověřují)', async () => {
    const raw = (await owner.client.get('/rules/engine')).body
    const sheet = computeSheet(toEngineInput(character), buildRulesBundle(raw.classes, raw.levels))
    const v = seed.sheetValues
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
    expect(sheet.speed.value).toBe(v.speed)
    expect(sheet.initiative.value).toBe(3) // papír +5 (viz discrepancies)
    for (const name of ['Shortsword', 'Longbow', 'Dagger']) {
      const attack = sheet.attacks.find((a) => a.name === name)!
      expect(attack.toHit.value, name).toBe(6) // DEX 3 + proficiency 3 (longbow z elfího výcviku)
      expect(attack.damageBonus.value, name).toBe(3)
    }
  })

  it('taktiky zloděje: Sneak Attack, komba odkazují na existující taktiky', async () => {
    const tactics = (await owner.client.get(`/characters/${id}/tactics`)).body.tactics as any[]
    const count = (kind: string) => tactics.filter((t) => t.kind === kind).length
    expect({ attack: count('attack'), ki: count('ki'), passive: count('passive'), combo: count('combo'), rule: count('rule') }).toEqual({ attack: 4, ki: 3, passive: 5, combo: 4, rule: 5 })
    expect(tactics.find((t) => t.title === 'Sneak Attack').data).toMatchObject({ roll: '3d6', cost: 'free' })
    const blades = tactics.find((t) => t.title === 'Dvě čepele se spojencem')
    expect(blades.data.uses.map((u: any) => tactics.find((t) => t.id === u.id)?.title)).toEqual(['Shortsword (hlavní ruka)', 'Sneak Attack', 'Shortsword (druhá ruka)'])
  })
})
