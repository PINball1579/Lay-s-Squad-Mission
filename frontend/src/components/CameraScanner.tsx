import { useEffect, useRef, useState } from 'react'
import type { IScannerControls } from '@zxing/browser'

export function CameraScanner({ onResult, onClose }: { onResult: (value: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let disposed = false
    let found = false
    let controls: IScannerControls | undefined
    const element = video.current
    const start = async () => {
      try {
        if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new Error('secure-context')
        const { BrowserQRCodeReader } = await import('@zxing/browser')
        if (disposed || !element) return
        const reader = new BrowserQRCodeReader()
        controls = await reader.decodeFromConstraints({ audio: false, video: { facingMode: { ideal: 'environment' } } }, element, (result, _error, scanControls) => {
          if (disposed || found || !result) return
          found = true
          scanControls.stop()
          onResult(result.getText())
        })
        if (disposed || found) controls.stop()
      } catch (cause) {
        if (disposed) return
        const name = cause && typeof cause === 'object' && 'name' in cause ? String(cause.name) : ''
        setError(name === 'NotAllowedError' ? 'กรุณาอนุญาตการใช้กล้องในการตั้งค่าเบราว์เซอร์ แล้วลองอีกครั้ง' : name === 'NotFoundError' ? 'ไม่พบกล้องบนอุปกรณ์นี้ กรอกรหัสกิจกรรมด้านล่างได้' : cause instanceof Error && cause.message === 'secure-context' ? 'การเปิดกล้องต้องใช้ HTTPS หรือ localhost กรุณาเปิดลิงก์ที่ปลอดภัย หรือกรอกรหัสแทน' : 'เปิดกล้องไม่สำเร็จ กล้องอาจกำลังใช้งานอยู่ ลองอีกครั้งหรือกรอกรหัสแทน')
      }
    }
    void start()
    return () => {
      disposed = true
      controls?.stop()
      const stream = element?.srcObject
      if (typeof MediaStream !== 'undefined' && stream instanceof MediaStream) stream.getTracks().forEach(track => track.stop())
      if (element) element.srcObject = null
    }
  }, [onResult])
  return <section aria-label="กล้องสแกน QR" className="mt-4 rounded-2xl bg-crunch-ink p-4 text-white"><div className="relative overflow-hidden rounded-xl bg-black"><video ref={video} autoPlay muted playsInline className="aspect-square w-full object-cover" aria-label="ภาพจากกล้อง" /><div className="pointer-events-none absolute inset-[18%] rounded-2xl border-2 border-crunch-yellow" /></div>{error ? <p role="alert" className="mt-3 text-sm text-amber-200">{error}</p> : <p className="mt-3 text-center text-sm">วาง QR กิจกรรมในกรอบ ระบบจะอ่านอัตโนมัติ</p>}<button onClick={onClose} className="mt-3 min-h-11 w-full rounded-xl bg-white/15 font-bold">ปิดกล้อง</button></section>
}
