export const PIN_ICONS: { value: string; emoji: string; label: string }[] = [
  { value: 'pin', emoji: '📍', label: 'Bod' },
  { value: 'castle', emoji: '🏰', label: 'Hrad' },
  { value: 'town', emoji: '🏘️', label: 'Město' },
  { value: 'camp', emoji: '⛺', label: 'Tábor' },
  { value: 'cave', emoji: '🕳️', label: 'Jeskyně' },
  { value: 'door', emoji: '🚪', label: 'Dveře' },
  { value: 'danger', emoji: '⚠️', label: 'Nebezpečí' },
  { value: 'skull', emoji: '☠️', label: 'Smrt' },
  { value: 'treasure', emoji: '💰', label: 'Poklad' },
  { value: 'quest', emoji: '❗', label: 'Úkol' },
  { value: 'npc', emoji: '🧙', label: 'Postava' },
]

export const emojiOf = (icon: string): string => PIN_ICONS.find((i) => i.value === icon)?.emoji ?? '📍'

export const VISIBILITY_LABELS: Record<string, string> = {
  all: 'Vidí všichni',
  selected: 'Vidí vybraní hráči a DM',
  dm: 'Vidí jen DM',
  owner: 'Soukromá poznámka (vidíš jen ty)',
}
