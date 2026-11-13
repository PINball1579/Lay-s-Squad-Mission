import { useEffect, useRef, useState } from 'react'
import type { RewardCoupon } from '../types'
import { copyText } from '../lib/liff'

export function CouponDialog({ coupon, onClose }: { coupon: RewardCoupon; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [notice, setNotice] = useState('')
  useEffect(() => {
    const element = dialog.current
    element?.showModal()
    return () => element?.close()
  }, [])
  return <dialog ref={dialog} onCancel={onClose} className="coupon-dialog" aria-labelledby="coupon-heading"><div className="coupon-dialog-body"><button onClick={onClose} aria-label="ปิดคูปอง" className="coupon-close">×</button><img src="/brand/lays-logo.svg" alt="Lay's" className="mx-auto w-20" /><p className="eyebrow mt-5">YOUR SQUAD REWARD</p><h2 id="coupon-heading" className="mt-2 text-2xl font-black">รับสิทธิ์เรียบร้อยแล้ว!</h2><p className="mt-3 text-sm text-crunch-ink/65">{coupon.name}</p><div className="coupon-ticket"><span>รหัสคูปองของทีม</span><code>{coupon.code}</code></div>{coupon.testOnly && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">โค้ดสำหรับทดสอบระบบ ไม่สามารถใช้แลกสินค้าหรือส่วนลดได้</p>}<button className="mt-5 min-h-12 w-full rounded-xl bg-crunch-red font-black text-white" onClick={async () => { try { await copyText(coupon.code); setNotice('คัดลอกรหัสคูปองแล้ว!') } catch { setNotice('คัดลอกไม่สำเร็จ กดค้างที่รหัสเพื่อคัดลอกได้') } }}>คัดลอกรหัสคูปอง</button><p role="status" className="mt-3 min-h-6 text-sm font-bold">{notice}</p><p className="mt-2 text-xs text-crunch-ink/50">กลับมาดูรหัสเดิมได้ที่หน้า Crunch Vault<br />หนึ่งทีมได้รับหนึ่งรหัสร่วมกัน</p></div></dialog>
}
