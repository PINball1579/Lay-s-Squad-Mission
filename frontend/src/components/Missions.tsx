import { useMemo, useRef, useState } from 'react'
import type { Role } from '../types'
import type { LineAdapter } from '../lib/liff'

type Props = {
  role: Role
  challenge: Record<string, unknown>
  expiresAt: string
  errorMessage?: string
  line: LineAdapter
  validateQR: (token: string) => Promise<{ locationId: string }>
  onComplete: (properties: Record<string, unknown>) => Promise<void>
  onBack: () => void
}

const flavorLabels: Record<string, string> = {
  'Sunny Salt': 'เกลือคลาสสิก',
  'Smoky BBQ': 'บาร์บีคิวหอมควัน',
  'Zesty Lime': 'มะนาวซี้ด',
  'Spicy Spark': 'ฮอตแอนด์สไปซี่',
  'Mystery Crunch': 'รสลับปริศนา',
}
const occasionLabels: Record<string, string> = { 'Movie night': 'คืนดูหนัง', 'Game night': 'คืนเล่นเกม', 'Road trip': 'ทริปเที่ยว', 'Study break': 'พักอ่านหนังสือ' }
const moodLabels: Record<string, string> = { Bold: 'เท่แบบตัวตึง', Cozy: 'อบอุ่น', Playful: 'ขี้เล่น', Chill: 'ชิลๆ' }
const backgroundLabels: Record<string, string> = { Sunburst: 'แสงอาทิตย์', 'Warm waves': 'คลื่นอบอุ่น', 'Night pop': 'นีออนยามค่ำ' }

export function MissionRunner({ role, challenge, expiresAt, errorMessage, line, validateQR, onComplete, onBack }: Props) {
  return <main className="mx-auto min-h-screen max-w-lg px-5 py-6">
    <button className="mb-5 min-h-11 rounded-full bg-white/80 px-4 font-bold" onClick={onBack}>← กลับไปหาทีม</button>
    <p className="mb-3 text-center text-sm font-bold">โจทย์นี้ใช้ได้ถึง {new Date(expiresAt).toLocaleTimeString('th-TH')}</p>
    {errorMessage && <p role="alert" className="mb-3 rounded-xl bg-red-100 p-3 font-bold text-red-900">{errorMessage}</p>}
    {role === 'flavor_scout' && <FlavorScout challenge={challenge} onComplete={onComplete} />}
    {role === 'crunch_creator' && <CrunchCreator challenge={challenge} onComplete={onComplete} />}
    {role === 'snack_detective' && <SnackDetective challenge={challenge} onComplete={onComplete} />}
    {role === 'qr_runner' && <QRRunner line={line} validateQR={validateQR} onComplete={onComplete} />}
  </main>
}

function MissionShell({ eyebrow, title, children }: { eyebrow: string; title: string; children: React.ReactNode }) {
  return <section className="rounded-[2rem] bg-white p-5 shadow-pop" aria-labelledby="mission-title"><p className="text-sm font-black uppercase tracking-[.18em] text-crunch-red">{eyebrow}</p><h1 id="mission-title" className="mt-1 text-3xl font-black text-crunch-ink">{title}</h1><div className="mt-5">{children}</div></section>
}

function usePendingAction() {
  const pendingRef = useRef(false)
  const [pending, setPending] = useState(false)
  const run = async (action: () => Promise<void>) => {
    if (pendingRef.current) return
    pendingRef.current = true
    setPending(true)
    try { await action() } finally { pendingRef.current = false; setPending(false) }
  }
  return { pending, run }
}

export function FlavorScout({ onComplete, challenge = {} }: Pick<Props, 'onComplete'> & { challenge?: Record<string, unknown> }) {
  const [startedAt] = useState(() => Date.now())
  const [found, setFound] = useState<string[]>([])
  const products = [
    ['Sunny Salt', '☀', 'คลาสสิกกรอบเค็มกำลังดี'], ['Smoky BBQ', '♨', 'หอมเข้มแบบบาร์บีคิว'],
    ['Zesty Lime', '✺', 'ซ่าซี้ดพร้อมลุย'], ['Mystery Crunch', '◇', 'การ์ดลวงตาของชั้นวาง'],
  ]
  const requiredOrder = Array.isArray(challenge.requiredOrder) ? challenge.requiredOrder.filter((value): value is string => typeof value === 'string') : ['Sunny Salt', 'Smoky BBQ', 'Zesty Lime']
  const choose = (name: string) => setFound((current) => current.includes(name) || requiredOrder[current.length] !== name ? current : [...current, name])
  const { pending, run } = usePendingAction()
  return <MissionShell eyebrow="นักล่ารสชาติ" title="ล่ารสชาติให้ถูกลำดับ">
    <p className="text-crunch-ink/75">แตะการ์ด 3 ใบตามลำดับคำใบ้ ถ้ากดผิดให้ลองใหม่</p>
    <ol className="mt-3 list-inside list-decimal rounded-2xl bg-crunch-yellow/30 p-3 font-bold" aria-label="ลำดับรสชาติที่ต้องหา">{requiredOrder.map((name) => <li key={name}>{flavorLabels[name] ?? name}</li>)}</ol>
    <div className="my-5 grid grid-cols-2 gap-3" aria-label="ชั้นวางเลย์">{products.map(([name, icon, clue], index) => <button key={name} onClick={() => index < 3 && choose(name)} aria-pressed={found.includes(name)} className="min-h-36 rounded-3xl border-4 border-crunch-ink/10 bg-crunch-cream p-3 text-left transition active:scale-95 aria-pressed:border-crunch-red"><span className="block text-4xl" aria-hidden>{icon}</span><strong className="mt-2 block">{flavorLabels[name]}</strong><small>{clue}</small></button>)}</div>
    <p className="font-bold" aria-live="polite">พบแล้ว {found.length}/3 รสชาติ</p>
    <button disabled={found.length < 3 || pending} onClick={() => void run(() => onComplete({ discoveryOrder: found, accuracy: 1, completionMs: Date.now() - startedAt, favoriteFlavor: found[0] }))} className="mt-4 min-h-14 w-full rounded-2xl bg-crunch-red px-5 font-black text-white disabled:opacity-40">{pending ? 'กำลังบันทึก…' : 'สำเร็จภารกิจ'}</button>
  </MissionShell>
}

