import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import type { FlavorCupVoteResult, Role } from '../types'
import type { LineAdapter } from '../lib/liff'

type Track = (name: string, properties: Record<string, unknown>) => Promise<void>

type Props = {
  role: Role
  challenge: Record<string, unknown>
  expiresAt: string
  errorMessage?: string
  line: LineAdapter
  validateQR: (token: string) => Promise<{ locationId: string }>
  onFlavorVote: (matchId: string, winnerId: string, decisionMs: number) => Promise<FlavorCupVoteResult>
  track: Track
  onComplete: (properties: Record<string, unknown>) => Promise<void>
  onBack: () => void
}

export function MissionRunner({ role, challenge, expiresAt, errorMessage, line, validateQR, onFlavorVote, track, onComplete, onBack }: Props) {
  return <main className="mx-auto min-h-screen max-w-3xl px-4 py-5 sm:px-6">
    <button className="mb-5 min-h-11 rounded-full bg-white/80 px-4 font-bold" onClick={onBack}>← กลับไปหาทีม</button>
    <p className="mb-3 text-center text-sm font-bold">โจทย์นี้ใช้ได้ถึง {new Date(expiresAt).toLocaleTimeString('th-TH')}</p>
    {errorMessage && <p role="alert" className="mb-3 rounded-xl bg-red-100 p-3 font-bold text-red-900">{errorMessage}</p>}
    {role === 'flavor_scout' && <CrunchHunt challenge={challenge} onComplete={onComplete} track={track} />}
    {role === 'crunch_creator' && <FlavorCup challenge={challenge} onVote={onFlavorVote} onComplete={onComplete} track={track} />}
    {role === 'snack_detective' && <SnackDetective challenge={challenge} onComplete={onComplete} />}
    {role === 'qr_runner' && <QRRunner line={line} validateQR={validateQR} onComplete={onComplete} />}
  </main>
}

