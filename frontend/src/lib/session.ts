import { api, ApiError } from './api'
import type { LineAdapter } from './liff'

let restoring: ReturnType<typeof api.me> | null = null

// StrictMode and overlapping mounts share a single login exchange so session
// rotation cannot revoke a session created by a concurrent callback.
export function restoreAppSession(line: LineAdapter) {
  if (restoring) return restoring
  restoring = (async () => {
    try { return await api.me() }
    catch (cause) {
      if (!(cause instanceof ApiError) || cause.status !== 401) throw cause
      const token = line.getIDToken()
      if (!token) throw cause
      await api.lineAuth(token)
      return api.me()
    }
  })().finally(() => { restoring = null })
  return restoring
}
