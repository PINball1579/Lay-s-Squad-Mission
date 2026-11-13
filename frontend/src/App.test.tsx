import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { lineAdapter } from './lib/liff'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  window.history.replaceState({}, '', '/')
})

function response(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

describe('LIFF bootstrap states', () => {
  it('shows the Thai player choices after an unauthenticated session', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ error: { code: 'authentication_required', message: 'Authentication required' } }, 401)))
    render(<App />)
    expect(screen.getByText(/กำลังเตรียมความครันช์/)).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: /รวมทีมให้ครบ/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'mali' })).toBeInTheDocument()
  })

  it('provides a Thai retry action when startup fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network unavailable')))
    render(<App />)
    expect(await screen.findByRole('heading', { name: /ความครันช์สะดุด/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /ลองอีกครั้ง/ })).toBeInTheDocument()
  })

  it('consumes an invite link automatically and opens role locking', async () => {
    window.history.replaceState({}, '', '/?invite=invite-token')
    const squad = {
      id: 'squad-1', campaignId: 'demo-campaign', name: 'ทีมกรุบกรอบ', status: 'active',
      members: [
        { userId: 'mock:mali', displayName: 'Mali', completed: false, joinedAt: new Date().toISOString() },
        { userId: 'mock:nok', displayName: 'Nok', completed: false, joinedAt: new Date().toISOString() },
      ],
      rewardUnlocked: false, rewardRedeemed: false, createdAt: new Date().toISOString(),
    }
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/api/v1/me')) return response({ user: { id: 'mock:nok', displayName: 'Nok' }, consent: { requiredAccepted: true, analyticsAllowed: false }, csrfToken: 'csrf' })
      if (url.endsWith('/api/v1/squads/join')) {
        expect(init?.method).toBe('POST')
        expect(JSON.parse(String(init?.body))).toEqual({ token: 'invite-token' })
        return response(squad)
      }
      if (url.endsWith('/api/v1/squads/squad-1')) return response(squad)
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<App />)
    expect(await screen.findByRole('heading', { name: /เลือกและล็อกภารกิจของคุณ/ })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'ล็อกภารกิจนี้' })).toHaveLength(4)
    expect(screen.queryByLabelText(/Invitation code/i)).not.toBeInTheDocument()
    expect(window.location.search).toBe('')
  })
})

describe('invite friend picker flow', () => {
  it.each(['sent', 'cancelled'] as const)('prepares the link before the tap and handles %s accurately', async (result) => {
    const squad = { id: 'squad-share', campaignId: 'demo-campaign', name: 'ทีมกรุบกรอบ', status: 'active', members: [{ userId: 'mock:mali', displayName: 'Mali', completed: false, joinedAt: new Date().toISOString() }], rewardUnlocked: false, rewardRedeemed: false, createdAt: new Date().toISOString() }
    let provideInvite: (value: ReturnType<typeof response>) => void = () => undefined
    const invitationResponse = new Promise<ReturnType<typeof response>>(resolve => { provideInvite = resolve })
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/me')) return response({ user: { id: 'mock:mali', displayName: 'Mali' }, consent: { requiredAccepted: true, analyticsAllowed: false }, csrfToken: 'csrf', squad })
      if (url.endsWith('/invitations')) return invitationResponse
      if (url.endsWith('/events')) { expect(init?.method).toBe('POST'); return response({ stored: false }) }
      if (url.endsWith('/squads/squad-share')) return response(squad)
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const share = vi.spyOn(lineAdapter, 'share').mockResolvedValue(result)
    render(<App />)
    expect(await screen.findByRole('button', { name: 'กำลังเตรียมคำเชิญ…' })).toBeDisabled()
    provideInvite(response({ token: 'ready-before-tap', squadId: squad.id, expiresAt: new Date(Date.now() + 600_000).toISOString() }))
    const invite = await screen.findByRole('button', { name: 'ชวนเพื่อนเข้าทีม' })
    await waitFor(() => expect(invite).toBeEnabled())
    const preparedRequests = fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/invitations')).length
    await userEvent.click(invite)
    expect(share).toHaveBeenCalledWith(expect.objectContaining({ squadName: squad.name, url: expect.stringContaining('invite=ready-before-tap') }))
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/invitations'))).toHaveLength(preparedRequests)
    if (result === 'sent') expect(await screen.findByText('ส่งการ์ดชวนเพื่อนใน LINE แล้ว!')).toBeInTheDocument()
    else {
      expect(await screen.findByText('ยังไม่ได้ส่งคำเชิญ เลือกเพื่อนแล้วส่งได้ทุกเมื่อ')).toBeInTheDocument()
      expect(screen.queryByText('ส่งการ์ดชวนเพื่อนใน LINE แล้ว!')).not.toBeInTheDocument()
      expect(fetchMock.mock.calls.filter(([url, init]) => String(url).endsWith('/events') && String((init as RequestInit | undefined)?.body).includes('share_completed'))).toHaveLength(0)
    }
  })
})
