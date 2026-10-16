import { formatCoins } from '@/features/sheet/money'
import { ITEM_KIND_SHORT, type ItemKind } from '@/features/sheet/labels'
import type { LootEntry, LootFolder } from './api'

/** Krátký název položky lootu: item s počtem kusů, zlato názvem (nebo částkou). */
export function entryLabel(e: LootEntry): string {
  if (e.kind === 'gold') return e.data.name.trim() || formatCoins(e.data.currency)
  const q = e.data.quantity ?? 1
  return `${e.data.name}${q > 1 ? ` ×${q}` : ''}`
}

/** Řádek s podrobnostmi pod názvem: druh, vzácnost, attunement, kletba, hodnoty zbroje nebo zbraně. */
export function entryMeta(e: LootEntry): string {
  if (e.kind === 'gold') return e.data.name.trim() ? formatCoins(e.data.currency) : 'Zlato'
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
