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

export function MissionRunner({ role, challenge, expiresAt, errorMessage, line, validateQR, onComplete, onBack }: Props) {
  return (
    <main className="mx-auto min-h-screen max-w-lg px-5 py-6">
      <button className="mb-5 min-h-11 rounded-full bg-white/80 px-4 font-bold" onClick={onBack}>← Squad</button>
      <p className="mb-3 text-center text-sm font-bold">Challenge valid until {new Date(expiresAt).toLocaleTimeString()}</p>
      {errorMessage && <p role="alert" className="mb-3 rounded-xl bg-red-100 p-3 font-bold text-red-900">{errorMessage}</p>}
      {role === 'flavor_scout' && <FlavorScout challenge={challenge} onComplete={onComplete} />}
      {role === 'crunch_creator' && <CrunchCreator challenge={challenge} onComplete={onComplete} />}
      {role === 'snack_detective' && <SnackDetective challenge={challenge} onComplete={onComplete} />}
      {role === 'qr_runner' && <QRRunner line={line} validateQR={validateQR} onComplete={onComplete} />}
    </main>
  )
}

function MissionShell({ eyebrow, title, children }: { eyebrow: string; title: string; children: React.ReactNode }) {
  return <section className="rounded-[2rem] bg-white p-5 shadow-pop" aria-labelledby="mission-title">
    <p className="text-sm font-black uppercase tracking-[.18em] text-crunch-red">{eyebrow}</p>
    <h1 id="mission-title" className="mt-1 text-3xl font-black text-crunch-ink">{title}</h1>
    <div className="mt-5">{children}</div>
  </section>
}

function usePendingAction() {
  const pendingRef = useRef(false)
  const [pending, setPending] = useState(false)
  const run = async (action: () => Promise<void>) => {
    if (pendingRef.current) return
    pendingRef.current = true
    setPending(true)
    try { await action() }
    finally {
      pendingRef.current = false
      setPending(false)
    }
  }
  return { pending, run }
}

export function FlavorScout({ onComplete, challenge = {} }: Pick<Props, 'onComplete'> & { challenge?: Record<string, unknown> }) {
  const [startedAt] = useState(() => Date.now())
  const [found, setFound] = useState<string[]>([])
  const products = [
    ['Sunny Salt', '☀', 'Find the sunny classic'], ['Smoky BBQ', '♨', 'Spot the smoky favorite'],
    ['Zesty Lime', '✺', 'Choose the zesty pick'], ['Mystery Crunch', '◇', 'A playful decoy'],
  ]
  const requiredOrder = Array.isArray(challenge.requiredOrder) ? challenge.requiredOrder.filter((value): value is string => typeof value === 'string') : ['Sunny Salt', 'Smoky BBQ', 'Zesty Lime']
  const choose = (name: string) => setFound((current) => current.includes(name) || requiredOrder[current.length] !== name ? current : [...current, name])
  const { pending, run } = usePendingAction()
  return <MissionShell eyebrow="Flavor Scout" title="Find the Flavor">
    <p className="text-crunch-ink/75">Tap the three shelf cards that match the clues. Placeholder flavors only.</p>
    <ol className="mt-3 list-inside list-decimal rounded-2xl bg-crunch-yellow/30 p-3 font-bold" aria-label="Required flavor order">{requiredOrder.map((name) => <li key={name}>{name}</li>)}</ol>
    <div className="my-5 grid grid-cols-2 gap-3" aria-label="Virtual snack shelf">
      {products.map(([name, icon, clue], index) => <button key={name} onClick={() => index < 3 && choose(name)} aria-pressed={found.includes(name)} className="min-h-36 rounded-3xl border-4 border-crunch-ink/10 bg-crunch-cream p-3 text-left transition active:scale-95 aria-pressed:border-crunch-red">
        <span className="block text-4xl" aria-hidden>{icon}</span><strong className="mt-2 block">{name}</strong><small>{clue}</small>
      </button>)}
    </div>
    <p className="font-bold" aria-live="polite">{found.length}/3 flavors found</p>
    <button disabled={found.length < 3 || pending} onClick={() => void run(() => onComplete({ discoveryOrder: found, accuracy: 1, completionMs: Date.now() - startedAt, favoriteFlavor: found[0] }))} className="mt-4 min-h-14 w-full rounded-2xl bg-crunch-red px-5 font-black text-white disabled:opacity-40">{pending ? 'Completing…' : 'Complete mission'}</button>
  </MissionShell>
}

