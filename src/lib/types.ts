/** Tvary dat z PHP API (api/src/Controllers). Při změně API uprav i tady. */

export type Role = 'dm' | 'player'

export interface User {
  id: string
  username: string
  displayName: string
}

export interface CampaignSummary {
  id: string
  name: string
  description: string
  role: Role
}

export interface Campaign extends CampaignSummary {
  settings: Record<string, unknown>
  createdAt: string
}

export interface Member {
  userId: string
  displayName: string
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