export function CrunchCreator({ onComplete, challenge = {} }: Pick<Props, 'onComplete'> & { challenge?: Record<string, unknown> }) {
  const requiredOccasion = typeof challenge.requiredOccasion === 'string' ? challenge.requiredOccasion : ''
  const [occasion, setOccasion] = useState(requiredOccasion || 'Movie night')
  const [mood, setMood] = useState('Bold')
  const [flavor, setFlavor] = useState('Sunny Salt')
  const [background, setBackground] = useState('Sunburst')
  const [caption, setCaption] = useState('แก๊งนี้มีแต่ความครันช์!')
  const { pending, run } = usePendingAction()
  return <MissionShell eyebrow="ครีเอเตอร์สายครันช์" title="สร้างโมเมนต์เลย์ของคุณ">
    <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-crunch-yellow to-crunch-orange p-6 text-center text-crunch-ink" aria-label="ตัวอย่างการ์ดโมเมนต์"><img src="/brand/lays-logo.svg" alt="Lay's" className="mx-auto w-24" /><p className="mt-3 text-2xl font-black">{occasionLabels[occasion]}</p><p>{moodLabels[mood]} · {flavorLabels[flavor]}</p><p className="mt-3 rounded-full bg-white/70 px-3 py-2 font-bold">{caption}</p></div>
    {requiredOccasion && <p className="mt-4 rounded-xl bg-crunch-yellow/30 p-3 font-bold">โจทย์ของคุณ: {occasionLabels[requiredOccasion] ?? requiredOccasion}</p>}
    <Choice label="โอกาส" value={occasion} onChange={setOccasion} options={['Movie night','Game night','Road trip','Study break']} labels={occasionLabels} disabled={Boolean(requiredOccasion)} />
    <Choice label="อารมณ์" value={mood} onChange={setMood} options={['Bold','Cozy','Playful','Chill']} labels={moodLabels} />
    <Choice label="รสชาติ" value={flavor} onChange={setFlavor} options={['Sunny Salt','Smoky BBQ','Zesty Lime','Spicy Spark']} labels={flavorLabels} />
    <Choice label="พื้นหลัง" value={background} onChange={setBackground} options={['Sunburst','Warm waves','Night pop']} labels={backgroundLabels} />
    <label className="mt-4 block font-bold">แคปชัน<input maxLength={80} value={caption} onChange={(event) => setCaption(event.target.value)} className="mt-1 min-h-12 w-full rounded-xl border-2 border-crunch-ink/20 px-3" /></label>
    <button disabled={pending} onClick={() => void run(() => onComplete({ occasion, mood, flavor, background, caption, creativeStyle: 'template-card' }))} className="mt-5 min-h-14 w-full rounded-2xl bg-crunch-red font-black text-white disabled:opacity-40">{pending ? 'กำลังบันทึก…' : 'บันทึกโมเมนต์'}</button>
  </MissionShell>
}

function Choice({ label, value, onChange, options, labels = {}, disabled = false }: { label: string; value: string; onChange: (value: string) => void; options: string[]; labels?: Record<string, string>; disabled?: boolean }) {
  return <label className="mt-4 block font-bold">{label}<select disabled={disabled} value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 min-h-12 w-full rounded-xl border-2 border-crunch-ink/20 bg-white px-3 disabled:opacity-70">{options.map((option) => <option key={option} value={option}>{labels[option] ?? option}</option>)}</select></label>
}