export function CrunchCreator({ onComplete, challenge = {} }: Pick<Props, 'onComplete'> & { challenge?: Record<string, unknown> }) {
  const requiredOccasion = typeof challenge.requiredOccasion === 'string' ? challenge.requiredOccasion : ''
  const [occasion, setOccasion] = useState(requiredOccasion || 'Movie night')
  const [mood, setMood] = useState('Bold')
  const [flavor, setFlavor] = useState('Sunny Salt')
  const [background, setBackground] = useState('Sunburst')
  const [caption, setCaption] = useState('Squad goals, but crunchy.')
  const { pending, run } = usePendingAction()
  return <MissionShell eyebrow="Crunch Creator" title="Perfect Snack Moment">
    <div className="rounded-3xl bg-gradient-to-br from-crunch-yellow to-crunch-orange p-6 text-center text-crunch-ink" aria-label="Snack card preview">
      <span className="text-5xl" aria-hidden>✦</span><p className="mt-3 text-2xl font-black">{occasion}</p><p>{mood} · {flavor}</p><p className="mt-3 rounded-full bg-white/70 px-3 py-2 font-bold">{caption}</p><small>PLACEHOLDER ART</small>
    </div>
    {requiredOccasion && <p className="mt-4 rounded-xl bg-crunch-yellow/30 p-3 font-bold">Challenge occasion: {requiredOccasion}</p>}
    <Choice label="Occasion" value={occasion} onChange={setOccasion} options={['Movie night','Game night','Road trip','Study break']} disabled={Boolean(requiredOccasion)} />
    <Choice label="Mood" value={mood} onChange={setMood} options={['Bold','Cozy','Playful','Chill']} />
    <Choice label="Flavor" value={flavor} onChange={setFlavor} options={['Sunny Salt','Smoky BBQ','Zesty Lime','Spicy Spark']} />
    <Choice label="Background" value={background} onChange={setBackground} options={['Sunburst','Warm waves','Night pop']} />
    <label className="mt-4 block font-bold">Caption<input maxLength={80} value={caption} onChange={(event) => setCaption(event.target.value)} className="mt-1 min-h-12 w-full rounded-xl border-2 border-crunch-ink/20 px-3" /></label>
    <button disabled={pending} onClick={() => void run(() => onComplete({ occasion, mood, flavor, background, caption, creativeStyle: 'template-card' }))} className="mt-5 min-h-14 w-full rounded-2xl bg-crunch-red font-black text-white disabled:opacity-40">{pending ? 'Saving…' : 'Save snack moment'}</button>
  </MissionShell>
}

function Choice({ label, value, onChange, options, disabled = false }: { label: string; value: string; onChange: (value: string) => void; options: string[]; disabled?: boolean }) {
  return <label className="mt-4 block font-bold">{label}<select disabled={disabled} value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 min-h-12 w-full rounded-xl border-2 border-crunch-ink/20 bg-white px-3 disabled:opacity-70">{options.map((option) => <option key={option}>{option}</option>)}</select></label>
}

