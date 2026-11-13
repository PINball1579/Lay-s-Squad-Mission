import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError } from './api'
import { MockLineAdapter } from './liff'
import { restoreAppSession } from './session'

afterEach(() => vi.restoreAllMocks())

const session = { user: { id: 'verified', displayName: 'LINE Player' }, consent: { requiredAccepted: true, analyticsAllowed: false }, csrfToken: 'csrf' }

describe('LINE callback session restoration', () => {
  it('exchanges the LINE token after a missing app session and loads current state', async () => {
    const line = new MockLineAdapter()
    vi.spyOn(line, 'getIDToken').mockReturnValue('line-id-token')
    const me = vi.spyOn(api, 'me').mockRejectedValueOnce(new ApiError(401, 'authentication_required', 'login')).mockResolvedValue(session)
    const login = vi.spyOn(api, 'lineAuth').mockResolvedValue(session.user)
    const [a, b] = await Promise.all([restoreAppSession(line), restoreAppSession(line)])
    expect(a).toEqual(session)
    expect(b).toEqual(session)
    expect(login).toHaveBeenCalledExactlyOnceWith('line-id-token')
    expect(me).toHaveBeenCalledTimes(2)
  })

  it('does not exchange a token when an app session already exists', async () => {
    vi.spyOn(api, 'me').mockResolvedValue(session)
    const login = vi.spyOn(api, 'lineAuth')
    expect(await restoreAppSession(new MockLineAdapter())).toEqual(session)
    expect(login).not.toHaveBeenCalled()
  })

  it('leaves a player without a LINE token at the sign-in screen', async () => {
    vi.spyOn(api, 'me').mockRejectedValue(new ApiError(401, 'authentication_required', 'login'))
    const login = vi.spyOn(api, 'lineAuth')
    await expect(restoreAppSession(new MockLineAdapter())).rejects.toMatchObject({ status: 401 })
    expect(login).not.toHaveBeenCalled()
  })
})
