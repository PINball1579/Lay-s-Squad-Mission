import liff from '@line/liff'

export interface LineAdapter {
  initialize(): Promise<void>
  getIDToken(): string | null
  login(): void
  share(invite: ShareInvitation): Promise<ShareResult>
  scanQR(): Promise<string | null>
}

export type ShareInvitation = {
  url: string
  squadName: string
  expiresLabel: string
}

export type ShareResult = 'sent' | 'cancelled' | 'unavailable'

export function invitationURL(token: string) {
  const liffId = import.meta.env.VITE_LIFF_ID
  const base = liffId ? `https://liff.line.me/${liffId}/` : `${window.location.origin}${window.location.pathname}`
  return `${base}?invite=${encodeURIComponent(token)}`
}

export function readInviteToken() {
  const params = new URLSearchParams(window.location.search)
  const direct = params.get('invite')
  if (direct) return direct
  // LIFF passes extra query parameters in liff.state on its first redirect.
  const state = params.get('liff.state')
  if (!state) return ''
  try { return new URL(state, window.location.origin).searchParams.get('invite') ?? '' } catch { return '' }
}

export class RealLineAdapter implements LineAdapter {
  private initialization: Promise<void> | null = null

  async initialize() {
    const liffId = import.meta.env.VITE_LIFF_ID
    if (!liffId) throw new Error('VITE_LIFF_ID is required when mock LIFF mode is disabled')
    if (!this.initialization) {
      this.initialization = liff.init({ liffId, withLoginOnExternalBrowser: false }).then(() => undefined).catch(cause => { this.initialization = null; throw cause })
    }
    await this.initialization
  }

  getIDToken() { return liff.getIDToken() }
  login() {
    const invite = readInviteToken()
    if (invite) { try { sessionStorage.setItem('crunch:login-invite', invite) } catch { /* URL remains the fallback. */ } }
    liff.login({ redirectUri: window.location.href })
  }

  async share(invite: ShareInvitation): Promise<ShareResult> {
    if (!liff.isApiAvailable('shareTargetPicker')) return 'unavailable'
    const heroUrl = import.meta.env.VITE_SHARE_IMAGE_URL || new URL('/brand/lays-classic.jpg', window.location.origin).href
    const messages = [{
      type: 'flex',
      altText: `มาเข้าทีม ${invite.squadName} ใน Lay's Crunch Squad`,
      contents: {
        type: 'bubble',
        hero: { type: 'image', url: heroUrl, size: 'full', aspectRatio: '20:13', aspectMode: 'cover', backgroundColor: '#FFD928' },
        body: {
          type: 'box', layout: 'vertical', spacing: 'md', backgroundColor: '#FFF8DA',
          contents: [
            { type: 'text', text: "LAY'S CRUNCH SQUAD", weight: 'bold', color: '#D93B2B', size: 'sm' },
            { type: 'text', text: `ทีม ${invite.squadName} กำลังรอคุณ!`, weight: 'bold', size: 'xl', wrap: true, color: '#241D16' },
            { type: 'text', text: 'เลือกภารกิจของคุณ รวมพลังความครันช์ แล้วปลดล็อกรางวัลไปด้วยกัน', wrap: true, color: '#594A3D', size: 'sm' },
            { type: 'text', text: invite.expiresLabel, wrap: true, color: '#8B6B52', size: 'xs' },
          ],
        },
        footer: {
          type: 'box', layout: 'vertical', backgroundColor: '#FFF8DA',
          contents: [{ type: 'button', style: 'primary', color: '#D93B2B', action: { type: 'uri', label: 'เข้าร่วมทีม', uri: invite.url } }],
        },
      },
    }] as Parameters<typeof liff.shareTargetPicker>[0]
    const result = await liff.shareTargetPicker(messages, { isMultiple: true })
    return result?.status === 'success' ? 'sent' : 'cancelled'
  }

  async scanQR() {
    if (!liff.isApiAvailable('scanCodeV2')) return null
    const result = await liff.scanCodeV2()
    return result.value ?? ''
  }
}

export class MockLineAdapter implements LineAdapter {
  async initialize() { return undefined }
  getIDToken(): string | null { return null }
  login() { return undefined }
  async share(): Promise<ShareResult> { return 'unavailable' }
  async scanQR() { return 'mock:demo-store' }
}

export const lineAdapter: LineAdapter = import.meta.env.VITE_MOCK_LIFF === 'false'
  ? new RealLineAdapter()
  : new MockLineAdapter()

export async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value)
    return
  }
  const field = document.createElement('textarea')
  field.value = value
  field.setAttribute('readonly', '')
  field.style.position = 'fixed'
  field.style.opacity = '0'
  document.body.append(field)
  field.select()
  const copied = document.execCommand('copy')
  field.remove()
  if (!copied) throw new Error('Clipboard is unavailable')
}

