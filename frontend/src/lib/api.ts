import type { Consent, Dashboard, Invitation, MissionAttempt, Role, Squad, User } from '../types'

let csrfToken = ''
const retryKeys = new Map<string, string>()

function stableIdempotencyKey(scope: string) {
  const storageKey = `crunch:idempotency:${scope}`
  try {
    const existing = window.localStorage.getItem(storageKey)
    if (existing) return existing
    const created = crypto.randomUUID()
    window.localStorage.setItem(storageKey, created)
    return created
  } catch {
    const existing = retryKeys.get(scope)
    if (existing) return existing
    const created = crypto.randomUUID()
    retryKeys.set(scope, created)
    return created
  }
}

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message)
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers)
  if (options.body) headers.set('Content-Type', 'application/json')
  if (csrfToken && options.method && options.method !== 'GET') headers.set('X-CSRF-Token', csrfToken)
  const response = await fetch(`/api/v1${path}`, { ...options, headers, credentials: 'include' })
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: { code: 'request_failed', message: 'Request failed' } }))
    throw new ApiError(response.status, body.error?.code ?? 'request_failed', body.error?.message ?? 'Request failed')
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

const post = <T>(path: string, body: unknown, headers?: Record<string, string>) =>
  request<T>(path, { method: 'POST', body: JSON.stringify(body), headers })

export const api = {
  async mockAuth(mockUserId: string) {
    const response = await post<{ user: User; csrfToken: string }>('/auth/mock', { mockUserId })
    csrfToken = response.csrfToken
    return response.user
  },
  async lineAuth(idToken: string) {
    const response = await post<{ user: User; csrfToken: string }>('/auth/line', { idToken })
    csrfToken = response.csrfToken
    return response.user
  },
  async me() {
    const response = await request<{ user: User; consent: Consent; csrfToken: string; squad?: Squad }>('/me')
    csrfToken = response.csrfToken
    return response
  },
  consent: (requiredAccepted: boolean, analyticsAllowed: boolean) => post<Consent>('/consent', { requiredAccepted, analyticsAllowed }),
  createSquad: (name: string) => post<{ squad: Squad; invitation: Invitation }>('/squads', { name }),
  joinSquad: (token: string) => post<Squad>('/squads/join', { token }),
  getSquad: (id: string) => request<Squad>(`/squads/${id}`),
  invite: (id: string) => post<Invitation>(`/squads/${id}/invitations`, {}),
  claimRole: (id: string, role: Role) => post<Squad>(`/squads/${id}/roles/${role}`, {}),
  mission: (role: Role) => request<Record<string, unknown>>(`/missions/${role}`),
  startMission: (id: string, role: Role) => post<MissionAttempt>(`/squads/${id}/missions/${role}/start`, {}),
  completeMission: (id: string, role: Role, attemptId: string, properties: Record<string, unknown>) =>
    post<{ squad: Squad }>(`/squads/${id}/missions/${role}/complete`, { attemptId, properties }, { 'Idempotency-Key': stableIdempotencyKey(`mission:${id}:${role}`) }),
  validateQR: (token: string, attemptId: string) => post<{ locationId: string }>('/qr/validate', { token, attemptId }),
  redeem: (id: string) => post<Squad>(`/squads/${id}/reward/redeem`, {}, { 'Idempotency-Key': stableIdempotencyKey(`reward:${id}`) }),
  event: (name: string, details: Record<string, unknown> = {}) => post<{ stored: boolean }>('/events', { name, ...details }),
  adminMetrics: (token: string) => request<Dashboard>('/admin/metrics', { headers: { 'X-Admin-Token': token } }),
  async exportAdminEvents(token: string) {
    const response = await fetch('/api/v1/admin/events.csv', { headers: { 'X-Admin-Token': token }, credentials: 'include' })
    if (!response.ok) throw new ApiError(response.status, 'export_failed', 'CSV export failed')
    return response.blob()
  },
  setCSRFForTests: (value: string) => { csrfToken = value },
}

