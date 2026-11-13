import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import type { FlavorCupVoteResult, Role } from '../types'
import { copyText, type LineAdapter } from '../lib/liff'
import { BrandHeader, CampaignFooter } from './Brand'
import { CameraScanner } from './CameraScanner'

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
  return <main className="screen-enter mx-auto min-h-screen max-w-4xl px-4 py-5 sm:px-6">
    <BrandHeader label="MISSION IN PROGRESS" />
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3"><button className="min-h-11 rounded-full border border-crunch-ink/10 bg-white px-4 text-sm font-bold" onClick={onBack}>← กลับไปหาทีม</button><p className="text-xs text-crunch-ink/50">บันทึกรอบถึง {new Date(expiresAt).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</p></div>
    {errorMessage && <p role="alert" className="mb-3 rounded-xl bg-red-100 p-3 font-bold text-red-900">{errorMessage}</p>}
    {role === 'flavor_scout' && <CrunchHunt challenge={challenge} onComplete={onComplete} track={track} />}
    {role === 'crunch_creator' && <FlavorCup challenge={challenge} onVote={onFlavorVote} onComplete={onComplete} track={track} />}
    {role === 'snack_detective' && <SnackDetective challenge={challenge} onComplete={onComplete} />}
    {role === 'qr_runner' && <QRRunner line={line} validateQR={validateQR} onComplete={onComplete} />}
    <CampaignFooter />
  </main>
}

