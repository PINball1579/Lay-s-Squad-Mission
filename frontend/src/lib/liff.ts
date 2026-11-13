import liff from '@line/liff'

export interface LineAdapter {
  initialize(): Promise<void>
  getIDToken(): string | null
  login(): void
  share(invite: ShareInvitation): Promise<boolean>
  scanQR(): Promise<string | null>
}

export type ShareInvitation = {
  url: string
  squadName: string
  expiresLabel: string
}

export class RealLineAdapter implements LineAdapter {
  async initialize() {
    const liffId = import.meta.env.VITE_LIFF_ID
    if (!liffId) throw new Error('VITE_LIFF_ID is required when mock LIFF mode is disabled')
    await liff.init({ liffId, withLoginOnExternalBrowser: true })
  }

  getIDToken() { return liff.getIDToken() }
  login() { liff.login({ redirectUri: window.location.href }) }

  async share(invite: ShareInvitation) {
    if (!liff.isApiAvailable('shareTargetPicker')) return false
    const heroUrl = import.meta.env.VITE_SHARE_IMAGE_URL || 'https://thumb.wikimedia.org/wikipedia/commons/thumb/6/67/Lay%27s_logo_2019.svg/960px-Lay%27s_logo_2019.svg.png'
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
    await liff.shareTargetPicker(messages)
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

export async function shareOrCopy(adapter: LineAdapter, invite: ShareInvitation) {
  if (await adapter.share(invite)) return 'line'
  await copyText(invite.url)
  return 'clipboard'
}

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

