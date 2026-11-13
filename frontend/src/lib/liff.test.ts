import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import liff from '@line/liff'
import { invitationURL, readInviteToken, RealLineAdapter } from './liff'

vi.mock('@line/liff', () => ({ default: { isApiAvailable: vi.fn(), shareTargetPicker: vi.fn() } }))

const invite = { url: 'https://liff.line.me/test-app/?invite=team-token', squadName: 'ทีมกรุบกรอบ', expiresLabel: 'เข้าร่วมได้ถึงพรุ่งนี้' }
beforeEach(() => { vi.mocked(liff.isApiAvailable).mockReturnValue(true) })
afterEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs(); window.history.replaceState({}, '', '/') })

describe('LINE Flex invitations', () => {
  it('opens the friend picker immediately and sends a Flex card linking to the squad', async () => {
    vi.mocked(liff.shareTargetPicker).mockResolvedValue({ status: 'success' })
    const result = new RealLineAdapter().share(invite)
    // No network await before opening the picker: retain the click gesture.
    expect(liff.shareTargetPicker).toHaveBeenCalledTimes(1)
    const [messages, options] = vi.mocked(liff.shareTargetPicker).mock.calls[0]
    expect(options).toEqual({ isMultiple: true })
    expect(messages[0]).toMatchObject({ type: 'flex', contents: { type: 'bubble', footer: { contents: [{ action: { type: 'uri', uri: invite.url } }] } } })
    expect(JSON.stringify(messages)).toContain(invite.squadName)
    expect(await result).toBe('sent')
  })

  it('does not report a cancelled picker as sent', async () => {
    vi.mocked(liff.shareTargetPicker).mockResolvedValue(undefined)
    expect(await new RealLineAdapter().share(invite)).toBe('cancelled')
  })

  it('does not silently copy the invitation when LINE sharing is unavailable', async () => {
    vi.mocked(liff.isApiAvailable).mockReturnValue(false)
    expect(await new RealLineAdapter().share(invite)).toBe('unavailable')
    expect(liff.shareTargetPicker).not.toHaveBeenCalled()
  })

  it('surfaces a picker error rather than falling back to a link copy', async () => {
    vi.mocked(liff.shareTargetPicker).mockRejectedValue(new Error('picker error'))
    await expect(new RealLineAdapter().share(invite)).rejects.toThrow('picker error')
  })

  it('uses the LIFF URL and preserves invite intent in the first LINE redirect', () => {
    vi.stubEnv('VITE_LIFF_ID', '2012602577-R4BMg7FW')
    expect(invitationURL('token with &')).toBe('https://liff.line.me/2012602577-R4BMg7FW/?invite=token%20with%20%26')
    window.history.replaceState({}, '', '/?liff.state=%2F%3Finvite%3Dteam-token')
    expect(readInviteToken()).toBe('team-token')
    window.history.replaceState({}, '', '/?invite=direct-token')
    expect(readInviteToken()).toBe('direct-token')
  })
})
