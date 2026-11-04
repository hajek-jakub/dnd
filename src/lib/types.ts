/** Tvary dat z PHP API (api/src/Controllers). Při změně API uprav i tady. */

export type Role = 'dm' | 'player'

export interface User {
  id: string
  username: string
  displayName: string
  /** barva motivu aplikace (#rrggbb), null = výchozí */
  accent: string | null
}

export interface CampaignSummary {
  id: string
  name: string
  description: string
  role: Role
  /** jen v seznamu GET /campaigns: moje hráčská postava v kampani */
  myCharacter?: { id: string; name: string; photoVersion: string | null } | null
  /** jen v seznamu: nejbližší session (místní datum RRRR-MM-DD a čas) */
  nextSession?: { date: string; time: string | null } | null
  memberCount?: number
}

/** Čekající pozvánka existujícího uživatele (pohled DM). */
export interface CampaignInvitation {
  id: string
  userId: string
  username: string
  displayName: string
  createdAt: string
}

/** Pozvánka, kterou jsem dostal (z /summary). */
export interface MyInvitation {
  id: string
  campaignId: string
  campaignName: string
  dmName: string
  invitedBy: string
  createdAt: string
}

export interface InviteSuggestion {
  userId: string
  username: string
  displayName: string
}

export interface Campaign extends Omit<CampaignSummary, 'myCharacter' | 'nextSession' | 'memberCount'> {
  settings: Record<string, unknown>
  createdAt: string
}

export interface Member {
  userId: string
  displayName: string
  /** barva aplikace člena (#rrggbb), null = výchozí */
  accent: string | null
  role: Role
  joinedAt: string
}

export interface Invite {
  id: string
  code: string
  createdAt: string
  expiresAt: string | null
  maxUses: number | null
  uses: number
  revoked: boolean
}

export interface InvitePreview {
  campaignId: string
  campaignName: string
  dmName: string
  alreadyMember: boolean
}

// ---------------------------------------------------------------- pravidla a homebrew

export type RuleKind =
  | 'spell'
  | 'magic_item'
  | 'equipment'
  | 'weapon'
  | 'armor'
  | 'feature'
  | 'feat'
  | 'class'
  | 'subclass'
  | 'race'
  | 'subrace'
  | 'trait'
  | 'condition'
  | 'background'
  | 'skill'
  | 'language'
  | 'weapon_property'
  | 'ability'
  | 'monster'

export interface RuleSummary {
  id: string
  kind: RuleKind
  name: string
  nameCs: string | null
  level: number | null
  category: string | null
  rarity: string | null
  attunement: boolean | null
  source: string
  isSrd: boolean
  isHomebrew: boolean
  campaignId: string | null
  priceGp: number | null
  priceNote: string | null
  summary: string
  hasText: boolean
}

export interface RuleDetail {
  id: string
  ruleset: string
  kind: RuleKind
  name: string
  nameCs: string | null
  description: string
  descriptionCs: string | null
  level: number | null
  category: string | null
  rarity: string | null
  attunement: boolean | null
  source: string
  isSrd: boolean
  isHomebrew: boolean
  campaignId: string | null
  ownerName: string | null
  visibility: 'campaign' | 'private' | null
  priceGp: number | null
  priceNote: string | null
  refUrl: string | null
  tags: string[]
  data: Record<string, unknown>
  canEdit: boolean
  /** Magická zbroj, štít nebo zbraň: typ a základ z SRD, který se nabídne při přidání itemu (null = vybrat). */
  itemBase: { type: 'armor' | 'shield' | 'weapon'; baseRuleId: string | null } | null
  /** Nestvůra: hodnoty pro nového nepřítele (HP, AC, iniciativa, útoky, poznámka, CR a XP). */
  enemyTemplate: EnemyTemplate | null
}

/** Šablona nepřítele (nestvůra z pravidel, nepřítel v přípravě lootu). */
export interface EnemyTemplate {
  name: string
  hpMax: number
  ac: number | null
  initiative: number
  attacks: { name: string; toHit: number; damage: string }[]
  notes: string
  cr: string | null
  xp: number | null
  /** jen v přípravě: kolik nepřátel tohoto druhu */
  count?: number
}

export interface RuleFacets {
  categories: string[]
  rarities: string[]
  sources: string[]
  levels: number[]
  tags: string[]
}

export type HomebrewKind = 'spell' | 'magic_item' | 'feature' | 'subclass' | 'weapon'
