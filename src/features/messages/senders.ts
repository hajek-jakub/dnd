import { characterPhotoUrl } from '@/features/sheet/api'
import type { CharacterListItem } from '@/features/sheet/types'

/**
 * Jak se v chatu ukazuje odesílatel: fotka jeho postavy, jinak první písmeno; DM bez fotky má „DM“. Bublina má barvu aplikace odesílatele.
 * Jméno je jméno postavy. Účet se ukáže jen tomu, kdo v kampani postavu nemá.
 */
export interface Sender {
  name: string
  /** Jméno postavy, null když hráč žádnou nemá (pak `name` je jméno účtu). */
  characterName: string | null
  photoUrl: string | null
  dm: boolean
  /** barva aplikace (#rrggbb), null = výchozí */
  accent: string | null
}

/**
 * Odesílatelé podle uživatele: hráč = jeho postava v kampani (přednost má ta s fotkou), DM = postava, kterou vlastní, nebo jméno účtu.
 * NPC (bez majitele) se nepočítají, ty DM jen hraje.
 */
export function sendersOf(
  members: { userId: string; displayName: string; role: 'dm' | 'player'; accent?: string | null }[],
  characters: CharacterListItem[],
): Map<string, Sender> {
  const out = new Map<string, Sender>()
  for (const m of members) {
    const own = characters.filter((c) => c.ownerId === m.userId && c.kind === 'pc')
    const pick = own.find((c) => c.photoVersion) ?? own[0]
    out.set(m.userId, {
      name: pick?.name ?? m.displayName,
      characterName: pick?.name ?? null,
      photoUrl: pick ? characterPhotoUrl(pick.id, pick.photoVersion) : null,
      dm: m.role === 'dm',
      accent: m.accent ?? null,
    })
  }
  return out
}