function MissionShell({ eyebrow, title, children }: { eyebrow: string; title: string; children: React.ReactNode }) {
  return <section className="mission-shell overflow-hidden rounded-[2rem] bg-white shadow-pop" aria-labelledby="mission-title"><header className="relative overflow-hidden bg-crunch-ink px-5 py-6 text-white sm:px-7"><div aria-hidden className="absolute -right-8 -top-12 h-36 w-36 rounded-full bg-crunch-yellow/10" /><p className="relative text-xs font-black uppercase tracking-[.14em] text-crunch-yellow">{eyebrow}</p><h1 id="mission-title" className="relative mt-2 text-2xl font-black sm:text-3xl">{title}</h1></header><div className="p-4 sm:p-6">{children}</div></section>
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
    if (differences.some(item => foundRef.current.has(item.id) && Math.hypot(x - item.x, y - item.y) <= item.radius)) {
      setFeedback('จุดนี้พบแล้ว ลองหาจุดอื่นต่อได้เลย')
      return
    }
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
    if (!loadedRef.current.every(Boolean)) return
    void track('crunch_hunt_restarted', { foundCount: found.length })
    foundRef.current.clear()
    timeoutTrackedRef.current = false
    const restartedAt = Date.now()
    startedAtRef.current = restartedAt
    setFound([]); setHinted([]); setWrongTaps(0); setFindTimes({}); setTimeLeft(timerSeconds); setStartedAt(restartedAt); setFeedback('เริ่มรอบใหม่แล้ว')
  }

  const finalScore = Math.max(0, found.length * scoring.basePerDifference + (complete ? timeLeft * scoring.speedBonusPerSecond : 0) - wrongTaps * scoring.wrongTapPenalty - hinted.length * scoring.hintPenalty)
  const finish = () => run(async () => {
    const completionMs = startedAt === null ? 0 : Math.min(timerSeconds * 1000, Date.now() - startedAt)
    const speedBonus = timeLeft * scoring.speedBonusPerSecond
    await track('crunch_hunt_completed', { completionMs, score: finalScore, correctTaps: found.length, wrongTaps, hintsUsed: hinted.length, speedBonus, missedDifferenceIds: [] })
    await onComplete({ foundDifferenceIds: found, completionMs, correctTaps: found.length, wrongTaps, hintsUsed: hinted.length, score: finalScore, speedBonus, findTimes: Object.entries(findTimes).map(([id, ms]) => `${id}:${ms}`) })
  })

  return <MissionShell eyebrow="Crunch Hunter" title="Crunch Hunt — Spot the Shelf">
    <p className="mb-4 text-sm leading-relaxed text-crunch-ink/65">ตามหาจุดต่างให้ครบ {differences.length} จุดก่อนหมดเวลา แตะภาพไหนก็ได้ จุดที่พบจะถูกวงไว้ทั้งสองภาพ ใช้สองนิ้วขยายเพื่อดูใกล้ขึ้น</p>
    <div className="grid grid-cols-3 gap-2 rounded-2xl bg-crunch-cream p-2 text-center"><div className="rounded-xl bg-white p-2"><small className="block text-crunch-ink/55">เวลา</small><strong>{timeLeft} วิ</strong></div><div className="rounded-xl bg-white p-2"><small className="block text-crunch-ink/55">เจอแล้ว</small><strong>{found.length}/{differences.length}</strong></div><div className="rounded-xl bg-white p-2"><small className="block text-crunch-ink/55">คะแนน</small><strong>{finalScore}</strong></div></div>
    {!loaded.every(Boolean) && <p role="status" className="mt-3 rounded-xl bg-crunch-yellow/30 p-3 font-bold">กำลังโหลดภาพทั้งสองภาพ — เวลาจะยังไม่เริ่ม</p>}
    <div className="mt-4 grid gap-3 sm:grid-cols-2" aria-label="ภาพจับผิดชั้นวาง">
      {[images.left, images.right].map((source, imageIndex) => <button type="button" key={imageIndex} aria-label={`ภาพชั้นวาง ${imageIndex === 0 ? 'A' : 'B'}`} onClick={tap} className="relative aspect-[4/3] min-h-0 overflow-auto rounded-2xl border-4 border-crunch-ink/15 bg-crunch-cream p-0 shadow-sm [touch-action:pinch-zoom]">
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
  const [error, setError] = useState('')
  const { pending: finishing, run: finishAction } = usePendingAction()
  const shareCard = { title: 'My Flavor Champion', accent: '#d93b2b', message: "แชมป์รสชาติของฉันคือ {flavor} จาก Lay's Crunch Squad", ...(challenge.shareCard as Partial<CupShareCard> ?? {}) }
  const matchStartedAt = useRef(0)
  const missionStartedAt = useRef(0)
  const current = tournament.matches.find((match) => match.id === tournament.currentMatchId)
  const flavor = (id?: string) => tournament.flavors.find((item) => item.id === id)
  const champion = flavor(tournament.championId)
  const totalSelections = tournament.bracketSize - 1
  const progress = Math.round((tournament.selectionCount / totalSelections) * 100)

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
    setError('')
    setBusy(true)
    try {
      const result = await onVote(current.id, winnerId, Date.now() - matchStartedAt.current)
      const next = result.attempt.challenge.tournament as CupTournament
      setTournament(next)
      matchStartedAt.current = Date.now()
      if (next.completed) await track('flavor_cup_completed', { championId: next.championId ?? '', matchCount: next.matches.length, completionMs: Date.now() - missionStartedAt.current })
    } catch { setError('บันทึกคำตอบไม่สำเร็จ ตรวจสอบการเชื่อมต่อแล้วเลือกรสนี้อีกครั้งได้เลย') }
    finally { setBusy(false) }
  }

  const share = async () => {
    if (!champion) return
    const text = shareCard.message.replaceAll('{flavor}', champion.name)
    let result = 'clipboard'
    if (navigator.share) {
      try { await navigator.share({ title: 'My Flavor Champion', text, url: window.location.href }); result = 'web-share' }
      catch (cause) { if (cause instanceof DOMException && cause.name === 'AbortError') return; await copyText(text) }
    } else await copyText(text)
    setShared(true)
    await track('flavor_cup_result_shared', { championId: champion.id, shareSurface: 'result-card', result })
  }

  const finish = () => finishAction(() => onComplete({ championId: tournament.championId, matchCount: tournament.matches.length, completionMs: Date.now() - missionStartedAt.current }))

  return <MissionShell eyebrow="Flavor Referee" title="Flavor Cup — Crown Your Crunch">
    {error && <p role="alert" className="mb-4 rounded-xl bg-red-50 p-4 text-sm text-red-900">{error}</p>}
    {!tournament.completed && <><div className="rounded-2xl bg-crunch-cream p-4"><div className="flex items-end justify-between gap-3"><div><p className="text-sm font-black text-crunch-red">เส้นทางสู่แชมป์</p><p className="font-bold">เลือกไปแล้ว {tournament.selectionCount} จาก {totalSelections} คู่</p></div><strong className="text-2xl">{progress}%</strong></div><div className="mt-3 h-3 overflow-hidden rounded-full bg-white"><div className="h-full rounded-full bg-crunch-red transition-[width] duration-500" style={{ width: `${progress}%` }} /></div></div><p className="mt-4 text-center text-crunch-ink/65">เลือกรสที่ใช่ในแต่ละคู่ ระบบบันทึกคำตอบให้อัตโนมัติ</p></>}
    {!tournament.completed && current && <section key={current.id} className="match-enter relative mt-5 overflow-hidden rounded-[2rem] bg-gradient-to-br from-crunch-cream to-white p-4 shadow-inner sm:p-6" aria-label="คู่แข่งขันปัจจุบัน"><p className="text-center text-sm font-black text-crunch-red">รอบ {current.round} · คู่ที่ {tournament.selectionCount + 1} จาก {totalSelections}</p><div className="mt-4 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-stretch gap-2 sm:gap-4"><FlavorChoice value={flavor(current.leftId)} side="ซ้าย" disabled={busy} onChoose={choose} /><span className="shine self-center rounded-full bg-crunch-ink px-2.5 py-3 text-sm font-black text-crunch-yellow shadow-lg sm:px-3 sm:text-base">VS</span><FlavorChoice value={flavor(current.rightId)} side="ขวา" disabled={busy} onChoose={choose} /></div>{busy && <div className="absolute inset-0 grid place-items-center bg-white/70 backdrop-blur-sm"><span className="rounded-full bg-crunch-ink px-5 py-3 font-black text-white">กำลังส่งผู้ชนะเข้ารอบ…</span></div>}</section>}
    {tournament.completed && champion && <section className="toast-pop relative mt-2 overflow-hidden rounded-[2rem] border-4 bg-crunch-ink p-6 text-center text-white" style={{ borderColor: shareCard.accent }} aria-label="My Flavor Champion result card"><div aria-hidden className="absolute inset-0 opacity-20"><span className="absolute left-5 top-5 text-4xl">✦</span><span className="absolute right-6 top-16 text-2xl">✦</span><span className="absolute bottom-8 left-12 text-2xl">✦</span></div><p className="relative text-sm font-black uppercase tracking-[.18em]" style={{ color: shareCard.accent }}>{shareCard.title}</p><div className="relative mx-auto mt-4 aspect-square w-40 overflow-hidden rounded-[2rem] border-4 border-white/30 bg-white"><img src={champion.image} alt="ผลิตภัณฑ์ตัวอย่าง" className="h-full w-full object-cover" /></div><h2 className="relative mt-3 text-4xl font-black">{champion.name}</h2><p className="relative text-white/75">{champion.description}</p><p className="relative mt-3 text-sm text-white/70">ชนะต่อเนื่อง {tournament.matches.filter((match) => match.winnerId === champion.id).length} รอบจนคว้ามงกุฎ</p><button onClick={() => void share()} className="relative mt-5 min-h-12 rounded-2xl px-6 font-black text-crunch-ink" style={{ backgroundColor: shareCard.accent }}>{shared ? 'แชร์ผลแล้ว ✓' : 'แชร์แชมป์ของฉัน'}</button></section>}
    {tournament.completed && <TournamentBracket tournament={tournament} flavor={flavor} />}
    {tournament.completed && <button disabled={finishing} onClick={() => void finish()} className="mt-4 min-h-14 w-full rounded-2xl bg-crunch-red font-black text-white disabled:opacity-50">{finishing ? 'กำลังบันทึกภารกิจ…' : 'ยืนยันแชมป์และจบภารกิจ'}</button>}
  </MissionShell>
}

