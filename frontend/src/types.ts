export type Role = 'flavor_scout' | 'crunch_creator' | 'snack_detective' | 'qr_runner'

export type User = { id: string; displayName: string }
export type Consent = { requiredAccepted: boolean; analyticsAllowed: boolean }
export type Member = { userId: string; displayName: string; role?: Role; completed: boolean; joinedAt: string }
export type Squad = {
  id: string
  campaignId: string
  name: string
  status: string
  members: Member[]
  rewardUnlocked: boolean
  rewardUnlockId?: string
  rewardRedeemed: boolean
  createdAt: string
}
export type Invitation = { token: string; squadId: string; expiresAt: string }
export type MissionAttempt = { id: string; squadId: string; role: Role; challenge: Record<string, unknown>; status: string; startedAt: string; expiresAt: string }
export type Dashboard = {
  uniquePlayers: number
  squadsCreated: number
  completedSquads: number
  rewardsUnlocked: number
  rewardsRedeemed: number
  eventsByName: Record<string, number>
  completionsByRole: Record<Role, number>
}

export const roles: { code: Role; title: string; icon: string; description: string }[] = [
  { code: 'flavor_scout', title: 'นักล่ารสชาติ', icon: '◎', description: 'ตามล่ารสชาติให้ครบตามลำดับ' },
  { code: 'crunch_creator', title: 'ครีเอเตอร์สายครันช์', icon: '✦', description: 'ออกแบบโมเมนต์กินเลย์ให้เป็นสไตล์คุณ' },
  { code: 'snack_detective', title: 'นักสืบสายสแน็ก', icon: '?', description: 'แก้ปริศนาและค้นหาคำตอบที่ซ่อนอยู่' },
  { code: 'qr_runner', title: 'นักวิ่ง QR', icon: '⌁', description: 'ค้นหาและยืนยันโค้ดจากจุดกิจกรรม' },
]

