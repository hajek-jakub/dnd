import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { ABILITIES, SKILLS, buildRulesBundle, computeSheet } from '../src/engine'
import { toEngineInput } from '../src/features/sheet/model'
import { Client, createCampaign, expectStatus, joinAsPlayer, registerUser, type TestUser } from './client'

const root = path.resolve(import.meta.dirname, '..')
const SEED = path.join(root, 'seed/hajos.json')
const seed = JSON.parse(readFileSync(SEED, 'utf8'))

function runSeed(env: Record<string, string>, args: string[] = []) {
  const res = spawnSync('php', ['api/bin/seed-hajos.php', ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '', DND_CONFIG: path.join(root, 'api/config.test.php'), ...env },
  })
  return { code: res.status, out: res.stdout, err: res.stderr }
}

describe('seed postavy Hajoš', () => {
  let owner: TestUser
  let campaignId: string
  let characterId: string
  let character: any

  const characters = async (user: TestUser = owner, cid: string = campaignId) => (await user.client.get(`/campaigns/${cid}/characters`)).body.characters as any[]
  const hajosOf = async (cid: string = campaignId) => (await characters(owner, cid)).filter((c) => c.name === 'Hajoš')

  beforeAll(async () => {
    owner = await registerUser('seedowner')
    campaignId = await createCampaign(owner, 'Seed kampaň')
  })

  it('bez SEED_OWNER_USERNAME se zastaví s vysvětlením', () => {
    const res = runSeed({})
    expect(res.code).toBe(2)
    expect(res.err).toContain('SEED_OWNER_USERNAME')
  })

  it('neexistující uživatel nebo kampaň zastaví seed a nic nezapíše', async () => {
    const noUser = runSeed({ SEED_OWNER_USERNAME: 'neexistuje-' + Date.now() })
    expect(noUser.code).toBe(3)
    expect(noUser.err).toContain('neexistuje')
    const stranger = await registerUser('cizi')
    const notMember = runSeed({ SEED_OWNER_USERNAME: stranger.username, SEED_CAMPAIGN_ID: campaignId })
    expect(notMember.code).toBe(3)
    expect(notMember.err).toContain('není členem')
    expect(await hajosOf()).toHaveLength(0)
  })

  it('--check ověří mapování a nic nezapíše', async () => {
    const res = runSeed({ SEED_OWNER_USERNAME: owner.username, SEED_CAMPAIGN_ID: campaignId }, ['--check'])
    expect(res.code, res.err).toBe(0)
    expect(res.out).toContain('Nic se nezapsalo')
    expect(await hajosOf()).toHaveLength(0)
  })

  it('založí postavu v kampani z SEED_CAMPAIGN_ID, přiřadí ji majiteli a vypíše otevřené otázky', async () => {
    const res = runSeed({ SEED_OWNER_USERNAME: owner.username, SEED_CAMPAIGN_ID: campaignId })
    expect(res.code, res.err).toBe(0)
    expect(res.out).toContain('Postava založena')
    for (const q of seed.openQuestions) expect(res.out).toContain(q)

    const list = await hajosOf()
    expect(list).toHaveLength(1)
    characterId = list[0].id
    expect(list[0].ownerId).toBe(owner.id)
    character = (await owner.client.get(`/characters/${characterId}`)).body.character
  })

  it('ukládá jen vstupy: žádné overrides, staty, třídy, skilly, HP, peníze, inspirace', () => {
    expect(character.overrides).toEqual({})
    expect(character.abilityScores).toEqual({ str: 10, dex: 18, con: 13, int: 8, wis: 15, cha: 16 })
    expect(character.levels.map((l: any) => l.classIndex)).toEqual(['monk', 'monk', 'monk', 'monk', 'monk', 'warlock'])
    expect(character.levels.every((l: any) => l.hpRoll === null)).toBe(true)
    expect(character.subclasses).toEqual({ monk: 'open-hand', warlock: 'fiend' })
    expect(character.skillProficiencies).toEqual({ acrobatics: 1, medicine: 1, religion: 1, stealth: 1 })
    expect(character.extraSaveProficiencies).toEqual([]) // STR a DEX dává Monk sám
    // jazyky se uloží, zbraně a zbroje z papíru (Simple weapons, Shortswords, Light armor) zná engine ze tříd, takže se neukládají
    expect(character.extraProficiencies).toEqual(['Language: Common', 'Language: Orc'])
    expect(character.state.hpCurrent).toBe(39)
    expect(character.state.hpTemp).toBe(4)
    expect(character.currency).toEqual({ cp: 6, sp: 9, ep: 0, gp: 628, pp: 0 })
    expect(character.inspiration).toBe(false) // na papíře žádná inspirace není
    expect(character.state.resources).toEqual({}) // ki a pact sloty jsou plné, nic se neukládá
    expect(character.customResources).toEqual([])
    expect(character.race).toBe('Human')
  })

  it('null zůstane null: XP nedoplněno, background a alignment prázdné', () => {
    expect(character.xp).toBeNull()
    expect(character.background).toBe('')
    expect(character.alignment).toBe('')
  })

  it('TO_CONFIRM se uloží tak, jak je (poznámky postavy a itemů)', () => {
    // poznámka „Heroic“ je jen informace, nečeká na potvrzení; pravidla 2014 jsou rozhodnutá
    expect(character.notes).toBe('Na sheetu je pod nadpisem připsáno „Heroic“, význam zatím neznámý.')
    const crossbow = character.items.find((i: any) => i.name === 'Crossbow, light')
    expect(crossbow.notes).toContain('TO_CONFIRM')
    expect(crossbow.notes).toContain('Cross')
    const spear = character.items.find((i: any) => i.name === 'Demonic Spear')
    expect(spear.notes).toContain('TO_CONFIRM: nedoplněno (v seedu null): attunement, description.')
  })

  it('itemy a kouzla míří na SRD záznamy, co v SRD není je homebrew kampaně', async () => {
    const byName = (n: string) => character.items.find((i: any) => i.name === n)
    for (const name of ['Crossbow, light', 'Dart', 'Backpack', 'Bedroll', 'Mess Kit', 'Torch', 'Tinderbox', 'Rations (1 day)', 'Waterskin', 'Rope, hempen (50 feet)', 'Blanket']) {
      const item = byName(name)
      expect(item, name).toBeDefined()
      const rule = (await owner.client.get(`/rules/${item.ruleId}`)).body.entry
      expect(rule.isSrd, name).toBe(true)
    }
    expect(byName('Torch').quantity).toBe(8)
    expect(byName('Dart').quantity).toBe(9)
    expect(byName('Rations (1 day)').quantity).toBe(10)

    for (const name of ['Nunchaku', 'Demonic Spear']) {
      const item = byName(name)
      expect(item, name).toBeDefined()
      const rule = (await owner.client.get(`/rules/${item.ruleId}`)).body.entry
      expect(rule.isHomebrew, name).toBe(true)
      expect(rule.campaignId).toBe(campaignId)
      expect(rule.kind).toBe('weapon')
    }
    expect(byName('Nunchaku').weapon).toMatchObject({ damageDice: '1d8', damageType: 'Bludgeoning' }) // homebrew d8 podle papíru
    expect(byName('Nunchaku').equipped).toBe(true)
    expect(byName('Demonic Spear').equipped).toBe(true)
    expect(byName('Demonic Spear').weapon).toMatchObject({ damageDice: '1d8', damageType: 'Piercing', magicBonus: 1, extraDamage: [{ dice: '1d4', type: 'Fire' }] })

    expect(character.spells).toHaveLength(4)
    const spells: Record<string, any> = {}
    for (const sp of character.spells) {
      const entry = (await owner.client.get(`/rules/${sp.ruleId}`)).body.entry
      spells[entry.name] = { entry, sp }
      expect(sp.classIdx).toBe('warlock')
    }
    expect(Object.keys(spells).sort()).toEqual(['Command', 'Eldritch Blast', 'Hex', 'Minor Illusion'])
    expect(spells.Hex.entry.isHomebrew).toBe(true) // Hex není v SRD 5.1
    for (const name of ['Eldritch Blast', 'Minor Illusion', 'Command']) expect(spells[name].entry.isSrd, name).toBe(true)
    expect(spells['Eldritch Blast'].entry.level).toBe(0)
    expect(spells.Command.entry.level).toBe(1)
  })

  it('engine z uložených dat vychází jako papír (sheetValues), včetně útoku Demonic Spear', async () => {
    const raw = (await owner.client.get('/rules/engine')).body
    const bundle = buildRulesBundle(raw.classes, raw.levels)
    const sheet = computeSheet(toEngineInput(character), bundle)
    const v = seed.sheetValues
    expect(sheet.proficiencyBonus.value).toBe(v.proficiencyBonus)
    for (const a of ABILITIES) {
      expect(sheet.abilities[a].modifier).toBe(v.modifiers[a.toUpperCase()])
      expect(sheet.saves[a].value).toBe(v.savingThrows[a.toUpperCase()])
    }
    for (const s of SKILLS) {
      const label = Object.keys(v.skills).find((k) => k.toLowerCase().replace(/ /g, '-') === s.key)!
      expect(sheet.skills[s.key].value, label).toBe(v.skills[label])
    }
    expect(sheet.hp.max.value).toBe(seed.hitPoints.max)
    expect(sheet.hp.temp).toBe(4)
    expect(sheet.passivePerception.value).toBe(v.passivePerception)
    expect(sheet.ac.value).toBe(v.armorClass)
    expect(sheet.initiative.value).toBe(v.initiative)
    expect(sheet.speed.value).toBe(40)
    expect(sheet.resources.find((r) => r.key === 'monk.ki')?.max.value).toBe(v.kiMax)
    const spear = sheet.attacks.find((a) => a.name === 'Demonic Spear')!
    expect(spear.toHit.value).toBe(8)
    expect(spear.damageBonus.value).toBe(5)
    expect(spear.extraDamage).toEqual([{ dice: '1d4', type: 'Fire' }])
    const nunchaku = sheet.attacks.find((a) => a.name === 'Nunchaku')!
    expect(nunchaku.toHit.value).toBe(7)
    expect(nunchaku.damageDice).toBe('1d8')
    expect(nunchaku.damageBonus.value).toBe(4)
    expect(sheet.attacks.find((a) => a.name === 'Unarmed Strike')!.damageDice).toBe('1d6')
    expect(sheet.martialArtsDie).toBe('1d6')
    expect(sheet.attacks.find((a) => a.name === 'Dart')!.toHit.value).toBe(7)
    expect(sheet.attacks.find((a) => a.name === 'Crossbow, light')!.toHit.value).toBe(7)
  })

  it('druhé spuštění je idempotentní: žádná druhá postava ani homebrew', async () => {
    const homebrewCount = async () => (await owner.client.get(`/rules?kinds=weapon,spell&campaignId=${campaignId}&scope=homebrew`)).body.total
    const before = await homebrewCount()
    expect(before).toBe(3)
    const res = runSeed({ SEED_OWNER_USERNAME: owner.username, SEED_CAMPAIGN_ID: campaignId })
    expect(res.code, res.err).toBe(0)
    expect(res.out).toContain('už v kampani')
    expect(await hajosOf()).toHaveLength(1)
    expect(await homebrewCount()).toBe(before)
    const again = (await owner.client.get(`/characters/${characterId}`)).body.character
    expect(again.items).toHaveLength(character.items.length)
    expect(again.rev).toBe(character.rev)
  })

  it('--force postavu založí znovu bez duplicit homebrew', async () => {
    const res = runSeed({ SEED_OWNER_USERNAME: owner.username, SEED_CAMPAIGN_ID: campaignId }, ['--force'])
    expect(res.code, res.err).toBe(0)
    const list = await hajosOf()
    expect(list).toHaveLength(1)
    expect(list[0].id).not.toBe(characterId)
    expect((await owner.client.get(`/rules?kinds=weapon,spell&campaignId=${campaignId}&scope=homebrew`)).body.total).toBe(3)
    characterId = list[0].id
  })

  it('bez SEED_CAMPAIGN_ID založí testovací kampaň (jednu) a majitel je v ní DM', async () => {
    const user = await registerUser('seedtest')
    const first = runSeed({ SEED_OWNER_USERNAME: user.username })
    expect(first.code, first.err).toBe(0)
    expect(first.out).toContain('nově založená testovací kampaň')
    const second = runSeed({ SEED_OWNER_USERNAME: user.username })
    expect(second.code, second.err).toBe(0)
    expect(second.out).toContain('už v kampani')
    const campaigns = (await user.client.get('/campaigns')).body.campaigns as { name: string; role: string; id: string }[]
    const test = campaigns.filter((c) => c.name === 'Testovací kampaň (seed)')
    expect(test).toHaveLength(1)
    expect(test[0]!.role).toBe('dm')
    expect((await characters(user, test[0]!.id)).filter((c) => c.name === 'Hajoš')).toHaveLength(1)
  })

  it('seed s něčím, co model neumí uložit, se zastaví před zápisem', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'seed-'))
    const write = (name: string, mutate: (s: any) => void) => {
      const copy = structuredClone(seed)
      mutate(copy)
      const file = path.join(dir, name)
      writeFileSync(file, JSON.stringify(copy))
      return file
    }
    const cases: [string, (s: any) => void, string][] = [
      ['neznámá sekce', (s) => (s.feats = ['Skillful']), 'Neznámá sekce "feats"'],
      ['neznámý item', (s) => s.inventory.push({ item: 'Vorpal Banana', qty: 1 }), 'Vorpal Banana'],
      ['neznámé pole itemu', (s) => (s.inventory[3].charges = 3), 'charges'],
      ['částečně vyčerpané ki', (s) => (s.resources[0].current = 2), 'není plný'],
      ['neznámý zdroj', (s) => s.resources.push({ name: 'Rage', max: 2, current: 2 }), 'Neznámý zdroj'],
      ['neznámé kouzlo', (s) => s.spells.warlock.known.push('Fireball Of Doom'), 'Fireball Of Doom'],
      ['neznámý extraDamage', (s) => (s.inventory[2].extraDamage = 'hodně ohně'), 'extraDamage'],
    ]
    const before = (await characters()).length
    for (const [label, mutate, expected] of cases) {
      const res = runSeed({ SEED_OWNER_USERNAME: owner.username, SEED_CAMPAIGN_ID: campaignId }, ['--force', write('s.json', mutate)])
      expect(res.code, `${label}: ${res.err}`).toBe(3)
      expect(res.err, label).toContain(expected)
    }
    // --force + chyba nesmí smazat existujícího Hajoše
    expect(await hajosOf()).toHaveLength(1)
    expect((await characters()).length).toBe(before)
  })

  it('XP "nedoplněno" přežije běžné změny a DM ho umí zvednout', async () => {
    const dmCampaign = (await owner.client.get(`/characters/${characterId}`)).body.character.campaignId
    expect(dmCampaign).toBe(campaignId)
    expectStatus(await owner.client.post(`/characters/${characterId}/adjust`, { ops: [{ op: 'hp', delta: -5, max: 39 }] }), 200)
    expect((await owner.client.get(`/characters/${characterId}`)).body.character.xp).toBeNull()
    const res = await owner.client.post(`/campaigns/${campaignId}/dm/xp`, { characterIds: [characterId], amount: 150, split: false })
    expectStatus(res, 200)
    expect((await owner.client.get(`/characters/${characterId}`)).body.character.xp).toBe(150)
    const patch = await owner.client.patch(`/characters/${characterId}`, { xp: null })
    expectStatus(patch, 200)
    expect(patch.body.character.xp).toBeNull()
  })

  it('cizinec ani jiný hráč kampaně nevidí víc než veřejný náhled Hajoše', async () => {
    const player = await joinAsPlayer(owner, campaignId, 'hrac')
    const asPlayer = (await characters(player)).find((c) => c.name === 'Hajoš')
    expect(asPlayer.access).toBe('public')
    expect(asPlayer.items).toBeUndefined()
    expect(asPlayer.currency).toBeUndefined()
    expect(asPlayer.notes).toBeUndefined()
    expectStatus(await player.client.get(`/characters/${characterId}`), 403)
    const stranger = new Client()
    expect((await stranger.get(`/characters/${characterId}`)).status).toBe(401)
    const other = await registerUser('cizinec')
    expectStatus(await other.client.get(`/characters/${characterId}`), 404)
  })
})

