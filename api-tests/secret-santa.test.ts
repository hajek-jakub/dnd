import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { Client, createCampaign, expectStatus, joinAsPlayer, registerUser, testDbExec, type TestUser } from './client'

const root = path.resolve(import.meta.dirname, '..')
const draw = (...args: string[]) =>
  spawnSync('php', ['api/bin/secret-santa.php', ...args], { cwd: root, encoding: 'utf8', env: { PATH: process.env.PATH ?? '', DND_CONFIG: path.join(root, 'api/config.test.php') } })

const future = () => new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10)
const NAMES = ['Obalatomi', 'Enros', 'Borys', 'Pedro', 'Robinn']

describe('Secret Santa', () => {
  let dm: TestUser
  let players: TestUser[]
  let campaign: string

  beforeAll(async () => {
    dm = await registerUser('santadm')
    campaign = await createCampaign(dm, 'Santa')
    players = []
    for (const name of NAMES) {
      const p = await joinAsPlayer(dm, campaign, 'santa')
      expectStatus(await p.client.post(`/campaigns/${campaign}/characters`, { name, abilityScores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }, levels: [{ classIndex: 'fighter' }] }), 201)
      players.push(p)
    }
  })

  const everyone = () => [dm, ...players]
  const args = () => [`--campaign=${campaign}`, `--until=${future()}`, 'Obalatomi', 'DM', 'Enros', 'Borys', 'Pedro', 'Robin']

  it('skript s chybou nic nezapíše a suchý běh taky ne', async () => {
    const bad = draw(`--campaign=${campaign}`, `--until=${future()}`, 'Obalatomi', 'DM', 'Nikdo')
    expect(bad.status).toBe(3)
    expect(bad.stderr).toContain('Nikdo')
    expect(draw(`--campaign=${campaign}`, `--until=${future()}`, 'Obalatomi', 'DM', 'Obalatomi').status).toBe(3)
    expect(draw('--dry-run', ...args()).status).toBe(0)
    expect((await dm.client.get('/secret-santa')).body.draws).toEqual([])
  })

  it('vylosuje kruh: nikdo nemá sebe, každý dává a dostává právě jednou; skript dvojice nevypíše', async () => {
    const res = draw(...args())
    expect(res.status, res.stderr).toBe(0)
    // „Robin“ našel postavu Robinn (jednoznačný začátek jména), pod zadaným jménem
    expect(res.stdout).toContain('Robin = účet')
    for (const n of ['Obalatomi', 'DM', 'Enros', 'Borys', 'Pedro', 'Robin']) expect(res.stdout).not.toMatch(new RegExp(`${n}\\s*(→|->|dává)`))

    const labels = ['DM', ...NAMES.slice(0, 4), 'Robin']
    const receivers: string[] = []
    for (const [i, u] of everyone().entries()) {
      const list = await u.client.get('/secret-santa')
      expectStatus(list, 200)
      expect(list.body.draws).toHaveLength(1)
      const d = list.body.draws[0]
      // před odkrytím server neprozradí, komu dává
      expect(d).toMatchObject({ campaignId: campaign, me: labels[i], revealed: false, receiver: null })
      expect(JSON.stringify(list.body)).not.toContain('receiverId')
      expect(d.names).toHaveLength(5)
      expect(d.names).not.toContain(labels[i])

      const rev = await u.client.post(`/secret-santa/${d.id}/reveal`)
      expectStatus(rev, 200)
      expect(rev.body.draw.revealed).toBe(true)
      expect(rev.body.draw.receiver).not.toBe(labels[i])
      expect(d.names).toContain(rev.body.draw.receiver)
      receivers.push(rev.body.draw.receiver)
      // opakované odkrytí i seznam vrací totéž
      expect((await u.client.post(`/secret-santa/${d.id}/reveal`)).body.draw.receiver).toBe(rev.body.draw.receiver)
      expect((await u.client.get('/secret-santa')).body.draws[0].receiver).toBe(rev.body.draw.receiver)
    }
    expect([...receivers].sort()).toEqual([...labels].sort())
  })

  it('bez --force druhé losování nejde, s --force se losuje znovu a odkrývá se znovu', async () => {
    expect(draw(...args()).status).toBe(3)
    expect(draw('--force', ...args()).status).toBe(0)
    const d = (await dm.client.get('/secret-santa')).body.draws[0]
    expect(d).toMatchObject({ revealed: false, receiver: null })
  })

  it('cizinec a anonym losování nevidí ani neodkryjí; kdo z kampaně odešel, ho nevidí', async () => {
    const id = (await dm.client.get('/secret-santa')).body.draws[0].id
    const outsider = await registerUser('santacizi')
    expect((await outsider.client.get('/secret-santa')).body.draws).toEqual([])
    expect((await outsider.client.post(`/secret-santa/${id}/reveal`)).status).toBe(404)
    expect((await new Client().get('/secret-santa')).status).toBe(401)
    expect((await new Client().post(`/secret-santa/${id}/reveal`)).status).toBe(401)

    const leaver = players[4]!
    expectStatus(await dm.client.delete(`/campaigns/${campaign}/members/${leaver.id}`), 204)
    expect((await leaver.client.get('/secret-santa')).body.draws).toEqual([])
    expect((await leaver.client.post(`/secret-santa/${id}/reveal`)).status).toBe(404)
  })

  it('po --until losování zmizí', async () => {
    const id = (await dm.client.get('/secret-santa')).body.draws[0].id
    testDbExec('UPDATE secret_santa_draws SET visible_until = UTC_TIMESTAMP() - INTERVAL 1 MINUTE WHERE id = ?', [id])
    expect((await dm.client.get('/secret-santa')).body.draws).toEqual([])
    expect((await players[0]!.client.post(`/secret-santa/${id}/reveal`)).status).toBe(404)
  })

  it('losování je vždy jeden kruh bez sebe sama (1000 losování)', () => {
    const code = `require 'api/src/bootstrap_cli.php';
      $ids = ['a','b','c','d','e','f']; $bad = 0; $seen = [];
      for ($n = 0; $n < 1000; $n++) {
        $p = Dnd\\SecretSanta::cycle($ids);
        $cur = 'a'; $len = 0;
        do { if ($p[$cur] === $cur) { $bad++; } $cur = $p[$cur]; $len++; } while ($cur !== 'a' && $len < 10);
        if ($len !== 6 || count(array_unique($p)) !== 6) { $bad++; }
        $seen[$p['a']] = true;
      }
      echo json_encode(['bad' => $bad, 'targets' => count($seen)]);`
    const res = spawnSync('php', ['-r', code], { cwd: root, encoding: 'utf8', env: { PATH: process.env.PATH ?? '', DND_CONFIG: path.join(root, 'api/config.test.php') } })
    expect(res.status, res.stderr).toBe(0)
    // nic špatně a „a“ dostal za 1000 losování každého z ostatních pěti
    expect(JSON.parse(res.stdout)).toEqual({ bad: 0, targets: 5 })
  })
})
