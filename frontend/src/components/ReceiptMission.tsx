import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { ApiError } from '../lib/api'

const messages:Record<string,string>={
 lays_not_found:'ยังไม่พบรายการเลย์ ลองถ่ายใหม่ให้เห็นชื่อสินค้าชัดเจน หรือเลือกใบเสร็จอื่น',
 ocr_not_configured:'ระบบอ่านใบเสร็จยังไม่ได้เชื่อมต่อ กรุณาลองใหม่ภายหลัง',
 ocr_unavailable:'ระบบอ่านใบเสร็จไม่พร้อมใช้งานชั่วคราว กรุณาลองอีกครั้งภายหลัง',
 ocr_rate_limited:'กรุณารอสักครู่ก่อนส่งใบเสร็จอีกครั้ง',
 receipt_too_large:'กรุณาใช้ภาพที่มีขนาดไม่เกิน 10 MB',
 receipt_format:'กรุณาใช้ภาพ JPEG หรือ PNG ที่เปิดดูได้ตามปกติ',
 attempt_invalid:'รอบภารกิจหมดอายุแล้ว กลับไปที่ทีมแล้วเริ่มภารกิจใหม่ได้เลย',
}

export function ReceiptMission({verify,onComplete}:{verify:(file:File)=>Promise<{verified:boolean;brand:string}>;onComplete:(properties:Record<string,unknown>)=>Promise<void>}){
 const camera=useRef<HTMLInputElement>(null)
 const gallery=useRef<HTMLInputElement>(null)
 const url=useRef('')
 const pending=useRef(false)
 const [file,setFile]=useState<File|null>(null)
 const [preview,setPreview]=useState('')
 const [consent,setConsent]=useState(false)
 const [busy,setBusy]=useState(false)
 const [verified,setVerified]=useState(false)
 const [error,setError]=useState('')
 useEffect(()=>()=>{if(url.current)URL.revokeObjectURL(url.current)},[])
 const select=(event:ChangeEvent<HTMLInputElement>)=>{
  const next=event.target.files?.[0];event.target.value='';if(!next||pending.current)return
  setError('');setVerified(false);setFile(null);setPreview('')
  if(url.current){URL.revokeObjectURL(url.current);url.current=''}
  if(next.size>10*1024*1024||next.size===0){setError(messages.receipt_too_large);return}
  if(!['image/jpeg','image/png'].includes(next.type)){setError(messages.receipt_format);return}
  url.current=URL.createObjectURL(next);setPreview(url.current);setFile(next)
 }
 const submit=async()=>{
  if(!file||!consent||pending.current)return
  pending.current=true;setBusy(true);setError('')
  try{if(!verified){const result=await verify(file);if(!result.verified)throw new Error('unverified');setVerified(true)}await onComplete({receiptVerified:true,brand:'lays'})}
  catch(cause){setError(cause instanceof ApiError?messages[cause.code]??'ตรวจสอบใบเสร็จไม่สำเร็จ กรุณาลองอีกครั้ง':'เชื่อมต่อไม่สำเร็จ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองอีกครั้ง')}
  finally{pending.current=false;setBusy(false)}
 }
 return <section aria-label="ตรวจใบเสร็จเลย์"><div className="receipt-intro"><span className="receipt-step">01</span><div><h2 className="font-black">ถ่ายใบเสร็จที่มีรายการเลย์</h2><p className="mt-1 text-sm leading-relaxed text-crunch-ink/60">วางใบเสร็จบนพื้นเรียบ ให้เห็นชื่อสินค้าเต็มบรรทัด แสงเพียงพอ ภาพไม่เบลอ และปิดข้อมูลส่วนตัวที่ไม่จำเป็นก่อนส่ง</p></div></div><input ref={camera} aria-label="ถ่ายรูปใบเสร็จ" type="file" accept="image/jpeg,image/png" capture="environment" className="sr-only" disabled={busy} onChange={select}/><input ref={gallery} aria-label="เลือกภาพใบเสร็จ" type="file" accept="image/jpeg,image/png" className="sr-only" disabled={busy} onChange={select}/><div className="mt-5 grid grid-cols-2 gap-3"><button disabled={busy} onClick={()=>camera.current?.click()} className="min-h-14 rounded-2xl bg-crunch-ink px-3 font-black text-white disabled:opacity-50">ถ่ายใบเสร็จ</button><button disabled={busy} onClick={()=>gallery.current?.click()} className="min-h-14 rounded-2xl border-2 border-crunch-ink/15 px-3 font-bold disabled:opacity-50">เลือกรูปจากเครื่อง</button></div><p className="mt-2 text-center text-xs text-crunch-ink/45">JPEG / PNG · สูงสุด 10 MB</p>{preview?<div className="mt-5 overflow-hidden rounded-2xl border border-crunch-ink/10 bg-[#f5f3ed] p-3"><img src={preview} alt="ภาพใบเสร็จที่จะส่งตรวจ" className="mx-auto max-h-96 rounded-lg object-contain"/><p className="mt-2 text-center text-xs text-crunch-ink/50">ตรวจดูชื่อรายการสินค้าให้ชัดก่อนส่ง</p></div>:<div className="receipt-empty mt-5"><span aria-hidden>▤</span><p className="font-bold">ใบเสร็จหนึ่งภาพ เพื่อภารกิจของทีม</p><p className="mt-2 text-sm text-crunch-ink/50">ระบบจะค้นหา Lay’s, LAYS หรือ เลย์ ในข้อความ</p></div>}<label className="mt-5 flex gap-3 rounded-2xl bg-crunch-cream p-4 text-sm leading-relaxed"><input type="checkbox" checked={consent} disabled={busy} onChange={e=>setConsent(e.target.checked)} aria-label="ยินยอมส่งภาพใบเสร็จให้ iApp อ่านข้อความ"/><span>ยินยอมส่งภาพนี้ให้ iApp ประมวลผลด้วย OpenThai 2.0 OCR Text เพื่อค้นหารายการเลย์ แอปไม่เก็บภาพหรือข้อความใบเสร็จหลังตรวจเสร็จ <a className="underline" target="_blank" rel="noreferrer" href="https://iapp.co.th/docs/ocr/document#การจัดการข้อมูล">ข้อมูลการประมวลผล</a></span></label><button disabled={!file||!consent||busy} onClick={()=>void submit()} className="mt-4 min-h-14 w-full rounded-2xl bg-crunch-red px-4 font-black text-white disabled:opacity-40">{busy?'กำลังตรวจสอบและบันทึก…':verified?'ยืนยันผลใบเสร็จ':'ส่งใบเสร็จเพื่อตรวจสอบ'}</button>{busy&&<p role="status" className="mt-3 text-center text-sm">กำลังค้นหารายการเลย์ อาจใช้เวลาสักครู่ กรุณาอย่าปิดหน้านี้</p>}{error&&<p role="alert" className="mt-4 rounded-xl bg-red-50 p-4 text-sm text-red-900">{error}</p>}</section>
}