function FlavorChoice({ value, side, disabled, onChoose }: { value?: CupFlavor; side: string; disabled: boolean; onChoose: (id: string) => Promise<void> }) {
  if (!value) return <div />
  return <button disabled={disabled} onClick={() => void onChoose(value.id)} aria-label={`เลือก ${value.name}`} className="group min-w-0 overflow-hidden rounded-3xl border-4 border-white p-2 text-center font-black text-white shadow-lg disabled:opacity-50 sm:p-3" style={{ backgroundColor: value.color }}><small className="block opacity-80">{side}</small><div className="mx-auto my-2 aspect-square w-full max-w-36 overflow-hidden rounded-2xl bg-white/90 shadow-inner"><img src={value.image} alt="" className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" /></div><span className="block break-words text-sm leading-tight sm:text-base">{value.name}</span><small className="mt-1 hidden font-normal opacity-85 sm:block">{value.description}</small><span className="mt-2 block rounded-full bg-white/20 px-2 py-1 text-xs">เลือกรสนี้</span></button>
}

function TournamentBracket({ tournament, flavor }: { tournament: CupTournament; flavor: (id?: string) => CupFlavor | undefined }) {
  const rounds = Math.ceil(Math.log2(tournament.bracketSize))
  const bracketHeight = Math.max(480, tournament.bracketSize * 58)
  const roundTitle = (round: number) => {
    const remaining = tournament.bracketSize / 2 ** (round - 1)
    if (remaining === 4) return 'รอบรองชนะเลิศ'
    if (remaining === 2) return 'รอบชิงชนะเลิศ'
    return `รอบ ${remaining} รส`
  }
  return <section className="mt-7 rounded-[2rem] bg-crunch-cream p-4 sm:p-5" aria-label="สายการแข่งขัน"><div className="flex items-end justify-between gap-3"><div><p className="text-sm font-black text-crunch-red">เส้นทางการแข่งขันทั้งหมด</p><h2 className="text-2xl font-black">Tournament bracket</h2></div><span className="rounded-full bg-white px-3 py-2 text-xs font-bold">เลื่อนดูด้านข้าง →</span></div><div className="bracket-scroll mt-4 overflow-x-auto pb-4"><div className="flex min-w-max gap-6 rounded-3xl bg-white/65 p-4" style={{ height: `${bracketHeight + 64}px` }}>{Array.from({ length: rounds }, (_, offset) => offset + 1).map((round) => <div key={round} className="bracket-column flex w-48 shrink-0 flex-col"><h3 className="h-12 text-center text-sm font-black text-crunch-red">{roundTitle(round)}</h3><div className="grid min-h-0 flex-1" style={{ gridTemplateRows: `repeat(${tournament.bracketSize}, minmax(0, 1fr))` }}>{tournament.matches.filter((match) => match.round === round).map((match) => { const span = 2 ** round; const start = match.index * span + 1; const left = flavor(match.leftId); const right = flavor(match.rightId); return <article key={match.id} className="bracket-match self-center rounded-2xl border border-crunch-ink/10 bg-white p-2 shadow-sm" style={{ gridRow: `${start} / span ${span}` }}><BracketFlavor value={left} winner={match.winnerId === match.leftId} /><div className="my-1 h-px bg-crunch-ink/10" /><BracketFlavor value={right} winner={match.winnerId === match.rightId} /></article> })}</div></div>)}</div></div><p className="mt-2 text-center text-xs text-crunch-ink/50">ภาพอ้างอิงโดย <a className="underline" href="https://commons.wikimedia.org/wiki/User:Famartin" target="_blank" rel="noreferrer">Famartin</a> / CC BY-SA 4.0</p></section>
}

