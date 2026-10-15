import { describe, expect, it } from 'vitest'
import { convertCoins, totalGold } from './money'

const wallet = { cp: 5, sp: 25, ep: 0, gp: 3, pp: 1 }

describe('převod mincí', () => {
  it('stříbrné na zlaté jen v celých násobcích, zbytek zůstane', () => {
    const r = convertCoins(wallet, 'sp', 'gp', 25)!
    expect(r.gained).toBe(2)
    expect(r.spent).toBe(20)
    expect(r.wallet).toEqual({ cp: 5, sp: 5, ep: 0, gp: 5, pp: 1 })
  })

  it('zlaté na stříbrné a platinové na zlaté', () => {
    expect(convertCoins(wallet, 'gp', 'sp', 2)!.wallet).toMatchObject({ gp: 1, sp: 45 })
    expect(convertCoins(wallet, 'pp', 'gp', 1)!.wallet).toMatchObject({ pp: 0, gp: 13 })
  })

  it('electrum má hodnotu 5 sp', () => {
    expect(convertCoins({ ...wallet, ep: 4 }, 'ep', 'sp', 4)!.wallet).toMatchObject({ ep: 0, sp: 45 })
    expect(convertCoins({ ...wallet, ep: 2 }, 'ep', 'gp', 2)!.wallet).toMatchObject({ ep: 0, gp: 4 })
  })

  it('neplatné převody vrací null', () => {
    expect(convertCoins(wallet, 'gp', 'gp', 1)).toBeNull()
    expect(convertCoins(wallet, 'sp', 'gp', 9)).toBeNull() // z 9 sp nevyjde celá zlatá
    expect(convertCoins(wallet, 'gp', 'pp', 3)).toBeNull() // z 3 gp nevyjde platinová
    expect(convertCoins(wallet, 'gp', 'sp', 99)).toBeNull() // víc než má
    expect(convertCoins(wallet, 'gp', 'sp', 0)).toBeNull()
    expect(convertCoins(wallet, 'gp', 'sp', 1.5)).toBeNull()
  })

  it('hodnota peněz ve zlatých', () => {
    expect(totalGold(wallet)).toBe(3 + 2.5 + 10 + 0.05)
  })
})
