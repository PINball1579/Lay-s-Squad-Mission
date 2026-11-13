import { useState } from 'react'

export function BrandHeader({ label = 'CRUNCH SQUAD' }: { label?: string }) {
  return <header className="brand-header"><a href="/" aria-label="Lay's Crunch Squad หน้าหลัก" className="brand-lockup"><img src="/brand/lays-logo.svg" alt="Lay's" /><span>CRUNCH<br /><b>SQUAD</b></span></a><span className="edition-label">{label}<i /></span></header>
}

export function CampaignFooter() {
  const [open, setOpen] = useState(false)
  return <footer className="campaign-footer"><span>LAY'S CRUNCH SQUAD</span><button onClick={() => setOpen(!open)} aria-expanded={open}>วิธีร่วมสนุก {open ? '−' : '+'}</button>{open && <div className="footer-guide"><p>1. สร้างทีมและชวนเพื่อนให้ครบ 4 คน</p><p>2. แต่ละคนเลือกภารกิจคนละบทบาท</p><p>3. ทำครบทั้ง 4 ภารกิจเพื่อเปิด Crunch Vault</p><p>ความคืบหน้าบันทึกกับบัญชีของคุณ กลับมาเล่นต่อได้ด้วยบัญชีเดิม</p></div>}</footer>
}

export function MissionIcon({ kind, className = '' }: { kind: string; className?: string }) {
  return <svg className={className} width="28" height="28" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{kind === 'flavor_scout' ? <><circle cx="14" cy="14" r="9" /><path d="m21 21 7 7M14 9v10M9 14h10" /></> : kind === 'crunch_creator' ? <><path d="m4 9 6 5 6-9 6 9 6-5-3 15H7L4 9ZM8 28h16" /><circle cx="16" cy="18" r="2" /></> : kind === 'snack_detective' ? <><path d="M8 3h13l5 5v21H6V3h2ZM20 3v7h6M11 15h10M11 20h6" /><circle cx="22" cy="24" r="5" /><path d="m26 28 3 3" /></> : <><path d="M7 3h18v26l-3-2-3 2-3-2-3 2-3-2-3 2V3ZM11 9h10M11 14h10M11 19h5" /></>}</svg>
}