function BracketFlavor({ value, winner }: { value?: CupFlavor; winner: boolean }) {
  return <div className={`flex min-h-9 items-center gap-2 rounded-xl px-2 py-1 ${winner ? 'bg-crunch-yellow text-crunch-ink' : 'text-crunch-ink/55'}`}><div className="h-7 w-7 shrink-0 overflow-hidden rounded-lg bg-crunch-cream">{value && <img src={value.image} alt="" className="h-full w-full object-cover" />}</div><span className={`min-w-0 flex-1 truncate text-xs ${winner ? 'font-black' : 'font-semibold'}`}>{value?.name ?? 'รอผล'}</span>{winner && <span aria-label="ผู้ชนะ">✓</span>}</div>
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
  const [scanning, setScanning] = useState(false)
  const { pending, run } = usePendingAction()
  const verifyValue = async (value: string) => {
    try { const result = await validateQR(value); setStatus(`ยืนยันแล้วที่ ${result.locationId}`); await onComplete({ locationId: result.locationId, conversion: true }) }
    catch { setStatus('โค้ดไม่ถูกต้องหรือหมดอายุ กรุณาลองอีกครั้ง') }
  }
  const scan = () => run(async () => {
    setStatus('')
    if (!localMode) {
      try {
        const value = await line.scanQR()
        if (value === '') { setStatus('ยกเลิกการสแกนแล้ว'); return }
        if (value) { setToken(value); await verifyValue(value); return }
      } catch { /* The browser camera remains available when LIFF scanning is unsupported. */ }
    }
    setScanning(true)
  })
  const onCameraResult = useCallback((value: string) => {
    setScanning(false)
    setToken(value)
    void run(() => verifyValue(value))
  // This callback only runs while this scanner is mounted for the current attempt.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return <MissionShell eyebrow="นักวิ่ง QR" title="สแกน ยืนยัน แล้วครันช์!">
    <div className="mx-auto grid aspect-square max-w-56 place-items-center rounded-3xl border-8 border-crunch-ink bg-white text-center"><span className="text-5xl" aria-hidden>⌁</span><small>สแกนโค้ด<br />ที่จุดกิจกรรม</small></div>
    <button disabled={pending || scanning} onClick={() => void scan()} className="mt-5 min-h-14 w-full rounded-2xl bg-crunch-ink font-black text-white disabled:opacity-40">เปิดกล้องสแกน QR</button>
    {scanning && <CameraScanner onResult={onCameraResult} onClose={() => setScanning(false)} />}
    <label className="mt-4 block font-bold">{localMode ? 'รหัสสำหรับทดสอบภายใน' : 'หรือกรอกรหัสจากจุดกิจกรรม'}<input disabled={pending} value={token} onChange={(event) => setToken(event.target.value)} className="mt-1 min-h-12 w-full rounded-xl border-2 border-crunch-ink/20 px-3 disabled:opacity-40" /></label>
    <button disabled={pending || !token} onClick={() => void run(() => verifyValue(token))} className="mt-3 min-h-14 w-full rounded-2xl bg-crunch-red font-black text-white disabled:opacity-40">{pending ? 'กำลังยืนยัน…' : 'ยืนยันโค้ด'}</button>
    <p className="mt-3 font-bold" role="status">{status}</p>
  </MissionShell>
}