export function SnackDetective({ onComplete, challenge = {} }: Pick<Props, 'onComplete'> & { challenge?: Record<string, unknown> }) {
  const questions = useMemo(() => challenge.variant === 'location' ? [
    { id: 'q1', prompt: 'Which role verifies the campaign location?', options: ['QR Runner','Flavor Scout','Crunch Creator'], answer: 'QR Runner' },
    { id: 'q2', prompt: 'What reward exists in this unofficial demo?', options: ['Mock Crunch Badge','Cash coupon','Real product'], answer: 'Mock Crunch Badge' },
  ] : [
    { id: 'q1', prompt: 'How many unique roles complete a squad?', options: ['Two','Three','Four'], answer: 'Four' },
    { id: 'q2', prompt: 'What unlocks the Crunch Vault?', options: ['All four missions','One share','A purchase'], answer: 'All four missions' },
  ], [challenge.variant])
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [confidence, setConfidence] = useState('sure')
  const score = questions.filter((question) => answers[question.id] === question.answer).length
  const { pending, run } = usePendingAction()
  return <MissionShell eyebrow="Snack Detective" title="Crack the clues">
    {questions.map((question, index) => <fieldset key={question.id} className="mb-6"><legend className="font-black">{index + 1}. {question.prompt}</legend><div className="mt-2 grid gap-2">{question.options.map((option) => <label key={option} className="flex min-h-12 items-center gap-3 rounded-xl bg-crunch-cream px-3"><input type="radio" name={question.id} value={option} checked={answers[question.id] === option} onChange={() => setAnswers((current) => ({ ...current, [question.id]: option }))} /> {option}</label>)}</div></fieldset>)}
    <Choice label="How confident are you?" value={confidence} onChange={setConfidence} options={['sure','somewhat sure','guessing']} />
    <button disabled={Object.keys(answers).length !== questions.length || pending} onClick={() => void run(() => onComplete({ answers, confidence, accuracy: score / questions.length, difficultQuestions: questions.filter((q) => answers[q.id] !== q.answer).map((q) => q.id) }))} className="mt-5 min-h-14 w-full rounded-2xl bg-crunch-red font-black text-white disabled:opacity-40">{pending ? 'Submitting…' : 'Solve the case'}</button>
  </MissionShell>
}

export function QRRunner({ line, validateQR, onComplete }: Pick<Props, 'line' | 'validateQR' | 'onComplete'>) {
  const [token, setToken] = useState('mock:demo-store')
  const [status, setStatus] = useState('')
  const { pending, run } = usePendingAction()
  const verifyValue = async (value: string) => {
    try {
      const result = await validateQR(value)
      setStatus(`Verified at ${result.locationId}`)
      await onComplete({ locationId: result.locationId, conversion: true })
    } catch { setStatus('That code is invalid or expired. Try the local mock code.') }
  }
  const scan = () => run(async () => {
    const value = await line.scanQR()
    if (value) { setToken(value); await verifyValue(value) }
    else setStatus('Scanning is unavailable here. Enter the code instead.')
  })
  return <MissionShell eyebrow="QR Runner" title="Scan. Verify. Crunch.">
    <div className="mx-auto grid aspect-square max-w-56 place-items-center rounded-3xl border-8 border-crunch-ink bg-white text-center"><span className="text-5xl" aria-hidden>⌁</span><small>MOCK QR<br />NOT A COUPON</small></div>
    <button disabled={pending} onClick={() => void scan()} className="mt-5 min-h-14 w-full rounded-2xl bg-crunch-ink font-black text-white disabled:opacity-40">Scan campaign code</button>
    <label className="mt-4 block font-bold">Fallback code<input disabled={pending} value={token} onChange={(event) => setToken(event.target.value)} className="mt-1 min-h-12 w-full rounded-xl border-2 border-crunch-ink/20 px-3 disabled:opacity-40" /></label>
    <button disabled={pending} onClick={() => void run(() => verifyValue(token))} className="mt-3 min-h-14 w-full rounded-2xl bg-crunch-red font-black text-white disabled:opacity-40">{pending ? 'Verifying…' : 'Verify code'}</button>
    <p className="mt-3 font-bold" role="status">{status}</p>
  </MissionShell>
}