export function SnackDetective({ onComplete, challenge = {} }: Pick<Props, 'onComplete'> & { challenge?: Record<string, unknown> }) {
  const questions = useMemo(() => challenge.variant === 'location' ? [
    { id: 'q1', prompt: 'บทบาทใดมีหน้าที่ยืนยันจุดกิจกรรม?', options: [['QR Runner','นักวิ่ง QR'],['Flavor Scout','นักล่ารสชาติ'],['Crunch Creator','ครีเอเตอร์สายครันช์']], answer: 'QR Runner' },
    { id: 'q2', prompt: 'เมื่อทีมทำครบทุกภารกิจจะเกิดอะไรขึ้น?', options: [['Mock Crunch Badge','ปลดล็อกสิทธิ์รางวัล'],['Cash coupon','รับเงินสดทันที'],['Real product','สุ่มรสชาติใหม่']], answer: 'Mock Crunch Badge' },
  ] : [
    { id: 'q1', prompt: 'หนึ่งทีมต้องมีบทบาทไม่ซ้ำกันกี่บทบาท?', options: [['Two','2 บทบาท'],['Three','3 บทบาท'],['Four','4 บทบาท']], answer: 'Four' },
    { id: 'q2', prompt: 'อะไรคือเงื่อนไขในการเปิด Crunch Vault?', options: [['All four missions','ทำครบทั้ง 4 ภารกิจ'],['One share','แชร์หนึ่งครั้ง'],['A purchase','ซื้อสินค้า']], answer: 'All four missions' },
  ], [challenge.variant])
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [confidence, setConfidence] = useState('sure')
  const score = questions.filter((question) => answers[question.id] === question.answer).length
  const { pending, run } = usePendingAction()
  return <MissionShell eyebrow="นักสืบสายสแน็ก" title="แกะเบาะเงื่อนงำให้ได้">
    {questions.map((question, index) => <fieldset key={question.id} className="mb-6"><legend className="font-black">{index + 1}. {question.prompt}</legend><div className="mt-2 grid gap-2">{question.options.map(([value, label]) => <label key={value} className="flex min-h-12 items-center gap-3 rounded-xl bg-crunch-cream px-3"><input type="radio" name={question.id} value={value} checked={answers[question.id] === value} onChange={() => setAnswers((current) => ({ ...current, [question.id]: value }))} /> {label}</label>)}</div></fieldset>)}
    <Choice label="มั่นใจแค่ไหน?" value={confidence} onChange={setConfidence} options={['sure','somewhat sure','guessing']} labels={{ sure: 'มั่นใจมาก', 'somewhat sure': 'ค่อนข้างมั่นใจ', guessing: 'ขอเดาดู' }} />
    <button disabled={Object.keys(answers).length !== questions.length || pending} onClick={() => void run(() => onComplete({ answers, confidence, accuracy: score / questions.length, difficultQuestions: questions.filter((q) => answers[q.id] !== q.answer).map((q) => q.id) }))} className="mt-5 min-h-14 w-full rounded-2xl bg-crunch-red font-black text-white disabled:opacity-40">{pending ? 'กำลังส่งคำตอบ…' : 'ส่งคำตอบ'}</button>
  </MissionShell>
}

export function QRRunner({ line, validateQR, onComplete }: Pick<Props, 'line' | 'validateQR' | 'onComplete'>) {
  const localMode = import.meta.env.VITE_MOCK_LIFF !== 'false'
  const [token, setToken] = useState(localMode ? 'mock:demo-store' : '')
  const [status, setStatus] = useState('')
  const { pending, run } = usePendingAction()
  const verifyValue = async (value: string) => {
    try { const result = await validateQR(value); setStatus(`ยืนยันแล้วที่ ${result.locationId}`); await onComplete({ locationId: result.locationId, conversion: true }) }
    catch { setStatus('โค้ดไม่ถูกต้องหรือหมดอายุ กรุณาลองอีกครั้ง') }
  }
  const scan = () => run(async () => { const value = await line.scanQR(); if (value) { setToken(value); await verifyValue(value) } else setStatus('อุปกรณ์นี้ไม่รองรับการสแกน กรอกรหัสแทนได้') })
  return <MissionShell eyebrow="นักวิ่ง QR" title="สแกน ยืนยัน แล้วครันช์!">
    <div className="mx-auto grid aspect-square max-w-56 place-items-center rounded-3xl border-8 border-crunch-ink bg-white text-center"><span className="text-5xl" aria-hidden>⌁</span><small>สแกนโค้ด<br />ที่จุดกิจกรรม</small></div>
    <button disabled={pending} onClick={() => void scan()} className="mt-5 min-h-14 w-full rounded-2xl bg-crunch-ink font-black text-white disabled:opacity-40">เปิดกล้องสแกน QR</button>
    <label className="mt-4 block font-bold">{localMode ? 'รหัสสำหรับทดสอบภายใน' : 'หรือกรอกรหัสจากจุดกิจกรรม'}<input disabled={pending} value={token} onChange={(event) => setToken(event.target.value)} className="mt-1 min-h-12 w-full rounded-xl border-2 border-crunch-ink/20 px-3 disabled:opacity-40" /></label>
    <button disabled={pending || !token} onClick={() => void run(() => verifyValue(token))} className="mt-3 min-h-14 w-full rounded-2xl bg-crunch-red font-black text-white disabled:opacity-40">{pending ? 'กำลังยืนยัน…' : 'ยืนยันโค้ด'}</button>
    <p className="mt-3 font-bold" role="status">{status}</p>
  </MissionShell>
}
