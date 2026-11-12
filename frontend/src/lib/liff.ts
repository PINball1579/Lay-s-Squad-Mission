import liff from '@line/liff'

export interface LineAdapter {
  initialize(): Promise<void>
  getIDToken(): string | null
  login(): void
  share(text: string): Promise<boolean>
  scanQR(): Promise<string | null>
}

export class RealLineAdapter implements LineAdapter {
  async initialize() {
    const liffId = import.meta.env.VITE_LIFF_ID
    if (!liffId) throw new Error('VITE_LIFF_ID is required when mock LIFF mode is disabled')
    await liff.init({ liffId, withLoginOnExternalBrowser: true })
  }

  getIDToken() { return liff.getIDToken() }
  login() { liff.login({ redirectUri: window.location.href }) }

  async share(text: string) {
    if (!liff.isApiAvailable('shareTargetPicker')) return false
    await liff.shareTargetPicker([{ type: 'text', text }])
    return true
  }

  async scanQR() {
    if (!liff.isApiAvailable('scanCodeV2')) return null
    const result = await liff.scanCodeV2()
    return result.value ?? null
  }
}

export class MockLineAdapter implements LineAdapter {
  async initialize() { return undefined }
  getIDToken() { return null }
  login() { return undefined }
  async share() { return false }
  async scanQR() { return 'mock:demo-store' }
}

export const lineAdapter: LineAdapter = import.meta.env.VITE_MOCK_LIFF === 'false'
  ? new RealLineAdapter()
  : new MockLineAdapter()

export async function shareOrCopy(adapter: LineAdapter, text: string, url: string) {
  if (await adapter.share(`${text}\n${url}`)) return 'line'
  await navigator.clipboard.writeText(url)
  return 'clipboard'
}

