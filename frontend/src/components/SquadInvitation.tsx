import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { copyText, invitationURL, lineAdapter } from '../lib/liff'
import type { Invitation, Squad } from '../types'

export function SquadInvitation({ squad }: { squad: Squad }) {
  const [prepared, setPrepared] = useState<Invitation | null>(null)
  const [prepareError, setPrepareError] = useState(false)
  const [revision, setRevision] = useState(0)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [toast, setToast] = useState('')
  const [needsLine, setNeedsLine] = useState(false)

  useEffect(() => {
    let active = true
    let refresh: ReturnType<typeof setTimeout> | undefined
    // Awaiting HTTP during the tap can lose the gesture needed by LINE's popup.
    void api.invite(squad.id).then(invite => {
      if (!active) return
      setPrepared(invite)
      setPrepareError(false)
      refresh = setTimeout(() => setRevision(value => value + 1), Math.min(2_000_000_000, Math.max(1000, new Date(invite.expiresAt).getTime() - Date.now() - 30_000)))
    }).catch(() => { if (active) setPrepareError(true) })
    return () => { active = false; clearTimeout(refresh) }
  }, [squad.id, revision])

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(''), 3000)
    return () => clearTimeout(timer)
  }, [toast])

  const ready = prepared?.squadId === squad.id
  const share = async () => {
    if (busy || !ready) return
    if (new Date(prepared.expiresAt).getTime() <= Date.now()) {
      setNotice('กำลังเตรียมคำเชิญใหม่ กรุณากดชวนเพื่อนอีกครั้งในสักครู่')
      setRevision(value => value + 1)
      return
    }
    setBusy(true)
    setNotice('')
    setToast('')
    setNeedsLine(false)
    try {
      // Open the picker before awaiting anything, directly from this click.
      const pending = lineAdapter.share({ url: invitationURL(prepared.token), squadName: squad.name, expiresLabel: `เข้าร่วมได้ถึง ${new Date(prepared.expiresAt).toLocaleString('th-TH')}` })
      void api.event('share_initiated', { squadId: squad.id }).catch(() => undefined)
      const result = await pending
      if (result === 'sent') {
        setToast('ส่งการ์ดชวนเพื่อนใน LINE แล้ว!')
        void api.event('share_completed', { squadId: squad.id, properties: { result: 'line' } }).catch(() => undefined)
      } else if (result === 'cancelled') {
        setNotice('ยังไม่ได้ส่งคำเชิญ เลือกเพื่อนแล้วส่งได้ทุกเมื่อ')
      } else {
        setNeedsLine(true)
        setNotice('เปิดแอปนี้ผ่าน LINE เพื่อเลือกเพื่อนและส่งการ์ดคำเชิญ')
      }
    } catch { setNotice('เปิดรายชื่อเพื่อนไม่สำเร็จ กรุณาลองอีกครั้งใน LINE') }
    finally { setBusy(false) }
  }

  const copyForTesting = async () => {
    if (!ready) return
    try {
      await copyText(invitationURL(prepared.token))
      setNotice('')
      setToast('คัดลอกลิงก์สำหรับทดสอบแล้ว')
    } catch { setNotice('คัดลอกลิงก์ไม่สำเร็จ กรุณาลองอีกครั้ง') }
  }

  return <div className="mt-5">
    <button disabled={busy || !ready} onClick={share} className="invite-pulse min-h-14 w-full rounded-2xl bg-[#06C755] font-black text-white shadow-pop disabled:opacity-60">{busy ? 'กำลังเปิดรายชื่อเพื่อน…' : ready ? 'ชวนเพื่อนเข้าทีม' : 'กำลังเตรียมคำเชิญ…'}</button>
    <p className="mt-2 text-center text-sm text-crunch-ink/60">เลือกเพื่อนหรือกลุ่มใน LINE แล้วส่งการ์ดคำเชิญได้เลย</p>
    {notice && <p role="status" className="mt-3 rounded-xl bg-white p-3 text-center font-bold text-crunch-red">{notice}</p>}
    {needsLine && ready && import.meta.env.VITE_LIFF_ID && <a href={invitationURL(prepared.token)} className="mt-2 flex min-h-12 items-center justify-center rounded-xl bg-[#06C755] px-4 font-bold text-white">เปิดใน LINE เพื่อชวนเพื่อน</a>}
    {prepareError && <div role="alert" className="mt-2 text-center"><p>เตรียมคำเชิญไม่สำเร็จ</p><button onClick={() => { setPrepareError(false); setRevision(value => value + 1) }} className="min-h-12 px-3 font-bold underline">ลองเตรียมคำเชิญอีกครั้ง</button></div>}
    {import.meta.env.VITE_MOCK_LIFF !== 'false' && <button disabled={!ready} onClick={copyForTesting} className="mt-2 min-h-12 w-full rounded-xl border border-crunch-ink/20 text-sm font-bold disabled:opacity-50">คัดลอกลิงก์สำหรับทดสอบ</button>}
    {toast && <div role="status" aria-live="polite" className="toast-pop fixed inset-x-4 bottom-6 z-50 mx-auto flex max-w-sm items-center justify-center gap-3 rounded-2xl bg-crunch-ink px-5 py-4 font-black text-white shadow-2xl"><span className="grid h-7 w-7 place-items-center rounded-full bg-green-500" aria-hidden>✓</span>{toast}</div>}
  </div>
}
