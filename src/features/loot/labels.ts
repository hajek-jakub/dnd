import { formatCoins } from '@/features/sheet/money'
import { ITEM_KIND_SHORT, type ItemKind } from '@/features/sheet/labels'
import type { LootEntry, LootFolder } from './api'

/** Krátký název položky lootu: item s počtem kusů, zlato názvem (nebo částkou). */
export function entryLabel(e: LootEntry): string {
  if (e.kind === 'gold') return e.data.name.trim() || formatCoins(e.data.currency)
  if (e.kind === 'enemy') return `${e.data.count > 1 ? `${e.data.count}× ` : ''}${e.data.name}`
  const q = e.data.quantity ?? 1
  return `${e.data.name}${q > 1 ? ` ×${q}` : ''}`
}

/** Řádek s podrobnostmi pod názvem: druh, vzácnost, attunement, kletba, hodnoty zbroje nebo zbraně. */
export function entryMeta(e: LootEntry): string {
  if (e.kind === 'gold') return e.data.name.trim() ? formatCoins(e.data.currency) : 'Zlato'
  if (e.kind === 'enemy') return enemyMeta(e.data)
  const d = e.data
  const armor = d.armor ? `${d.kind === 'shield' ? 'AC +' : 'AC '}${d.armor.base}${d.armor.magicBonus ? ` +${d.armor.magicBonus}` : ''}` : null
  const weapon = d.weapon ? `${d.weapon.damageDice} ${d.weapon.damageType.toLowerCase()}${d.weapon.magicBonus ? ` +${d.weapon.magicBonus}` : ''}` : null
  return [
    d.kind ? ITEM_KIND_SHORT[d.kind as ItemKind] : null,
    armor,
    weapon,
    d.rarity,
    d.requiresAttunement ? 'attunement' : null,
    d.consumable ? 'spotřebuje se' : null,
    d.charges ? `náboje ${d.charges.max}${d.charges.recharge ? ` (obnova ${d.charges.recharge === 'all' ? 'všech' : d.charges.recharge})` : ''}` : null,
    d.curse ? (d.curseRevealed ? 'kletba (odhalená)' : 'kletba (skrytá)') : null,
  ]
    .filter(Boolean)
    .join(' · ')
}

/** Cesta ke složce („Dungeon › Místnost 1“). */
export function folderPath(folders: LootFolder[], id: string | null): string {
  if (id === null) return 'Nezařazené'
  const parts: string[] = []
  let f = folders.find((x) => x.id === id)
  for (let guard = 0; f && guard < 10; guard++) {
    parts.unshift(f.name)
    const parentId = f.parentId
    f = parentId === null ? undefined : folders.find((x) => x.id === parentId)
  }
  return parts.join(' › ')
}

/** Řádek s hodnotami nepřítele: CR, AC, HP a útoky („Scimitar +4 (1d6+2)“). */
export function enemyMeta(d: { cr: string | null; ac: number | null; hpMax: number; attacks: { name: string; toHit: number; damage: string }[] }): string {
  return [
    d.cr ? `CR ${d.cr}` : null,
    d.ac !== null ? `AC ${d.ac}` : null,
    `HP ${d.hpMax}`,
    ...d.attacks.slice(0, 3).map((a) => `${a.name} ${a.toHit >= 0 ? '+' : '−'}${Math.abs(a.toHit)}${a.damage ? ` (${a.damage})` : ''}`),
  ]
    .filter(Boolean)
    .join(' · ')
}