function MissionShell({ eyebrow, title, children }: { eyebrow: string; title: string; children: React.ReactNode }) {
  return <section className="rounded-[2rem] bg-white p-4 shadow-pop sm:p-6" aria-labelledby="mission-title"><p className="text-sm font-black uppercase tracking-[.14em] text-crunch-red">{eyebrow}</p><h1 id="mission-title" className="mt-1 text-3xl font-black text-crunch-ink">{title}</h1><div className="mt-5">{children}</div></section>
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

type HuntDifference = { id: string; x: number; y: number; radius: number; hint: string }
type HuntScoring = { basePerDifference: number; speedBonusPerSecond: number; wrongTapPenalty: number; hintPenalty: number }

const defaultDifferences: HuntDifference[] = [
  { id: 'promo-sign', x: .5, y: .13, radius: .09, hint: 'ดูป้ายโปรโมชันด้านบน' },
  { id: 'missing-bag', x: .19, y: .43, radius: .09, hint: 'ลองดูจำนวนถุงบนชั้นกลาง' },
  { id: 'color-swap', x: .76, y: .43, radius: .09, hint: 'สีถุงหนึ่งใบไม่เหมือนกัน' },
  { id: 'shelf-label', x: .35, y: .72, radius: .08, hint: 'ป้ายราคาบนชั้นล่างขยับไป' },
  { id: 'quantity', x: .82, y: .73, radius: .09, hint: 'นับจำนวนสินค้าด้านขวาล่าง' },
]

export function CrunchHunt({ challenge = {}, onComplete, track = async () => undefined }: { challenge?: Record<string, unknown>; onComplete: Props['onComplete']; track?: Track }) {
  const differences = Array.isArray(challenge.differences) && challenge.differences.length ? challenge.differences as HuntDifference[] : defaultDifferences
  const timerSeconds = typeof challenge.timerSeconds === 'number' ? challenge.timerSeconds : 90
  const maxHints = typeof challenge.maxHints === 'number' ? challenge.maxHints : 2
  const scoring = { basePerDifference: 100, speedBonusPerSecond: 5, wrongTapPenalty: 15, hintPenalty: 25, ...(challenge.scoring as Partial<HuntScoring> ?? {}) }
  const images = { left: '/missions/crunch-hunt-a.svg', right: '/missions/crunch-hunt-b.svg', ...(challenge.images as Record<string, string> ?? {}) }
  const [loaded, setLoaded] = useState([false, false])
  const [found, setFound] = useState<string[]>([])
  const [hinted, setHinted] = useState<string[]>([])
  const [wrongTaps, setWrongTaps] = useState(0)
  const [feedback, setFeedback] = useState('')
  const [timeLeft, setTimeLeft] = useState(timerSeconds)
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [findTimes, setFindTimes] = useState<Record<string, number>>({})
  const loadedRef = useRef([false, false])
  const foundRef = useRef(new Set<string>())
  const startedAtRef = useRef<number | null>(null)
  const timeoutTrackedRef = useRef(false)
  const { pending, run } = usePendingAction()
  const complete = found.length === differences.length
  const expired = timeLeft <= 0 && !complete

  const markLoaded = (imageIndex: number) => {
    const next = loadedRef.current.map((item, index) => index === imageIndex ? true : item)
    loadedRef.current = next
    setLoaded(next)
    if (next.every(Boolean) && startedAtRef.current === null) {
      // Event handlers are the correct place to capture the actual load time.
      // eslint-disable-next-line react-hooks/purity
      const loadedAt = Date.now()
      startedAtRef.current = loadedAt
      setStartedAt(loadedAt)
      void track('crunch_hunt_started', { timerSeconds, differenceCount: differences.length })
    }
  }

  useEffect(() => {
    if (startedAt === null || complete || expired) return
    const timer = window.setInterval(() => setTimeLeft(Math.max(0, timerSeconds - Math.floor((Date.now() - startedAt) / 1000))), 250)
    return () => window.clearInterval(timer)
  }, [startedAt, complete, expired, timerSeconds])

  useEffect(() => {
    if (!expired || timeoutTrackedRef.current) return
    timeoutTrackedRef.current = true
    void track('crunch_hunt_timed_out', { foundCount: found.length, wrongTaps, hintsUsed: hinted.length, missedDifferenceIds: differences.filter((item) => !foundRef.current.has(item.id)).map((item) => item.id) })
  }, [expired, differences, found.length, hinted.length, track, wrongTaps])

  const tap = (event: ReactMouseEvent<HTMLButtonElement>) => {
    if (startedAt === null || complete || expired) return
    const rect = event.currentTarget.getBoundingClientRect()
    const x = (event.clientX - rect.left) / rect.width
    const y = (event.clientY - rect.top) / rect.height
    const difference = differences.find((item) => !foundRef.current.has(item.id) && Math.hypot(x - item.x, y - item.y) <= item.radius)
    const elapsedMs = Date.now() - startedAt
    void track('crunch_hunt_tap', { x: Number(x.toFixed(4)), y: Number(y.toFixed(4)), correct: Boolean(difference), differenceId: difference?.id ?? '', elapsedMs })
    if (!difference) {
      setWrongTaps((value) => value + 1)
      setFeedback('ยังไม่ใช่จุดนี้ ลองมองอีกครั้ง')
      return
    }
    foundRef.current.add(difference.id)
    setFound(Array.from(foundRef.current))
    setFindTimes((value) => ({ ...value, [difference.id]: elapsedMs }))
    setFeedback('เจอแล้ว! จุดนี้ถูกต้อง')
    void track('crunch_hunt_difference_found', { differenceId: difference.id, findMs: elapsedMs })
  }

  const useHint = () => {
    const next = differences.find((item) => !found.includes(item.id) && !hinted.includes(item.id))
    if (!next || hinted.length >= maxHints) return
    setHinted((value) => [...value, next.id])
    setFeedback(next.hint)
    void track('crunch_hunt_hint_used', { differenceId: next.id, hintsUsed: hinted.length + 1 })
  }

  const restart = () => {
    void track('crunch_hunt_restarted', { foundCount: found.length })
    foundRef.current.clear()
    timeoutTrackedRef.current = false
    const restartedAt = Date.now()
    startedAtRef.current = restartedAt
    setFound([]); setHinted([]); setWrongTaps(0); setFindTimes({}); setTimeLeft(timerSeconds); setStartedAt(restartedAt); setFeedback('เริ่มรอบใหม่แล้ว')
  }

  const finalScore = Math.max(0, found.length * scoring.basePerDifference + timeLeft * scoring.speedBonusPerSecond - wrongTaps * scoring.wrongTapPenalty - hinted.length * scoring.hintPenalty)
  const finish = () => run(async () => {
    const completionMs = startedAt === null ? 0 : Math.min(timerSeconds * 1000, Date.now() - startedAt)
    const speedBonus = timeLeft * scoring.speedBonusPerSecond
    await track('crunch_hunt_completed', { completionMs, score: finalScore, correctTaps: found.length, wrongTaps, hintsUsed: hinted.length, speedBonus, missedDifferenceIds: [] })
    await onComplete({ foundDifferenceIds: found, completionMs, correctTaps: found.length, wrongTaps, hintsUsed: hinted.length, score: finalScore, speedBonus, findTimes: Object.entries(findTimes).map(([id, ms]) => `${id}:${ms}`) })
  })

  return <MissionShell eyebrow="Crunch Hunter" title="Crunch Hunt — Spot the Shelf">
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-crunch-ink p-3 text-white"><strong>เวลา {timeLeft} วินาที</strong><strong>พบ {found.length}/{differences.length}</strong><strong>คะแนน {finalScore}</strong></div>
    {!loaded.every(Boolean) && <p role="status" className="mt-3 rounded-xl bg-crunch-yellow/30 p-3 font-bold">กำลังโหลดภาพทั้งสองภาพ — เวลาจะยังไม่เริ่ม</p>}
    <div className="mt-4 grid gap-3 sm:grid-cols-2" aria-label="ภาพจับผิดชั้นวาง">
      {[images.left, images.right].map((source, imageIndex) => <button type="button" key={imageIndex} aria-label={`ภาพชั้นวาง ${imageIndex === 0 ? 'A' : 'B'}`} onClick={tap} className="relative aspect-[4/3] min-h-0 overflow-auto rounded-2xl border-4 border-crunch-ink/15 bg-crunch-cream p-0 [touch-action:pinch-zoom]">
        <img src={source} alt="" draggable={false} onLoad={() => markLoaded(imageIndex)} className="h-full w-full select-none object-contain" />
        {differences.filter((item) => found.includes(item.id) || hinted.includes(item.id)).map((item) => <span key={item.id} aria-hidden className={`pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-4 ${found.includes(item.id) ? 'border-green-500 bg-green-300/30' : 'animate-pulse border-crunch-red bg-crunch-yellow/30'}`} style={{ left: `${item.x * 100}%`, top: `${item.y * 100}%`, width: `${item.radius * 200}%`, aspectRatio: '1' }} />)}
      </button>)}
    </div>
    <p role="status" className="mt-3 min-h-6 text-center font-bold text-crunch-red">{expired ? 'หมดเวลาแล้ว เริ่มใหม่เพื่อออกล่าต่อ' : feedback}</p>
    <div className="mt-3 grid grid-cols-2 gap-3"><button disabled={hinted.length >= maxHints || complete || expired || startedAt === null} onClick={useHint} className="min-h-12 rounded-2xl bg-crunch-yellow font-black disabled:opacity-40">คำใบ้ ({maxHints - hinted.length})</button><button onClick={restart} className="min-h-12 rounded-2xl border-2 border-crunch-ink font-black">เริ่มใหม่</button></div>
    {complete && <button disabled={pending} onClick={() => void finish()} className="mt-4 min-h-14 w-full rounded-2xl bg-crunch-red font-black text-white disabled:opacity-40">{pending ? 'กำลังบันทึก…' : 'ยืนยันผล Crunch Hunt'}</button>}
  </MissionShell>
}

type CupFlavor = { id: string; name: string; description: string; image: string; color: string }
type CupMatch = { id: string; round: number; index: number; leftId: string; rightId: string; winnerId?: string; selectedSide?: string; decisionMs?: number }
type CupTournament = { bracketSize: number; flavors: CupFlavor[]; matches: CupMatch[]; currentMatchId: string; championId?: string; completed: boolean; selectionCount: number }
type CupShareCard = { title: string; accent: string; message: string }

export function FlavorCup({ challenge, onVote, onComplete, track = async () => undefined }: { challenge: Record<string, unknown>; onVote: (matchId: string, winnerId: string, decisionMs: number) => Promise<FlavorCupVoteResult>; onComplete: Props['onComplete']; track?: Track }) {
  const [tournament, setTournament] = useState(() => challenge.tournament as CupTournament)
  const [busy, setBusy] = useState(false)
  const [shared, setShared] = useState(false)
  const shareCard = { title: 'My Flavor Champion', accent: '#d93b2b', message: "แชมป์รสชาติของฉันคือ {flavor} จาก Lay's Crunch Squad", ...(challenge.shareCard as Partial<CupShareCard> ?? {}) }
  const matchStartedAt = useRef(0)
  const missionStartedAt = useRef(0)
  const current = tournament.matches.find((match) => match.id === tournament.currentMatchId)
  const flavor = (id?: string) => tournament.flavors.find((item) => item.id === id)
  const champion = flavor(tournament.championId)

  useEffect(() => {
    const openedAt = Date.now()
    matchStartedAt.current = openedAt
    missionStartedAt.current = openedAt
    const event = tournament.selectionCount > 0 ? 'flavor_cup_resumed' : 'flavor_cup_started'
    const currentRound = current?.round ?? Math.ceil(Math.log2(tournament.bracketSize))
    void track(event, tournament.selectionCount > 0 ? { selections: tournament.selectionCount, currentRound } : { bracketSize: tournament.bracketSize })
  // This is deliberately a one-time open/resume event.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const choose = async (winnerId: string) => {
    if (!current || busy) return
    setBusy(true)
    try {
      const result = await onVote(current.id, winnerId, Date.now() - matchStartedAt.current)
      const next = result.attempt.challenge.tournament as CupTournament
      setTournament(next)
      matchStartedAt.current = Date.now()
      if (next.completed) await track('flavor_cup_completed', { championId: next.championId ?? '', matchCount: next.matches.length, completionMs: Date.now() - missionStartedAt.current })
    } finally { setBusy(false) }
  }

  const share = async () => {
    if (!champion) return
    const text = shareCard.message.replaceAll('{flavor}', champion.name)
    let result = 'clipboard'
    if (navigator.share) { await navigator.share({ title: 'My Flavor Champion', text, url: window.location.href }); result = 'web-share' }
    else await navigator.clipboard.writeText(text)
    setShared(true)
    await track('flavor_cup_result_shared', { championId: champion.id, shareSurface: 'result-card', result })
  }

  const finish = () => onComplete({ championId: tournament.championId, matchCount: tournament.matches.length, completionMs: Date.now() - missionStartedAt.current })

  return <MissionShell eyebrow="Flavor Referee" title="Flavor Cup — Crown Your Crunch">
    <p className="text-crunch-ink/70">เลือกหนึ่งรสในแต่ละคู่ ผู้ชนะจะผ่านเข้ารอบจนเหลือแชมป์เพียงหนึ่งเดียว ระบบบันทึกทุกคำตอบทันที</p>
    {!tournament.completed && current && <section className="mt-5 rounded-3xl bg-crunch-cream p-4" aria-label="คู่แข่งขันปัจจุบัน"><p className="text-center text-sm font-black text-crunch-red">รอบ {current.round} · คู่ที่ {current.index + 1}</p><div className="mt-3 grid grid-cols-[1fr_auto_1fr] items-stretch gap-2"><FlavorChoice value={flavor(current.leftId)} side="ซ้าย" disabled={busy} onChoose={choose} /><span className="self-center font-black text-crunch-red">VS</span><FlavorChoice value={flavor(current.rightId)} side="ขวา" disabled={busy} onChoose={choose} /></div></section>}
    <section className="mt-5" aria-label="สายการแข่งขัน"><h2 className="text-xl font-black">Tournament bracket</h2><div className="mt-3 grid gap-3 sm:grid-cols-3">{Array.from({ length: Math.ceil(Math.log2(tournament.bracketSize)) }, (_, offset) => offset + 1).map((round) => <div key={round} className="rounded-2xl bg-crunch-cream p-3"><h3 className="font-black">รอบ {round}</h3>{tournament.matches.filter((match) => match.round === round).map((match) => <div key={match.id} className="mt-2 rounded-xl bg-white p-2 text-sm"><p className={match.winnerId === match.leftId ? 'font-black text-crunch-red' : ''}>{flavor(match.leftId)?.name ?? 'รอผล'}</p><p className={match.winnerId === match.rightId ? 'font-black text-crunch-red' : ''}>{flavor(match.rightId)?.name ?? 'รอผล'}</p></div>)}</div>)}</div></section>
    {tournament.completed && champion && <section className="mt-5 overflow-hidden rounded-3xl border-4 bg-crunch-ink p-5 text-center text-white" style={{ borderColor: shareCard.accent }} aria-label="My Flavor Champion result card"><p className="text-sm font-black uppercase tracking-[.18em]" style={{ color: shareCard.accent }}>{shareCard.title}</p><img src={champion.image} alt="ผลิตภัณฑ์ตัวอย่าง" className="mx-auto mt-3 h-28" /><h2 className="mt-2 text-3xl font-black">{champion.name}</h2><p>{champion.description}</p><p className="mt-3 text-sm text-white/70">เส้นทางสู่แชมป์: {tournament.matches.filter((match) => match.winnerId === champion.id).map((match) => `รอบ ${match.round}`).join(' → ')}</p><button onClick={() => void share()} className="mt-4 min-h-12 rounded-2xl px-5 font-black text-crunch-ink" style={{ backgroundColor: shareCard.accent }}>{shared ? 'แชร์ผลแล้ว' : 'แชร์การ์ดแชมป์'}</button></section>}
    {tournament.completed && <button onClick={() => void finish()} className="mt-4 min-h-14 w-full rounded-2xl bg-crunch-red font-black text-white">ยืนยันแชมป์และจบภารกิจ</button>}
  </MissionShell>
}

function FlavorChoice({ value, side, disabled, onChoose }: { value?: CupFlavor; side: string; disabled: boolean; onChoose: (id: string) => Promise<void> }) {
  if (!value) return <div />
  return <button disabled={disabled} onClick={() => void onChoose(value.id)} aria-label={`เลือก ${value.name}`} className="min-w-0 rounded-2xl p-3 text-center font-black text-white shadow-sm disabled:opacity-50" style={{ backgroundColor: value.color }}><small className="block opacity-80">{side}</small><img src={value.image} alt="" className="mx-auto my-2 h-24" /><span className="block break-words">{value.name}</span><small className="mt-1 block font-normal">{value.description}</small></button>
}

function Choice({ label, value, onChange, options, labels = {}, disabled = false }: { label: string; value: string; onChange: (value: string) => void; options: string[]; labels?: Record<string, string>; disabled?: boolean }) {
  return <label className="mt-4 block font-bold">{label}<select disabled={disabled} value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 min-h-12 w-full rounded-xl border-2 border-crunch-ink/20 bg-white px-3 disabled:opacity-70">{options.map((option) => <option key={option} value={option}>{labels[option] ?? option}</option>)}</select></label>
}

export function SnackDetective({ onComplete, challenge = {} }: Pick<Props, 'onComplete'> & { challenge?: Record<string, unknown> }) {
  const questions = useMemo(() => challenge.variant === 'location' ? [
    { id: 'q1', prompt: 'บทบาทใดมีหน้าที่ยืนยันจุดกิจกรรม?', options: [['QR Runner','นักวิ่ง QR'],['Crunch Hunter','Crunch Hunter'],['Flavor Referee','Flavor Referee']], answer: 'QR Runner' },
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
    {questions.map((question, index) => <fieldset key={question.id} className="mb-6"><legend className="font-black">{index + 1}. {question.prompt}</legend><div className="mt-2 grid gap-2">{question.options.map(([value, label]) => <label key={value} className="flex min-h-12 items-center gap-3 rounded-xl bg-crunch-cream px-3"><input type="radio" name={question.id} value={value} checked={answers[question.id] === value} onChange={() => setAnswers((currentAnswers) => ({ ...currentAnswers, [question.id]: value }))} /> {label}</label>)}</div></fieldset>)}
    <Choice label="มั่นใจแค่ไหน?" value={confidence} onChange={setConfidence} options={['sure','somewhat sure','guessing']} labels={{ sure: 'มั่นใจมาก', 'somewhat sure': 'ค่อนข้างมั่นใจ', guessing: 'ขอเดาดู' }} />
    <button disabled={Object.keys(answers).length !== questions.length || pending} onClick={() => void run(() => onComplete({ answers, confidence, accuracy: score / questions.length, difficultQuestions: questions.filter((question) => answers[question.id] !== question.answer).map((question) => question.id) }))} className="mt-5 min-h-14 w-full rounded-2xl bg-crunch-red font-black text-white disabled:opacity-40">{pending ? 'กำลังส่งคำตอบ…' : 'ส่งคำตอบ'}</button>
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