describe('homebrew zbraň přes API', () => {
  let dm: TestUser
  let player: TestUser
  let campaignId: string
  const weapon = { kind: 'weapon', name: 'Ohnivý kyj', damageDice: '1d8', damageType: 'Bludgeoning', category: 'martial', range: 'melee', properties: ['Heavy'], weight: 5, magicBonus: 2, extraDamage: [{ dice: '2d6', type: 'Fire' }] }

  beforeAll(async () => {
    dm = await registerUser('hbdm')
    campaignId = await createCampaign(dm, 'Homebrew zbraně')
    player = await joinAsPlayer(dm, campaignId, 'hbhrac')
  })

  it('členové kampaně ji vidí, cizinec ne, neplatná data se odmítnou', async () => {
    const created = await dm.client.post(`/campaigns/${campaignId}/homebrew`, weapon)
    expectStatus(created, 201)
    const id = created.body.entry.id as string
    expect(created.body.entry.data).toMatchObject({ damage: { dice: '1d8', type: 'Bludgeoning' }, weapon_category: 'Martial', magic_bonus: 2, extra_damage: [{ dice: '2d6', type: 'Fire' }] })
    expectStatus(await player.client.get(`/rules/${id}`), 200)
    const outsider = await registerUser('cizi')
    expectStatus(await outsider.client.get(`/rules/${id}`), 404)
    expectStatus(await outsider.client.post(`/campaigns/${campaignId}/homebrew`, weapon), 404)

    for (const bad of [{ damageDice: 'hodně' }, { category: 'epic' }, { range: 'daleko' }, { magicBonus: 9 }, { extraDamage: [{ dice: 'x', type: 'Fire' }] }, { extraDamage: [1, 2, 3, 4].map(() => ({ dice: '1d4', type: 'Fire' })) }]) {
      const res = await dm.client.post(`/campaigns/${campaignId}/homebrew`, { ...weapon, name: 'Špatná', ...bad })
      expect(res.status, JSON.stringify(bad)).toBe(422)
    }
  })

  it('z homebrew zbraně vznikne zbraň v inventáři s magickým bonusem a doplňkovým zraněním', async () => {
    const id = (await dm.client.post(`/campaigns/${campaignId}/homebrew`, { ...weapon, name: 'Kyj 2' })).body.entry.id
    const char = (await player.client.post(`/campaigns/${campaignId}/characters`, { name: 'Pepa', abilityScores: { str: 16, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }, levels: [{ classIndex: 'fighter' }] })).body.character.id
    const added = await player.client.post(`/characters/${char}/items`, { ruleId: id })
    expectStatus(added, 201)
    expect(added.body.item).toMatchObject({ kind: 'weapon', weapon: { damageDice: '1d8', category: 'martial', magicBonus: 2, extraDamage: [{ dice: '2d6', type: 'Fire' }] } })
  })

  it('doplňková zranění jde nastavit i u vlastního itemu a špatná se odmítnou', async () => {
    const char = (await player.client.post(`/campaigns/${campaignId}/characters`, { name: 'Franta', abilityScores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }, levels: [{ classIndex: 'fighter' }] })).body.character.id
    const ok = await player.client.post(`/characters/${char}/items`, { name: 'Meč', kind: 'weapon', weapon: { damageDice: '1d8', damageType: 'Slashing', extraDamage: [{ dice: '1d6', type: 'Cold' }] } })
    expectStatus(ok, 201)
    expect(ok.body.item.weapon.extraDamage).toEqual([{ dice: '1d6', type: 'Cold' }])
    const bad = await player.client.post(`/characters/${char}/items`, { name: 'Meč2', kind: 'weapon', weapon: { damageDice: '1d8', damageType: 'Slashing', extraDamage: [{ dice: 'moc', type: 'Cold' }] } })
    expect(bad.status).toBe(422)
  })
})
